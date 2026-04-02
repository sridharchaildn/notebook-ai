import type { SourceHint } from '@notebook-ai/contracts';

export const LIVE_CAPTURE_MIME_TYPE = 'audio/wav';
export const LIVE_CAPTURE_FILE_EXTENSION = 'wav';
export const LIVE_CAPTURE_TARGET_SAMPLE_RATE = 16_000;

const WORKLET_NAME = 'notebook-pcm-tap';
const WORKLET_BATCH_FRAMES = 2048;
const STOP_FLUSH_TIMEOUT_MS = 1500;
const SCRIPT_PROCESSOR_DRAIN_MS = 80;

const workletLoadByContext = new WeakMap<AudioContext, Promise<void>>();

const PCM_TAP_WORKLET_SOURCE = `
class NotebookPcmTapProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const configuredBatchFrames = Number(options?.processorOptions?.batchFrames) || 2048;
    this.batchFrames = Math.max(128, Math.floor(configuredBatchFrames));
    this.buffer = new Float32Array(this.batchFrames);
    this.bufferedFrames = 0;
    this.pendingFlushIds = [];
    this.port.onmessage = (event) => {
      const payload = event.data || {};
      if (payload.type === 'flush') {
        this.pendingFlushIds.push(Number(payload.flushId) || 0);
      }
    };
  }

  flushBufferedFrames() {
    if (this.bufferedFrames <= 0) return;
    const payload = this.buffer.slice(0, this.bufferedFrames);
    this.bufferedFrames = 0;
    this.port.postMessage({ type: 'samples', samples: payload }, [payload.buffer]);
  }

  process(inputs) {
    const input = inputs[0];
    const channelCount = Array.isArray(input) ? input.length : 0;
    const frameCount = channelCount > 0 && input[0] ? input[0].length : 0;

    if (channelCount > 0 && frameCount > 0) {
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        let sample = 0;
        for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
          const channel = input[channelIndex];
          sample += channel ? channel[frameIndex] || 0 : 0;
        }
        this.buffer[this.bufferedFrames] = sample / channelCount;
        this.bufferedFrames += 1;
        if (this.bufferedFrames >= this.batchFrames) {
          this.flushBufferedFrames();
        }
      }
    }

    if (this.pendingFlushIds.length > 0) {
      this.flushBufferedFrames();
      while (this.pendingFlushIds.length > 0) {
        this.port.postMessage({
          type: 'flush-ack',
          flushId: this.pendingFlushIds.shift(),
        });
      }
    }

    return true;
  }
}

registerProcessor('${WORKLET_NAME}', NotebookPcmTapProcessor);
`;

export interface LiveCaptureChunk {
  blob: Blob;
  startedAtMs: number;
  durationMs: number;
}

export interface LiveCaptureHandle {
  sourceHint: SourceHint;
  stopped: Promise<void>;
  stop: () => Promise<void>;
}

interface CreateLiveCaptureHandleOptions {
  audioContext: AudioContext;
  inputNode: AudioNode;
  chunkDurationMs: number;
  sourceHint: SourceHint;
  onChunk: (chunk: LiveCaptureChunk) => Promise<void> | void;
  onError?: (error: unknown) => void;
}

type WorkletPortMessage =
  | {
      type: 'samples';
      samples: Float32Array | ArrayBuffer;
    }
  | {
      type: 'flush-ack';
      flushId: number;
    };

export function buildLiveCaptureChunkFilename(chunkIndex: number): string {
  return `chunk-${chunkIndex}.${LIVE_CAPTURE_FILE_EXTENSION}`;
}

export function resampleAudioFrames(
  samples: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number,
): Float32Array {
  if (samples.length === 0) return new Float32Array(0);
  if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) {
    throw new Error('Input sample rate must be positive.');
  }
  if (!Number.isFinite(outputSampleRate) || outputSampleRate <= 0) {
    throw new Error('Output sample rate must be positive.');
  }
  if (inputSampleRate === outputSampleRate) {
    return samples.slice();
  }

  const outputLength = Math.max(1, Math.round(samples.length * (outputSampleRate / inputSampleRate)));
  const output = new Float32Array(outputLength);
  const ratio = inputSampleRate / outputSampleRate;

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(leftIndex + 1, samples.length - 1);
    const interpolation = sourceIndex - leftIndex;
    const leftSample = samples[leftIndex] ?? 0;
    const rightSample = samples[rightIndex] ?? leftSample;
    output[index] = leftSample + (rightSample - leftSample) * interpolation;
  }

  return output;
}

export function encodeMonoPcm16Wav(samples: Float32Array, sampleRate: number): Blob {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error('Sample rate must be positive.');
  }

  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    const pcmValue = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(44 + index * bytesPerSample, Math.round(pcmValue), true);
  }

  return new Blob([buffer], { type: LIVE_CAPTURE_MIME_TYPE });
}

export async function createLiveCaptureHandle(
  options: CreateLiveCaptureHandleOptions,
): Promise<LiveCaptureHandle> {
  const {
    audioContext,
    inputNode,
    chunkDurationMs,
    sourceHint,
    onChunk,
    onError,
  } = options;
  const tapInput = audioContext.createGain();
  tapInput.gain.value = 1;
  const silentSink = audioContext.createGain();
  silentSink.gain.value = 0;

  inputNode.connect(tapInput);
  silentSink.connect(audioContext.destination);

  const bufferedSegments: Float32Array[] = [];
  const chunkFrameSize = Math.max(1, Math.round((audioContext.sampleRate * chunkDurationMs) / 1000));
  const flushResolvers = new Map<number, () => void>();
  let bufferedFrames = 0;
  let committedFrames = 0;
  let flushId = 0;
  let stopping = false;
  let processingChain: Promise<void> = Promise.resolve();
  let uploadChain: Promise<void> = Promise.resolve();

  let resolveStopped: () => void = () => {};
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });

  const reportError = (error: unknown) => {
    try {
      onError?.(error);
    } catch {
      /* ignore */
    }
  };

  const enqueueProcessing = (task: () => Promise<void> | void) => {
    processingChain = processingChain
      .then(async () => {
        await task();
      })
      .catch((error) => {
        reportError(error);
      });
    return processingChain;
  };

  const queueChunkUpload = (chunk: LiveCaptureChunk) => {
    uploadChain = uploadChain
      .then(async () => {
        await onChunk(chunk);
      })
      .catch((error) => {
        reportError(error);
      });
    return uploadChain;
  };

  const flushBufferedFrames = (frameCount: number) => {
    if (frameCount <= 0) return;
    const monoSamples = consumeBufferedFrames(bufferedSegments, frameCount);
    bufferedFrames = Math.max(0, bufferedFrames - monoSamples.length);
    if (monoSamples.length === 0) return;

    const startedAtMs = framesToMs(committedFrames, audioContext.sampleRate);
    const durationMs = framesToMs(monoSamples.length, audioContext.sampleRate);
    committedFrames += monoSamples.length;

    const resampled = resampleAudioFrames(
      monoSamples,
      audioContext.sampleRate,
      LIVE_CAPTURE_TARGET_SAMPLE_RATE,
    );
    const blob = encodeMonoPcm16Wav(resampled, LIVE_CAPTURE_TARGET_SAMPLE_RATE);
    void queueChunkUpload({
      blob,
      startedAtMs,
      durationMs,
    });
  };

  const handleSamples = (samples: Float32Array) => {
    if (samples.length === 0) return;
    bufferedSegments.push(samples);
    bufferedFrames += samples.length;
    while (bufferedFrames >= chunkFrameSize) {
      flushBufferedFrames(chunkFrameSize);
    }
  };

  let disconnectGraph = () => {
    try {
      inputNode.disconnect(tapInput);
    } catch {
      /* ignore */
    }
    try {
      tapInput.disconnect();
    } catch {
      /* ignore */
    }
    try {
      silentSink.disconnect();
    } catch {
      /* ignore */
    }
  };
  let requestFinalDrain = async () => {};

  try {
    if (!audioContext.audioWorklet || typeof AudioWorkletNode === 'undefined') {
      throw new Error('AudioWorklet is unavailable in this renderer.');
    }

    await ensureTapWorklet(audioContext);

    const tapNode = new AudioWorkletNode(audioContext, WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions: {
        batchFrames: WORKLET_BATCH_FRAMES,
      },
    });

    tapInput.connect(tapNode);
    tapNode.connect(silentSink);

    tapNode.port.onmessage = (event: MessageEvent<WorkletPortMessage>) => {
      const payload = event.data;
      if (!payload || typeof payload !== 'object') return;

      if (payload.type === 'samples') {
        const samples =
          payload.samples instanceof Float32Array
            ? payload.samples
            : payload.samples instanceof ArrayBuffer
              ? new Float32Array(payload.samples)
              : new Float32Array(0);
        void enqueueProcessing(() => {
          handleSamples(samples);
        });
        return;
      }

      if (payload.type === 'flush-ack') {
        const resolver = flushResolvers.get(payload.flushId);
        if (!resolver) return;
        flushResolvers.delete(payload.flushId);
        resolver();
      }
    };

    disconnectGraph = () => {
      try {
        inputNode.disconnect(tapInput);
      } catch {
        /* ignore */
      }
      try {
        tapInput.disconnect();
      } catch {
        /* ignore */
      }
      try {
        tapNode.port.onmessage = null;
      } catch {
        /* ignore */
      }
      try {
        tapNode.disconnect();
      } catch {
        /* ignore */
      }
      try {
        silentSink.disconnect();
      } catch {
        /* ignore */
      }
    };

    requestFinalDrain = async () => {
      flushId += 1;
      const activeFlushId = flushId;

      const flushAck = new Promise<void>((resolve) => {
        flushResolvers.set(activeFlushId, resolve);
      });

      tapNode.port.postMessage({ type: 'flush', flushId: activeFlushId });

      const flushAckTimedOut = await Promise.race([
        flushAck.then(() => false),
        new Promise<boolean>((resolve) => {
          window.setTimeout(() => resolve(true), STOP_FLUSH_TIMEOUT_MS);
        }),
      ]);

      if (flushAckTimedOut) {
        flushResolvers.delete(activeFlushId);
        reportError(new Error('Final audio drain timed out. The last second may be partial.'));
      }
    };
  } catch (error) {
    console.warn('AudioWorklet capture unavailable, falling back to ScriptProcessor.', error);
    const tapNode = audioContext.createScriptProcessor(WORKLET_BATCH_FRAMES, 1, 1);

    tapInput.connect(tapNode);
    tapNode.connect(silentSink);
    tapNode.onaudioprocess = (event: AudioProcessingEvent) => {
      const inputBuffer = event.inputBuffer;
      const channelCount = inputBuffer.numberOfChannels;
      const frameCount = inputBuffer.length;
      if (channelCount <= 0 || frameCount <= 0) return;

      const samples = new Float32Array(frameCount);
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        let sample = 0;
        for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
          sample += inputBuffer.getChannelData(channelIndex)[frameIndex] || 0;
        }
        samples[frameIndex] = sample / channelCount;
      }

      void enqueueProcessing(() => {
        handleSamples(samples);
      });
    };

    disconnectGraph = () => {
      try {
        inputNode.disconnect(tapInput);
      } catch {
        /* ignore */
      }
      try {
        tapInput.disconnect();
      } catch {
        /* ignore */
      }
      try {
        tapNode.onaudioprocess = null;
      } catch {
        /* ignore */
      }
      try {
        tapNode.disconnect();
      } catch {
        /* ignore */
      }
      try {
        silentSink.disconnect();
      } catch {
        /* ignore */
      }
    };

    requestFinalDrain = async () => {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, SCRIPT_PROCESSOR_DRAIN_MS);
      });
    };
  }

  return {
    sourceHint,
    stopped,
    async stop() {
      if (stopping) return stopped;
      stopping = true;
      await requestFinalDrain();

      await processingChain;
      await enqueueProcessing(() => {
        if (bufferedFrames > 0) {
          flushBufferedFrames(bufferedFrames);
        }
      });
      await uploadChain;

      disconnectGraph();
      resolveStopped();
      return stopped;
    },
  };
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function framesToMs(frameCount: number, sampleRate: number): number {
  return Math.max(0, Math.round((frameCount * 1000) / sampleRate));
}

function consumeBufferedFrames(buffers: Float32Array[], frameCount: number): Float32Array {
  const targetFrameCount = Math.max(0, frameCount);
  const output = new Float32Array(targetFrameCount);
  let offset = 0;

  while (offset < targetFrameCount && buffers.length > 0) {
    const current = buffers[0];
    const remaining = targetFrameCount - offset;
    if (current.length <= remaining) {
      output.set(current, offset);
      offset += current.length;
      buffers.shift();
      continue;
    }

    output.set(current.subarray(0, remaining), offset);
    buffers[0] = current.subarray(remaining);
    offset += remaining;
  }

  return offset === targetFrameCount ? output : output.subarray(0, offset);
}

async function ensureTapWorklet(audioContext: AudioContext): Promise<void> {
  const existing = workletLoadByContext.get(audioContext);
  if (existing) {
    await existing;
    return;
  }

  const blob = new Blob([PCM_TAP_WORKLET_SOURCE], { type: 'text/javascript' });
  const workletUrl = URL.createObjectURL(blob);
  const loadPromise = audioContext.audioWorklet
    .addModule(workletUrl)
    .finally(() => {
      URL.revokeObjectURL(workletUrl);
    });

  workletLoadByContext.set(audioContext, loadPromise);

  try {
    await loadPromise;
  } catch (error) {
    workletLoadByContext.delete(audioContext);
    throw error;
  }
}

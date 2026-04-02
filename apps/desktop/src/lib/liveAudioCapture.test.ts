import { describe, expect, it } from 'vitest';

import {
  buildLiveCaptureChunkFilename,
  encodeMonoPcm16Wav,
  LIVE_CAPTURE_MIME_TYPE,
  LIVE_CAPTURE_TARGET_SAMPLE_RATE,
  resampleAudioFrames,
} from './liveAudioCapture';

describe('liveAudioCapture helpers', () => {
  it('builds deterministic wav chunk filenames', () => {
    expect(buildLiveCaptureChunkFilename(0)).toBe('chunk-0.wav');
    expect(buildLiveCaptureChunkFilename(17)).toBe('chunk-17.wav');
  });

  it('resamples mono frames to the target sample rate', () => {
    const source = new Float32Array([0, 0.5, 1, 0.5, 0, -0.5, -1, -0.5]);
    const resampled = resampleAudioFrames(source, 8_000, 4_000);

    expect(Array.from(resampled)).toHaveLength(4);
    expect(resampled[0]).toBeCloseTo(0, 5);
    expect(resampled[1]).toBeCloseTo(1, 5);
    expect(resampled[2]).toBeCloseTo(0, 5);
    expect(resampled[3]).toBeCloseTo(-1, 5);
  });

  it('encodes 16-bit mono wav blobs', async () => {
    const blob = encodeMonoPcm16Wav(new Float32Array([0, 0.5, -0.5]), LIVE_CAPTURE_TARGET_SAMPLE_RATE);
    const buffer = Buffer.from(await blob.arrayBuffer());

    expect(blob.type).toBe(LIVE_CAPTURE_MIME_TYPE);
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(buffer.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(buffer.readUInt32LE(24)).toBe(LIVE_CAPTURE_TARGET_SAMPLE_RATE);
    expect(buffer.readUInt16LE(22)).toBe(1);
    expect(buffer.readUInt16LE(34)).toBe(16);
    expect(buffer.readUInt32LE(40)).toBe(6);
  });
});

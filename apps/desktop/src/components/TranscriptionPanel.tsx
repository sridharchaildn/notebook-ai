import { AudioLines, Brain, CircleStop, LoaderCircle, Mic, MonitorSpeaker, Waves } from 'lucide-react';
import { useState } from 'react';

import type { TranscriptionEngine } from '../lib/api';

export type CaptureMode = 'mic' | 'system';
export type { TranscriptionEngine };

export interface TranscriptionStartOptions {
  captureMode: CaptureMode;
  engine: TranscriptionEngine;
}

interface Props {
  recording: boolean;
  busy: boolean;
  status: string;
  onStart: (options: TranscriptionStartOptions) => void;
  onStop: () => void;
}

export function TranscriptionPanel({
  recording,
  busy,
  status,
  onStart,
  onStop,
}: Props) {
  const [captureMode, setCaptureMode] = useState<CaptureMode>('mic');
  const [engine, setEngine] = useState<TranscriptionEngine>('whisper');

  const captureHint =
    captureMode === 'mic'
      ? 'Uses your microphone only—no screen share. Pick System audio to capture speaker output (requires choosing a screen/window and enabling system audio).'
      : 'The OS will ask you to share a screen or window; enable system audio in that dialog. Your microphone is mixed in when allowed.';

  const engineHint =
    engine === 'whisper'
      ? 'Whisper: OpenAI speech-to-text API (needs an OpenAI key).'
      : 'LLM: sends one full recording when you stop (avoids broken WebM fragments). Sidecar transcodes WebM→WAV with ffmpeg; use an audio-capable model (e.g. openai/gpt-4o-audio-preview).';

  return (
    <section className="transcription-panel">
      <div className="section-title-row">
        <h2>Voice and audio capture</h2>
        {busy ? <LoaderCircle className="spin" size={16} /> : <AudioLines size={16} />}
      </div>

      <div
        className="transcription-mode-toggle"
        role="group"
        aria-label="Capture source"
      >
        <button
          type="button"
          className={`mode-toggle-btn${captureMode === 'mic' ? ' active' : ''}`}
          disabled={recording}
          onClick={() => setCaptureMode('mic')}
        >
          <Mic size={14} aria-hidden />
          Microphone
        </button>
        <button
          type="button"
          className={`mode-toggle-btn${captureMode === 'system' ? ' active' : ''}`}
          disabled={recording}
          onClick={() => setCaptureMode('system')}
        >
          <MonitorSpeaker size={14} aria-hidden />
          System audio
        </button>
      </div>

      <p className="transcription-hint">{captureHint}</p>

      <div className="transcription-engine-label">Transcription</div>
      <div
        className="transcription-mode-toggle transcription-engine-toggle"
        role="group"
        aria-label="Transcription engine"
      >
        <button
          type="button"
          className={`mode-toggle-btn${engine === 'whisper' ? ' active' : ''}`}
          disabled={recording}
          onClick={() => setEngine('whisper')}
        >
          <Waves size={14} aria-hidden />
          Whisper API
        </button>
        <button
          type="button"
          className={`mode-toggle-btn${engine === 'llm' ? ' active' : ''}`}
          disabled={recording}
          onClick={() => setEngine('llm')}
        >
          <Brain size={14} aria-hidden />
          LLM audio
        </button>
      </div>

      <p className="transcription-hint">{engineHint}</p>

      <div className="transcription-actions">
        {recording ? (
          <button type="button" className="solid-btn danger" onClick={onStop}>
            <CircleStop size={15} />
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="solid-btn"
            onClick={() => onStart({ captureMode, engine })}
          >
            <Mic size={15} />
            Start
          </button>
        )}

        <span className={recording ? 'recording-pill live' : 'recording-pill'}>
          {recording ? 'Listening...' : 'Idle'}
        </span>
      </div>

      <div className="transcription-status">{status}</div>
    </section>
  );
}

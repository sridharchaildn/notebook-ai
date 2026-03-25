import { AudioLines, Brain, CircleStop, LoaderCircle, Mic, MonitorSpeaker, Waves } from 'lucide-react';
import { useState } from 'react';

import type { TranscriptionEngine } from '../lib/api';

export type CaptureMode = 'mic' | 'system';
export type CaptureSessionMode = 'notes' | 'interview_assist';
export type { TranscriptionEngine };

export interface TranscriptionStartOptions {
  captureMode: CaptureMode;
  engine: TranscriptionEngine;
  mode: CaptureSessionMode;
}

interface Props {
  recording: boolean;
  busy: boolean;
  status: string;
  onStart: (options: TranscriptionStartOptions) => void;
  onStop: () => void;
  onModeChange?: (mode: CaptureSessionMode) => void;
}

export function TranscriptionPanel({
  recording,
  busy,
  status,
  onStart,
  onStop,
  onModeChange,
}: Props) {
  const [captureMode, setCaptureMode] = useState<CaptureMode>('mic');
  const [engine, setEngine] = useState<TranscriptionEngine>('whisper');
  const [mode, setMode] = useState<CaptureSessionMode>('notes');

  return (
    <section className="transcription-panel">
      {/* Header */}
      <div className="section-title-row">
        <h2>Voice & Audio Capture</h2>
        {busy ? <LoaderCircle className="spin" size={16} /> : <AudioLines size={16} style={{ color: 'var(--primary)' }} />}
      </div>

      {/* Two-column controls */}
      <div className="transcription-controls">
        <div className="transcription-control-group">
          <div className="transcription-control-label">Mode</div>
          <div className="transcription-mode-toggle" role="group" aria-label="Capture mode">
            <button
              type="button"
              className={`mode-toggle-btn${mode === 'notes' ? ' active' : ''}`}
              disabled={recording}
              onClick={() => {
                setMode('notes');
                onModeChange?.('notes');
              }}
            >
              Notes
            </button>
            <button
              type="button"
              className={`mode-toggle-btn${mode === 'interview_assist' ? ' active' : ''}`}
              disabled={recording}
              onClick={() => {
                setMode('interview_assist');
                onModeChange?.('interview_assist');
              }}
            >
              Interview Assist
            </button>
          </div>
        </div>

        {/* Source selection */}
        <div className="transcription-control-group">
          <div className="transcription-control-label">Source</div>
          <div className="transcription-mode-toggle" role="group" aria-label="Capture source">
            <button
              type="button"
              className={`mode-toggle-btn${captureMode === 'mic' ? ' active' : ''}`}
              disabled={recording}
              onClick={() => setCaptureMode('mic')}
            >
              <Mic size={14} aria-hidden />
              Mic
            </button>
            <button
              type="button"
              className={`mode-toggle-btn${captureMode === 'system' ? ' active' : ''}`}
              disabled={recording}
              onClick={() => setCaptureMode('system')}
            >
              <MonitorSpeaker size={14} aria-hidden />
              System
            </button>
          </div>
        </div>

        {/* Engine selection */}
        <div className="transcription-control-group">
          <div className="transcription-control-label">Engine</div>
          <div className="transcription-mode-toggle" role="group" aria-label="Transcription engine">
            <button
              type="button"
              className={`mode-toggle-btn${engine === 'whisper' ? ' active' : ''}`}
              disabled={recording}
              onClick={() => setEngine('whisper')}
            >
              <Waves size={14} aria-hidden />
              Whisper
            </button>
            <button
              type="button"
              className={`mode-toggle-btn${engine === 'llm' ? ' active' : ''}`}
              disabled={recording}
              onClick={() => setEngine('llm')}
            >
              <Brain size={14} aria-hidden />
              LLM
            </button>
          </div>
        </div>
      </div>

      {/* Action row */}
      <div className="transcription-action-row">
        {recording ? (
          <button type="button" className="solid-btn danger" onClick={onStop}>
            <CircleStop size={15} />
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="solid-btn"
            onClick={() => onStart({ captureMode, engine, mode })}
          >
            <Mic size={15} />
            {mode === 'interview_assist' ? 'Start Interview Assist' : 'Start Recording'}
          </button>
        )}

        <span className={recording ? 'recording-pill live' : 'recording-pill'}>
          <span className={recording ? 'recording-dot live' : 'recording-dot'} />
          {recording ? 'Recording' : 'Idle'}
        </span>
      </div>

      {/* Status line */}
      <div className="transcription-status">{status}</div>
    </section>
  );
}

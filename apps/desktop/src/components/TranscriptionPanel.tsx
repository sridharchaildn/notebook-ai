import { AudioLines, Brain, CircleStop, LoaderCircle, Mic, MonitorSpeaker, Waves } from 'lucide-react';
import { useState } from 'react';

import type { TranscriptionEngine } from '../lib/api';

export type CaptureMode = 'mic' | 'system';
export type CaptureSessionMode = 'notes' | 'interview_assist';

export interface TranscriptionStartOptions {
  captureMode: CaptureMode;
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
  const [mode, setMode] = useState<CaptureSessionMode>('notes');

  return (
    <section className="transcription-panel">
      {/* Header */}
      <div className="section-title-row">
        <h2>Voice Capture</h2>
        {busy ? <LoaderCircle className="spin" size={16} /> : <AudioLines size={16} style={{ color: recording ? 'var(--danger)' : 'var(--primary)' }} />}
      </div>

      <div className="transcription-layout-grid">
        {/* Top: Mode & Source Toggles */}
        <div className="transcription-controls-row">
          <div className="setting-block">
            <span className="setting-label">Mode</span>
            <div className="compact-toggle" role="group">
              <button
                type="button"
                className={`compact-toggle-btn${mode === 'notes' ? ' active' : ''}`}
                disabled={recording}
                onClick={() => { setMode('notes'); onModeChange?.('notes'); }}
              >
                Notes
              </button>
              <button
                type="button"
                className={`compact-toggle-btn${mode === 'interview_assist' ? ' active' : ''}`}
                disabled={recording}
                onClick={() => { setMode('interview_assist'); onModeChange?.('interview_assist'); }}
              >
                Interview
              </button>
            </div>
          </div>

          <div className="setting-block">
            <span className="setting-label">Source</span>
            <div className="compact-toggle" role="group">
              <button
                type="button"
                className={`compact-toggle-btn${captureMode === 'mic' ? ' active' : ''}`}
                disabled={recording}
                onClick={() => setCaptureMode('mic')}
              >
                <Mic size={14} /> Mic
              </button>
              <button
                type="button"
                className={`compact-toggle-btn${captureMode === 'system' ? ' active' : ''}`}
                disabled={recording}
                onClick={() => setCaptureMode('system')}
              >
                <MonitorSpeaker size={14} /> System
              </button>
            </div>
          </div>
        </div>

        {/* Bottom: Big Record Button */}
        <div className="transcription-action-main">
          <button
            type="button"
            className={`record-button-giant${recording ? ' recording' : ''}`}
            onClick={() => recording ? onStop() : onStart({ captureMode, mode })}
            aria-label={recording ? 'Stop Capture' : 'Start Capture'}
          >
            {recording ? (
              <>
                <CircleStop size={18} />
                Stop Capture
              </>
            ) : (
              <>
                <Mic size={18} />
                {mode === 'notes' ? 'Start Recording' : 'Start Interview'}
              </>
            )}
            {recording && <div className="recording-rings" />}
          </button>
        </div>
      </div>

      {/* Status Bar */}
      <div className="transcription-status-bar">
        <span className={`status-dot${recording ? ' live' : ''}`} />
        <span className="status-text">{status}</span>
      </div>
    </section>
  );
}

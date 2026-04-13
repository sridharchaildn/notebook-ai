import type {
  CaptureMode,
  CaptureSessionMode,
  NoteContextPreset,
} from '@notebook-ai/contracts';
import { AudioLines, ChevronDown, ChevronUp, CircleStop, LoaderCircle, MessageSquareText, Mic, MonitorSpeaker } from 'lucide-react';
import { useState } from 'react';

export interface TranscriptionStartOptions {
  captureMode: CaptureMode;
  mode: CaptureSessionMode;
}

interface Props {
  recording: boolean;
  busy: boolean;
  status: string;
  elapsedMs?: number;
  warning?: string | null;
  lowLatencyEnabled?: boolean;
  contextPreset?: NoteContextPreset;
  contextText?: string;
  onStart: (options: TranscriptionStartOptions) => void;
  onStop: () => void;
  onModeChange?: (mode: CaptureSessionMode) => void;
}

export function TranscriptionPanel({
  recording,
  busy,
  status,
  elapsedMs = 0,
  warning = null,
  lowLatencyEnabled = false,
  contextPreset,
  contextText,
  onStart,
  onStop,
  onModeChange,
}: Props) {
  const [captureMode, setCaptureMode] = useState<CaptureMode>('mic');
  const [mode, setMode] = useState<CaptureSessionMode>('notes');
  const [isExpanded, setIsExpanded] = useState(!recording);
  const elapsedLabel = formatElapsed(elapsedMs);

  const contextSummary = contextText?.trim()
    ? contextText.trim()
    : contextPreset
      ? `Framing this capture as ${contextPreset}.`
      : null;

  if (!isExpanded) {
    return (
      <section className="transcription-panel transcription-panel--collapsed floating-island">
        <div className="transcription-panel__collapsed-group">
          <div className="transcription-panel__collapsed-status">
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <AudioLines size={16} style={{ color: recording ? 'var(--danger)' : 'var(--primary)' }} />
            )}
            <span className="transcription-panel__collapsed-text">
              {recording ? `Recording ${elapsedLabel}` : 'Ready'}
            </span>
            {recording && <span className="status-dot live" />}
          </div>
          <button
            type="button"
            className="ghost-btn ghost-btn--compact toggle-expand-btn collapse-toggle-btn"
            onClick={() => setIsExpanded(true)}
            aria-label="Expand recording controls"
          >
            <ChevronUp size={16} />
          </button>
        </div>

        <div className="transcription-panel__collapsed-action">
          <button
            type="button"
            className={`record-button-small${recording ? ' recording' : ''}`}
            onClick={() => recording ? onStop() : onStart({ captureMode, mode })}
            aria-label={recording ? 'Stop Capture' : 'Start Capture'}
          >
            {recording ? (
              <CircleStop size={16} />
            ) : (
              <Mic size={16} />
            )}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="transcription-panel floating-island">
      <div className="transcription-panel__header-row">
        <div className="transcription-panel__hero-compact">
          <div className="section-title-row transcription-panel__title-row">
            <h2>{mode === 'notes' ? 'Start Recording' : 'Interview Assist'}</h2>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <AudioLines size={16} style={{ color: recording ? 'var(--danger)' : 'var(--primary)' }} />
            )}
          </div>
        </div>
        <div className="transcription-panel__header-actions">
          <div className={`transcription-panel__live-pill${recording ? ' is-live' : ''}`}>
            <span className={`status-dot${recording ? ' live' : ''}`} />
            {recording ? `Recording ${elapsedLabel}` : 'Ready'}
          </div>
          {lowLatencyEnabled ? <span className="status-pill">Low latency</span> : null}
          <button
            type="button"
            className="ghost-btn ghost-btn--compact toggle-expand-btn collapse-toggle-btn"
            onClick={() => setIsExpanded(false)}
            aria-label="Collapse recording controls"
          >
            <ChevronDown size={16} />
          </button>
        </div>
      </div>

      {contextSummary ? (
        <div className="transcription-panel__context-banner">
          <MessageSquareText size={14} />
          <span>{contextSummary}</span>
        </div>
      ) : null}

      <div className="transcription-layout-grid">
        <div className="transcription-controls-row">
          <div className="setting-block transcription-setting-card">
            <div className="transcription-setting-card__header">
              <span className="setting-label">Mode</span>
            </div>
            <div className="compact-toggle compact-toggle--cards" role="group">
              <button
                type="button"
                className={`compact-toggle-btn${mode === 'notes' ? ' active' : ''}`}
                disabled={recording}
                onClick={() => { setMode('notes'); onModeChange?.('notes'); }}
              >
                <span className="compact-toggle-btn__title">Transcript</span>
              </button>
              <button
                type="button"
                className={`compact-toggle-btn${mode === 'interview_assist' ? ' active' : ''}`}
                disabled={recording}
                onClick={() => { setMode('interview_assist'); onModeChange?.('interview_assist'); }}
              >
                <span className="compact-toggle-btn__title">Interview</span>
              </button>
            </div>
          </div>

          <div className="setting-block transcription-setting-card">
            <div className="transcription-setting-card__header">
              <span className="setting-label">Source</span>
            </div>
            <div className="compact-toggle compact-toggle--cards" role="group">
              <button
                type="button"
                className={`compact-toggle-btn${captureMode === 'mic' ? ' active' : ''}`}
                disabled={recording}
                onClick={() => setCaptureMode('mic')}
              >
                <Mic size={16} />
                <span className="compact-toggle-btn__title">Microphone</span>
              </button>
              <button
                type="button"
                className={`compact-toggle-btn${captureMode === 'system_audio_plus_mic' ? ' active' : ''}`}
                disabled={recording}
                onClick={() => setCaptureMode('system_audio_plus_mic')}
              >
                <MonitorSpeaker size={16} />
                <span className="compact-toggle-btn__title">System audio + mic</span>
              </button>
            </div>
          </div>
        </div>

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

      <div className="transcription-status-bar">
        <span className={`status-dot${recording ? ' live' : ''}`} />
        <span className="status-text">{status}</span>
      </div>
      {warning ? (
        <div className="transcription-status-bar">
          <span className="status-dot" />
          <span className="status-text">{warning}</span>
        </div>
      ) : null}
    </section>
  );
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

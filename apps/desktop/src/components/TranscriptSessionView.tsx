import type {
  NoteContextPreset,
  ProviderId,
  ProviderModel,
  TranscriptSegment,
} from '@notebook-ai/contracts';
import { Maximize2, Minimize2, Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { TranscriptionEngine } from '../lib/api';
import { sourceHintLabel } from '../lib/noteMetadata';
import { ModelPicker, providerLabel } from './ProviderModelPicker';
import { RichMarkdownEditor } from './RichMarkdownEditor';

interface Props {
  title?: string;
  transcript: string;
  segments?: TranscriptSegment[];
  summary?: string;
  summaryBusy?: boolean;
  activeTab: 'transcript' | 'summary';
  contextPreset?: NoteContextPreset;
  contextText?: string;
  controlsCollapsed?: boolean;
  onToggleControls?: () => void;
  connectedProviders: ProviderId[];
  transcriptionEngine: TranscriptionEngine;
  transcriptionProvider: ProviderId;
  transcriptionModel: string;
  transcriptionModels: ProviderModel[];
  transcriptionModelsLoading: boolean;
  transcriptionModelsError: string;
  copilotProvider: ProviderId;
  copilotModel: string;
  copilotModels: ProviderModel[];
  copilotModelsLoading: boolean;
  copilotModelsError: string;
  onTranscriptionEngineChange: (engine: TranscriptionEngine) => void;
  onTranscriptionProviderChange: (provider: ProviderId) => void;
  onTranscriptionModelChange: (model: string) => void;
  onCopilotProviderChange: (provider: ProviderId) => void;
  onCopilotModelChange: (model: string) => void;
  onTabChange: (tab: 'transcript' | 'summary') => void;
  onSummaryChange?: (value: string) => void;
}

export function TranscriptSessionView({
  title,
  transcript,
  segments = [],
  summary = '',
  summaryBusy = false,
  activeTab,
  contextPreset,
  contextText,
  controlsCollapsed = false,
  onToggleControls,
  connectedProviders,
  transcriptionEngine,
  transcriptionProvider,
  transcriptionModel,
  transcriptionModels,
  transcriptionModelsLoading,
  transcriptionModelsError,
  copilotProvider,
  copilotModel,
  copilotModels,
  copilotModelsLoading,
  copilotModelsError,
  onTranscriptionEngineChange,
  onTranscriptionProviderChange,
  onTranscriptionModelChange,
  onCopilotProviderChange,
  onCopilotModelChange,
  onTabChange,
  onSummaryChange,
}: Props) {
  const [quickSetupOpen, setQuickSetupOpen] = useState(false);
  const [showSpeakerSplit, setShowSpeakerSplit] = useState(false);
  const paragraphs = transcript
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const audioProviderLocked = transcriptionEngine === 'whisper';
  const audioProviderValue = audioProviderLocked
    ? 'openai'
    : (connectedProviders.includes(transcriptionProvider) ? transcriptionProvider : connectedProviders[0] ?? '');
  const copilotProviderValue = connectedProviders.includes(copilotProvider)
    ? copilotProvider
    : connectedProviders[0] ?? '';

  useEffect(() => {
    if (segments.length === 0 && showSpeakerSplit) {
      setShowSpeakerSplit(false);
    }
  }, [segments.length, showSpeakerSplit]);

  return (
    <section className="transcript-session-view" aria-live="polite">
      <header className="transcript-session-view__header">
        <div className="transcript-session-view__title-group">
          <span className="transcript-session-view__eyebrow">Transcript</span>
          <h3>{title?.trim() || 'Transcript'}</h3>
          <p>
            {segments.length > 0
              ? 'Plain transcript is shown by default. Turn on Speaker split when you want to separate your mic from captured audio.'
              : 'Readable transcript view with room to scroll and review the full capture.'}
          </p>
        </div>
        <div className="transcript-session-view__pills">
          <button
            type="button"
            className={`ghost-btn ghost-btn--compact${quickSetupOpen ? ' active' : ''}`}
            onClick={() => setQuickSetupOpen((prev) => !prev)}
          >
            <Settings2 size={14} />
            Quick setup
          </button>
          {onToggleControls ? (
            <button type="button" className="ghost-btn ghost-btn--compact" onClick={onToggleControls}>
              {controlsCollapsed ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
              {controlsCollapsed ? 'Show controls' : 'Focus view'}
            </button>
          ) : null}
          <div className="transcript-session-view__tabs" role="tablist" aria-label="Transcript views">
            <button
              type="button"
              className={`ghost-btn ghost-btn--compact${activeTab === 'transcript' ? ' active' : ''}`}
              onClick={() => onTabChange('transcript')}
            >
              Transcript
            </button>
            <button
              type="button"
              className={`ghost-btn ghost-btn--compact${activeTab === 'summary' ? ' active' : ''}`}
              onClick={() => onTabChange('summary')}
            >
              Summary
            </button>
          </div>
          <span className="status-pill">{transcriptionEngine === 'whisper' ? 'Fast' : 'Detailed'}</span>
          {contextPreset ? <span className="status-pill">{contextPreset}</span> : null}
          {segments.length > 0 ? <span className="status-pill">{segments.length} sections</span> : null}
          {activeTab === 'transcript' && segments.length > 0 ? (
            <button
              type="button"
              className={`ghost-btn ghost-btn--compact${showSpeakerSplit ? ' active' : ''}`}
              onClick={() => setShowSpeakerSplit((prev) => !prev)}
            >
              {showSpeakerSplit ? 'Plain transcript' : 'Speaker split'}
            </button>
          ) : null}
        </div>
      </header>
      {contextText?.trim() ? (
        <div className="transcript-session-view__context">{contextText.trim()}</div>
      ) : null}
      {quickSetupOpen ? (
        <section className="transcript-quick-setup">
          <div className="transcript-quick-setup__grid">
            <article className="transcript-quick-setup__card">
              <div className="transcript-quick-setup__card-header">
                <h4>Audio</h4>
                <p>Choose capture quality, provider, and model without leaving this transcript.</p>
              </div>

              <div className="transcript-quick-setup__field">
                <span className="transcript-quick-setup__label">Quality</span>
                <div className="compact-toggle" role="group" aria-label="Audio quality">
                  <button
                    type="button"
                    className={`compact-toggle-btn${transcriptionEngine === 'whisper' ? ' active' : ''}`}
                    onClick={() => onTranscriptionEngineChange('whisper')}
                  >
                    Fast
                  </button>
                  <button
                    type="button"
                    className={`compact-toggle-btn${transcriptionEngine === 'llm' ? ' active' : ''}`}
                    onClick={() => onTranscriptionEngineChange('llm')}
                  >
                    Detailed
                  </button>
                </div>
              </div>

              <label className="transcript-quick-setup__field">
                <span className="transcript-quick-setup__label">Audio provider</span>
                <select
                  className="transcript-quick-setup__select"
                  value={audioProviderValue}
                  disabled={audioProviderLocked || connectedProviders.length === 0}
                  onChange={(event) => onTranscriptionProviderChange(event.target.value as ProviderId)}
                >
                  {audioProviderLocked ? (
                    <option value="openai">OpenAI</option>
                  ) : connectedProviders.length === 0 ? (
                    <option value="">Connect a provider in Settings</option>
                  ) : (
                    connectedProviders.map((provider) => (
                      <option key={provider} value={provider}>
                        {providerLabel[provider]}
                      </option>
                    ))
                  )}
                </select>
                <small className="transcript-quick-setup__hint">
                  {audioProviderLocked
                    ? 'Fast mode currently uses OpenAI audio transcription.'
                    : 'Detailed mode can use any connected provider.'}
                </small>
              </label>

              <ModelPicker
                label="Audio model"
                value={transcriptionModel}
                models={transcriptionModels}
                loading={transcriptionModelsLoading}
                disabled={transcriptionModels.length === 0 && !transcriptionModelsLoading}
                placeholder={audioProviderLocked ? 'Select an OpenAI audio model' : 'Select an audio model'}
                onChange={onTranscriptionModelChange}
              />
              {transcriptionModelsError ? (
                <p className="transcript-quick-setup__error">{transcriptionModelsError}</p>
              ) : null}
            </article>

            <article className="transcript-quick-setup__card">
              <div className="transcript-quick-setup__card-header">
                <h4>Copilot</h4>
                <p>Pick the model used for summaries, action items, and Ask Copilot.</p>
              </div>

              <label className="transcript-quick-setup__field">
                <span className="transcript-quick-setup__label">Copilot provider</span>
                <select
                  className="transcript-quick-setup__select"
                  value={copilotProviderValue}
                  disabled={connectedProviders.length === 0}
                  onChange={(event) => onCopilotProviderChange(event.target.value as ProviderId)}
                >
                  {connectedProviders.length === 0 ? (
                    <option value="">Connect a provider in Settings</option>
                  ) : (
                    connectedProviders.map((provider) => (
                      <option key={provider} value={provider}>
                        {providerLabel[provider]}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <ModelPicker
                label="Copilot model"
                value={copilotModel}
                models={copilotModels}
                loading={copilotModelsLoading}
                disabled={copilotModels.length === 0 && !copilotModelsLoading}
                placeholder="Select a Copilot model"
                onChange={onCopilotModelChange}
              />
              {copilotModelsError ? (
                <p className="transcript-quick-setup__error">{copilotModelsError}</p>
              ) : null}
            </article>
          </div>
        </section>
      ) : null}
      <article className="transcript-session-view__body">
        {activeTab === 'summary' ? (
          summary.trim() || onSummaryChange ? (
            <RichMarkdownEditor
              value={summary}
              onChange={(value) => onSummaryChange?.(value)}
              placeholder={summaryBusy ? 'Generating summary...' : 'Run Summarize in Copilot or edit the summary here.'}
            />
          ) : summaryBusy ? (
            <div className="transcript-session-view__empty">
              Generating summary...
            </div>
          ) : (
            <div className="transcript-session-view__empty">
              Run Summarize in Copilot to save a summary here.
            </div>
          )
        ) : showSpeakerSplit && segments.length > 0 ? (
          <div className="transcript-session-view__segments">
            {segments.map((segment) => (
              <section
                key={segment.id}
                className={`transcript-session-view__segment transcript-session-view__segment--${
                  segment.source_hint === 'me' ? 'me' : 'speaker'
                }`}
              >
                <div className="transcript-session-view__segment-label">{sourceHintLabel(segment.source_hint)}</div>
                <div className="transcript-session-view__segment-text">{segment.text}</div>
              </section>
            ))}
          </div>
        ) : transcript.trim() ? (
          <div className="transcript-session-view__plain">
            {paragraphs.map((paragraph, index) => (
              <p key={`${paragraph.slice(0, 24)}-${index}`}>{paragraph}</p>
            ))}
          </div>
        ) : (
          <div className="transcript-session-view__empty">
            Transcript text will appear here when recording starts.
          </div>
        )}
      </article>
    </section>
  );
}

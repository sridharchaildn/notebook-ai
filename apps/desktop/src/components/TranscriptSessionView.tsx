import type { NoteContextPreset, TranscriptSegment } from '@notebook-ai/contracts';

import { sourceHintLabel } from '../lib/noteMetadata';

interface Props {
  transcript: string;
  segments?: TranscriptSegment[];
  contextPreset?: NoteContextPreset;
  contextText?: string;
}

export function TranscriptSessionView({ transcript, segments = [], contextPreset, contextText }: Props) {
  return (
    <section className="transcript-session-view" aria-live="polite">
      <header className="transcript-session-view__header">
        <h3>Transcript</h3>
        <div className="transcript-session-view__pills">
          <span className="status-pill">Plain text</span>
          {contextPreset ? <span className="status-pill">{contextPreset}</span> : null}
        </div>
      </header>
      {contextText?.trim() ? (
        <div className="transcript-session-view__context">{contextText.trim()}</div>
      ) : null}
      <article className="transcript-session-view__body">
        {segments.length > 0 ? (
          <div className="transcript-session-view__segments">
            {segments.map((segment) => (
              <section key={segment.id} className="transcript-session-view__segment">
                <div className="transcript-session-view__segment-label">{sourceHintLabel(segment.source_hint)}</div>
                <div>{segment.text}</div>
              </section>
            ))}
          </div>
        ) : transcript.trim() ? (
          transcript
        ) : (
          'Transcript text will appear here when recording starts.'
        )}
      </article>
    </section>
  );
}

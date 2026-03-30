interface Props {
  transcript: string;
}

export function TranscriptSessionView({ transcript }: Props) {
  return (
    <section className="transcript-session-view" aria-live="polite">
      <header className="transcript-session-view__header">
        <h3>Transcript</h3>
        <span className="status-pill">Plain text</span>
      </header>
      <article className="transcript-session-view__body">
        {transcript.trim() ? transcript : 'Transcript text will appear here when recording starts.'}
      </article>
    </section>
  );
}

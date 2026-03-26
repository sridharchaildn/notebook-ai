import Link from 'next/link';
import { UICard } from '@notebook-ai/ui';

export default function TermsPage() {
  return (
    <main className="web-shell">
      <section className="container">
        <UICard className="panel">
          <h1>User Agreement</h1>
          <p className="muted">Version 2026-03-25</p>
          <p>
            You are responsible for complying with your organization’s policies and all applicable laws when recording meetings.
          </p>
          <p>
            Notebook AI is provided as-is for note-taking and productivity workflows. You are responsible for provider costs in BYOK mode.
          </p>
          <p>
            This placeholder agreement should be replaced with your legal team’s final terms before public launch.
          </p>
          <Link href="/auth/signup" className="muted">Back to sign up</Link>
        </UICard>
      </section>
    </main>
  );
}

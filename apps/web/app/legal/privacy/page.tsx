import Link from 'next/link';
import { UICard } from '@notebook-ai/ui';

export default function PrivacyPage() {
  return (
    <main className="web-shell">
      <section className="container">
        <UICard className="panel">
          <h1>Privacy Policy</h1>
          <p className="muted">Version 2026-03-25</p>
          <p>
            Notebook AI stores account metadata in the hosted API and keeps transcript content local by default.
            If you enable Google Drive mirror, transcript files are written to your own Drive app folder.
          </p>
          <p>
            Provider credentials are encrypted at rest. You can disconnect providers and remove stored credentials from settings.
          </p>
          <p>
            This placeholder policy should be replaced with your legal team’s final policy before public launch.
          </p>
          <Link href="/auth/signup" className="muted">Back to sign up</Link>
        </UICard>
      </section>
    </main>
  );
}

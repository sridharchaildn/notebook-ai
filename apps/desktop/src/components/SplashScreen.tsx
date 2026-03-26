import { BookOpen, Sparkles } from 'lucide-react';

interface Props {
  onLogin: () => void;
  authBusy?: boolean;
  sessionUserId?: string | null;
  statusMessage?: string;
  manualSignInUrl?: string | null;
}

export function SplashScreen({
  onLogin,
  authBusy = false,
  sessionUserId = null,
  statusMessage = '',
  manualSignInUrl = null,
}: Props) {
  return (
    <div className="splash-screen">
      <div className="splash-ambient" />
      <div className="splash-content">
        <div className="splash-logo">
          <div className="splash-logo-icon">
            <BookOpen size={32} />
          </div>
          <h1 className="splash-title">Notebook AI</h1>
          <p className="splash-subtitle">
            Low-latency meeting notes and interview assist.
            <br />
            Local-first by default, with optional Google Drive mirror.
          </p>
        </div>

        <div className="splash-features">
          <div className="splash-feature">
            <Sparkles size={18} />
            <div>
              <strong>AI-Powered Copilot</strong>
              <span>Summarize, rewrite, and extract action items instantly</span>
            </div>
          </div>
          <div className="splash-feature">
            <BookOpen size={18} />
            <div>
              <strong>Local-First Notes</strong>
              <span>Your notes stay on your machine, fast and private</span>
            </div>
          </div>
        </div>

        <button type="button" className="splash-login-btn" onClick={onLogin} disabled={authBusy}>
          {authBusy ? 'Opening Sign In...' : sessionUserId ? 'Continue to Desktop' : 'Sign In on Web'}
          <span className="splash-login-arrow">→</span>
        </button>

        {statusMessage ? <p className="splash-status">{statusMessage}</p> : null}
        {manualSignInUrl ? (
          <a
            className="splash-manual-link"
            href={manualSignInUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open Sign-In Page
          </a>
        ) : null}

        <p className="splash-version">v0.4.0</p>
      </div>
    </div>
  );
}

import { BookOpen, Sparkles } from 'lucide-react';

interface Props {
  onLogin: () => void;
  onReturnToApp?: (() => void) | null;
  onLogout?: (() => void) | null;
  onMagicLinkEmailChange: (value: string) => void;
  onSendMagicLink: () => void;
  onOpenManualSignIn?: (() => void) | null;
  onCopyManualSignInUrl?: (() => void) | null;
  authBusy?: boolean;
  authPending?: boolean;
  logoutBusy?: boolean;
  sessionUserId?: string | null;
  statusMessage?: string;
  manualSignInUrl?: string | null;
  magicLinkEmail?: string;
}

export function SplashScreen({
  onLogin,
  onReturnToApp = null,
  onLogout = null,
  onMagicLinkEmailChange,
  onSendMagicLink,
  onOpenManualSignIn = null,
  onCopyManualSignInUrl = null,
  authBusy = false,
  authPending = false,
  logoutBusy = false,
  sessionUserId = null,
  statusMessage = '',
  manualSignInUrl = null,
  magicLinkEmail = '',
}: Props) {
  const signedIn = Boolean(sessionUserId);

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

        {signedIn ? (
          <>
            <div className="splash-account-card">
              <strong>Signed in</strong>
              <span>Desktop session active.</span>
            </div>
            <div className="splash-session-actions">
              <button type="button" className="splash-login-btn" onClick={() => onReturnToApp?.()}>
                Open Workspace
                <span className="splash-login-arrow">→</span>
              </button>
              <button
                type="button"
                className="splash-secondary-btn"
                onClick={() => onLogout?.()}
                disabled={logoutBusy}
              >
                {logoutBusy ? 'Signing out...' : 'Sign out'}
              </button>
            </div>
          </>
        ) : (
          <>
            <button type="button" className="splash-login-btn" onClick={onLogin} disabled={authBusy}>
              {authBusy ? 'Opening Google Sign In...' : authPending ? 'Waiting for Sign In...' : 'Continue with Google'}
              <span className="splash-login-arrow">→</span>
            </button>

            <div className="splash-auth-divider">
              <span>or use magic link</span>
            </div>

            <div className="splash-auth-form">
              <input
                className="splash-email-input"
                type="email"
                value={magicLinkEmail}
                onChange={(event) => onMagicLinkEmailChange(event.target.value)}
                placeholder="you@company.com"
                disabled={authBusy}
              />
              <button
                type="button"
                className="splash-secondary-btn"
                onClick={onSendMagicLink}
                disabled={authBusy}
              >
                Send Magic Link
              </button>
            </div>
          </>
        )}

        {statusMessage ? <p className="splash-status">{statusMessage}</p> : null}
        {!signedIn && manualSignInUrl ? (
          <div className="splash-manual-actions">
            <button
              type="button"
              className="splash-manual-link"
              onClick={() => {
                onOpenManualSignIn?.();
              }}
            >
              Open Sign-In Page
            </button>
            <button
              type="button"
              className="splash-manual-link"
              onClick={() => {
                onCopyManualSignInUrl?.();
              }}
            >
              Copy Sign-In URL
            </button>
            <p className="splash-manual-url">{manualSignInUrl}</p>
          </div>
        ) : null}

        <p className="splash-version">v0.4.0</p>
      </div>
    </div>
  );
}

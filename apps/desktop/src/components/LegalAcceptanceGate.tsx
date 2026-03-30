import type { LegalDocument } from '@notebook-ai/contracts';
import { BookOpen, ShieldCheck } from 'lucide-react';

type LegalStage = 'checking' | 'needs_acceptance' | 'error';

interface Props {
  stage: LegalStage;
  documents: LegalDocument[];
  busy?: boolean;
  errorMessage?: string;
  privacyAccepted: boolean;
  termsAccepted: boolean;
  onPrivacyAcceptedChange: (value: boolean) => void;
  onTermsAcceptedChange: (value: boolean) => void;
  onAccept: () => void;
  onRetry: () => void;
}

export function LegalAcceptanceGate({
  stage,
  documents,
  busy = false,
  errorMessage = '',
  privacyAccepted,
  termsAccepted,
  onPrivacyAcceptedChange,
  onTermsAcceptedChange,
  onAccept,
  onRetry,
}: Props) {
  const privacyDoc = documents.find((doc) => doc.type === 'privacy_policy');
  const termsDoc = documents.find((doc) => doc.type === 'user_agreement');

  return (
    <div className="splash-screen">
      <div className="splash-ambient" />
      <div className="legal-gate">
        <div className="legal-gate__hero">
          <div className="splash-logo-icon">
            <ShieldCheck size={32} />
          </div>
          <h1 className="splash-title">Review terms to continue</h1>
          <p className="splash-subtitle">
            Notebook AI needs your acceptance of the latest Privacy Policy and User Agreement before
            entering the desktop app.
          </p>
        </div>

        {stage === 'checking' ? (
          <div className="legal-gate__panel">
            <div className="row">
              <span className="spinner" />
              <span className="muted">Checking legal acceptance...</span>
            </div>
          </div>
        ) : null}

        {stage === 'error' ? (
          <div className="legal-gate__panel">
            <p className="splash-status">{errorMessage || 'Unable to load legal requirements.'}</p>
            <button type="button" className="splash-login-btn" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : null}

        {stage === 'needs_acceptance' ? (
          <div className="legal-gate__panel">
            <div className="legal-gate__docs">
              {[privacyDoc, termsDoc].filter(Boolean).map((doc) => (
                <a
                  key={doc!.type}
                  className="legal-gate__doc"
                  href={doc!.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <BookOpen size={18} />
                  <div>
                    <strong>{doc!.title}</strong>
                    <span>Version {doc!.version}</span>
                  </div>
                </a>
              ))}
            </div>

            <label className="legal-gate__check">
              <input
                type="checkbox"
                checked={privacyAccepted}
                onChange={(event) => onPrivacyAcceptedChange(event.target.checked)}
                disabled={busy}
              />
              <span>
                I agree to the Privacy Policy{privacyDoc ? ` (v${privacyDoc.version})` : ''}.
              </span>
            </label>
            <label className="legal-gate__check">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(event) => onTermsAcceptedChange(event.target.checked)}
                disabled={busy}
              />
              <span>
                I agree to the User Agreement{termsDoc ? ` (v${termsDoc.version})` : ''}.
              </span>
            </label>

            {errorMessage ? <p className="splash-status">{errorMessage}</p> : null}

            <button type="button" className="splash-login-btn" onClick={onAccept} disabled={busy}>
              {busy ? 'Saving...' : 'Accept and Continue'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

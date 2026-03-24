import { BookOpen, Sparkles } from 'lucide-react';

interface Props {
  onLogin: () => void;
}

export function SplashScreen({ onLogin }: Props) {
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
            Your intelligent note-taking companion.
            <br />
            Capture, transcribe, and transform ideas with AI.
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

        <button type="button" className="splash-login-btn" onClick={onLogin}>
          Get Started
          <span className="splash-login-arrow">→</span>
        </button>

        <p className="splash-version">v0.4.0</p>
      </div>
    </div>
  );
}

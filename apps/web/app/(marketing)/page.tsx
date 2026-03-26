import Link from 'next/link';
import { UICard, UIButton, UIPill } from '@notebook-ai/ui';
import { ThemeToggle } from '../components/ThemeToggle';
import { Footer } from '../components/Footer';
import { AppLogo } from '../components/AppLogo';

/* ── Inline SVG icons ── */

function BoltIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" style={{ width: 14, height: 14, flexShrink: 0 }}>
      <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
    </svg>
  );
}

function MiniShieldIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" style={{ width: 13, height: 13, flexShrink: 0 }}>
      <path fillRule="evenodd" d="M8 1.246a14.881 14.881 0 0 1-4.357 2.727 1.497 1.497 0 0 0-.945 1.467c.058 3.627 1.747 6.79 4.948 8.453a.75.75 0 0 0 .708 0c3.2-1.663 4.89-4.826 4.948-8.453a1.497 1.497 0 0 0-.945-1.467A14.881 14.881 0 0 1 8 1.246ZM10.22 7.28a.75.75 0 0 0-1.06-1.06L7.5 7.878 6.84 7.22a.75.75 0 0 0-1.06 1.06l1.25 1.25a.75.75 0 0 0 1.06 0l2.13-2.25Z" clipRule="evenodd" />
    </svg>
  );
}

/* ── Provider logos (inline SVG wordmarks) ── */

function OpenAILogo() {
  return (
    <svg viewBox="0 0 320 80" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="provider-logo">
      {/* OpenAI icon */}
      <path d="M33.1 55.2c-1.3.7-2.7 1.1-4.2 1.3-1.5.2-3 0-4.4-.5-1.4-.5-2.7-1.3-3.8-2.4s-1.9-2.4-2.3-3.9l-.2-.7 12.1-7 6.1 3.5v6.8l-3.3 1.9Zm-18.4-8.2c-.7-1.3-1.1-2.7-1.3-4.2-.2-1.5 0-3 .5-4.4.5-1.4 1.3-2.7 2.4-3.8.5-.5 1.1-1 1.7-1.4l12.1 7v7l-12.1 7-3.3-1.9v-.5Zm20-24.8c1.3-.7 2.7-1.1 4.2-1.3 1.5-.2 3 0 4.4.5 1.4.5 2.7 1.3 3.8 2.4s1.9 2.5 2.3 4l.1.6-12.1 7-6.1-3.5v-6.8l3.4-2.9Zm18.3 8.2c.7 1.3 1.1 2.7 1.3 4.2.2 1.5 0 3-.5 4.4-.5 1.4-1.3 2.7-2.4 3.8-.5.5-1.1 1-1.7 1.4l-12.1-7v-7l12.1-7 3.3 2Zm-18 1.1-5.3-3.1v-6.1l5.3-3.1 5.3 3.1v6.1L35 31.5Z" transform="translate(0, 8) scale(0.9)" />
      {/* OpenAI text */}
      <text x="68" y="52" fontFamily="system-ui, -apple-system, sans-serif" fontSize="32" fontWeight="600" letterSpacing="-0.5">OpenAI</text>
    </svg>
  );
}

function OpenRouterLogo() {
  return (
    <svg viewBox="0 0 320 80" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="provider-logo">
      {/* Router icon - stylized diamond/prism */}
      <path d="M30 16L50 40L30 64L10 40Z" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M30 24L44 40L30 56L16 40Z" fill="currentColor" opacity="0.2" />
      <circle cx="30" cy="40" r="4" fill="currentColor" />
      {/* OpenRouter text */}
      <text x="62" y="52" fontFamily="system-ui, -apple-system, sans-serif" fontSize="30" fontWeight="600" letterSpacing="-0.5">OpenRouter</text>
    </svg>
  );
}

export default function MarketingPage() {
  return (
    <main className="web-shell text-text">
      {/* ── Nav ── */}
      <nav className="nav">
        <div className="nav-inner">
          <Link href="/" className="brand">
            <AppLogo size={26} />
            Notebook AI
          </Link>
          <div className="row">
            <ThemeToggle />
            <Link href="/auth/signin">
              <UIButton variant="ghost">Sign in</UIButton>
            </Link>
            <Link href="/auth/signup">
              <UIButton>Get Started</UIButton>
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="hero-container animate-fade-in-up">
        <div className="hero-section">
          <UIPill>✦ Desktop-first meeting recorder</UIPill>
          <h1 className="hero-title">
            Capture meetings in real time{' '}
            <span className="gradient-text">with low-latency AI notes.</span>
          </h1>
          <p className="hero-subtitle">
            Notebook AI is local-first, blazing fast, and subscription-free. You pay your model provider directly
            when you use AI. Store transcripts on your machine, or mirror to your own Google Drive folder.
          </p>
          <div className="hero-actions">
            <Link href="/auth/signup">
              <UIButton>Start Free →</UIButton>
            </Link>
            <a href="#compare">
              <UIButton variant="ghost">Compare pricing</UIButton>
            </a>
          </div>
          <div className="hero-badges">
            <span className="badge"><CheckIcon /> No subscription</span>
            <span className="badge"><MiniShieldIcon /> Local-first privacy</span>
            <span className="badge"><KeyIcon /> BYOK — Bring your own keys</span>
          </div>
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="container-wide animate-fade-in-up-delay-1">
        <div className="stats-bar">
          <div className="stat-item">
            <span className="stat-number">0ms</span>
            <span className="stat-label">Cloud latency</span>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <span className="stat-number">$0/mo</span>
            <span className="stat-label">No subscription</span>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <span className="stat-number">100%</span>
            <span className="stat-label">Private by default</span>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <span className="stat-number">BYOK</span>
            <span className="stat-label">Your keys, your cost</span>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="container-wide animate-fade-in-up-delay-1">
        <div className="section-header-block">
          <p className="section-label">FEATURES</p>
          <h2 className="section-title">Everything you need, nothing you don&apos;t</h2>
          <p className="section-subtitle">Built for speed, privacy, and simplicity.</p>
        </div>
        <div className="grid-3">
          <UICard className="panel panel-hover">
            <div className="feature-icon">
              <BoltIcon />
            </div>
            <h3>Fast by design</h3>
            <p className="muted">Instant local writes, streaming transcript updates, and responsive AI copilot actions — no cloud round-trips.</p>
          </UICard>
          <UICard className="panel panel-hover">
            <div className="feature-icon">
              <ShieldIcon />
            </div>
            <h3>Completely in your control</h3>
            <p className="muted">Choose local-only storage or local plus Google Drive mirror in your own folder. Your data never leaves your control.</p>
          </UICard>
          <UICard className="panel panel-hover">
            <div className="feature-icon">
              <SparklesIcon />
            </div>
            <h3>AI copilot included</h3>
            <p className="muted">Summarize, rewrite, and extract action items from notes and transcripts in one click with any provider you choose.</p>
          </UICard>
        </div>
      </section>

      {/* ── BYOK / Providers ── */}
      <section className="container-wide animate-fade-in-up-delay-2">
        <UICard className="panel byok-panel">
          <div className="byok-icon">
            <KeyIcon />
          </div>
          <h2 className="byok-title">Bring your own keys</h2>
          <p className="byok-subtitle">
            No subscription fees. Use your own API keys from the providers you trust.
            <br />You pay only for what you use, directly to the provider.
          </p>

          <div className="provider-grid">
            <div className="provider-card">
              <div className="provider-card-icon">
                {/* OpenAI logomark */}
                <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                  <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.042 6.042 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073ZM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494ZM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646ZM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872v.024Zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667Zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66v.018Zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.392.682l-.005 6.72ZM9.4 10.025l2.6-1.5 2.6 1.5v3l-2.6 1.502-2.6-1.502Z" />
                </svg>
              </div>
              <span className="provider-card-name">OPENAI</span>
            </div>
            <div className="provider-card">
              <div className="provider-card-icon">
                {/* OpenRouter logomark - stylized diamond */}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
                  <path d="M12 2L22 12L12 22L2 12Z" strokeLinejoin="round" />
                  <path d="M12 6L18 12L12 18L6 12Z" fill="currentColor" opacity="0.15" strokeLinejoin="round" />
                  <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
                </svg>
              </div>
              <span className="provider-card-name">OPENROUTER</span>
            </div>
            <div className="provider-card provider-card--dashed">
              <div className="provider-card-icon">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="28" height="28">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </div>
              <span className="provider-card-name">MORE SOON</span>
            </div>
          </div>
        </UICard>
      </section>

      {/* ── Comparison ── */}
      <section className="container-wide animate-fade-in-up-delay-2" id="compare">
        <div className="section-header-block">
          <p className="section-label">COMPARE</p>
          <h2 className="section-title">Why teams switch</h2>
          <p className="section-subtitle">See how Notebook AI compares to subscription-based meeting tools.</p>
        </div>
        <UICard className="panel">
          <table className="table">
            <thead>
              <tr>
                <th>Capability</th>
                <th>Notebook AI</th>
                <th>Fireflies / Cluely style tools</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Pricing model</td>
                <td><span className="check-icon"><CheckIcon /> BYOK — no subscription</span></td>
                <td className="neutral-icon">Recurring subscription plans</td>
              </tr>
              <tr>
                <td>Storage control</td>
                <td><span className="check-icon"><CheckIcon /> Local-first + optional Drive mirror</span></td>
                <td className="neutral-icon">Vendor-hosted by default</td>
              </tr>
              <tr>
                <td>AI provider</td>
                <td><span className="check-icon"><CheckIcon /> OpenAI, OpenRouter — your keys</span></td>
                <td className="neutral-icon">Vendor-locked provider</td>
              </tr>
              <tr>
                <td>Privacy</td>
                <td><span className="check-icon"><CheckIcon /> Your machine, your data</span></td>
                <td className="neutral-icon">Third-party cloud storage</td>
              </tr>
            </tbody>
          </table>
          <p className="footer-note">
            Comparison reflects publicly marketed pricing/storage models as of March 2026.
          </p>
        </UICard>
      </section>

      {/* ── Two-up ── */}
      <section className="container-wide grid-2 animate-fade-in-up-delay-3">
        <UICard className="panel panel-hover">
          <div className="feature-icon">
            <ShieldIcon />
          </div>
          <h4>Private by default</h4>
          <p className="muted">Your transcript pipeline is local-first. Google Drive mirror uses your own account and app folder — we never see your files.</p>
        </UICard>
        <UICard className="panel panel-hover">
          <div className="feature-icon">
            <KeyIcon />
          </div>
          <h4>Zero vendor lock-in</h4>
          <p className="muted">Switch between OpenAI and OpenRouter freely. Add your keys in settings and start using AI instantly.</p>
        </UICard>
      </section>

      {/* ── CTA ── */}
      <section className="container-wide animate-fade-in-up-delay-3">
        <div className="cta-section">
          <AppLogo size={40} />
          <h2 className="cta-title">Ready to take notes smarter?</h2>
          <p className="section-subtitle">Get started in under a minute. No credit card required.</p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
            <Link href="/auth/signup">
              <UIButton>Start Free →</UIButton>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <Footer />
    </main>
  );
}

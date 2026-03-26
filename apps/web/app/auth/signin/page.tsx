'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { UIButton, UICard, UIInput } from '@notebook-ai/ui';
import { AppLogo } from '../../components/AppLogo';
import { ThemeToggle } from '../../components/ThemeToggle';
import { buildAuthCallbackUrl, getSupabaseClient, isSupabaseConfigured } from '../../../lib/supabase';

function ArrowLeftIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" style={{ width: 16, height: 16 }}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ width: 16, height: 16 }}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.72 1.22 9.23 3.61l6.9-6.9C35.91 2.34 30.34 0 24 0 14.62 0 6.51 5.4 2.56 13.27l8.06 6.26C12.46 13.47 17.76 9.5 24 9.5Z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.57-.14-3.07-.4-4.5H24v9h12.7c-.55 2.97-2.22 5.49-4.74 7.18l7.29 5.65c4.26-3.93 6.75-9.72 6.75-17.33Z" />
      <path fill="#FBBC05" d="M10.62 28.47A14.5 14.5 0 0 1 9.5 24c0-1.56.28-3.07.78-4.47l-8.06-6.26A23.98 23.98 0 0 0 0 24c0 3.86.92 7.5 2.56 10.73l8.06-6.26Z" />
      <path fill="#34A853" d="M24 48c6.34 0 11.67-2.09 15.56-5.67l-7.29-5.65c-2.03 1.36-4.63 2.18-8.27 2.18-6.24 0-11.54-3.97-13.38-9.53l-8.06 6.26C6.51 42.6 14.62 48 24 48Z" />
    </svg>
  );
}

export default function SignInPage() {
  const [desktopState, setDesktopState] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [hasExistingSession, setHasExistingSession] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setDesktopState(params.get('state'));

    if (!isSupabaseConfigured()) return;
    const supabase = getSupabaseClient();
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) setHasExistingSession(true);
    });
  }, []);

  async function handleGoogleSignIn() {
    if (!isSupabaseConfigured()) {
      setMessage('Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      const supabase = getSupabaseClient();
      const redirectTo = buildAuthCallbackUrl('signin', desktopState);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: {
            prompt: 'select_account',
          },
        },
      });
      if (error) throw error;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to start Google sign-in.');
      setBusy(false);
    }
  }

  async function handleMagicLinkSignIn() {
    if (!isSupabaseConfigured()) {
      setMessage('Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
      return;
    }
    if (!email.trim()) {
      setMessage('Enter your email to receive a sign-in link.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const supabase = getSupabaseClient();
      const redirectTo = buildAuthCallbackUrl('signin', desktopState);
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: redirectTo,
        },
      });
      if (error) throw error;
      setMessage('Magic link sent. Open your email and continue sign-in.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to send magic link.');
    } finally {
      setBusy(false);
    }
  }

  function handleUseCurrentSession() {
    const next = new URLSearchParams();
    next.set('intent', 'signin');
    if (desktopState) next.set('state', desktopState);
    window.location.href = `/auth/callback?${next.toString()}`;
  }

  return (
    <main className="web-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <section className="container animate-fade-in-up" style={{ maxWidth: 540, width: '100%' }}>
        <UICard className="panel" style={{ padding: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <AppLogo size={24} />
              <span style={{ fontWeight: 700, fontSize: '0.88rem', letterSpacing: '-0.02em' }}>Notebook AI</span>
            </div>
            <ThemeToggle />
          </div>

          <h1 style={{ margin: '16px 0 6px', fontSize: '1.5rem', letterSpacing: '-0.02em', fontWeight: 700 }}>
            Sign in
          </h1>
          <p className="muted" style={{ margin: '0 0 24px', fontSize: '0.88rem', lineHeight: 1.6 }}>
            Sign in to continue to Notebook AI{desktopState ? ' desktop' : ''}.
          </p>

          <div className="form-stack">
            <UIButton
              onClick={() => {
                void handleGoogleSignIn();
              }}
              disabled={busy}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              <GoogleIcon />
              Continue with Google
            </UIButton>

            <label>
              Email (magic link)
              <UIInput value={email} onChange={setEmail} placeholder="you@company.com" type="email" />
            </label>
            <UIButton
              variant="ghost"
              onClick={() => {
                void handleMagicLinkSignIn();
              }}
              disabled={busy}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              Send magic link
            </UIButton>

            {hasExistingSession ? (
              <UIButton
                variant="ghost"
                onClick={handleUseCurrentSession}
                disabled={busy}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                Use current signed-in session
              </UIButton>
            ) : null}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                <ArrowLeftIcon /> Back to landing
              </Link>
              <Link href={desktopState ? `/auth/signup?state=${encodeURIComponent(desktopState)}` : '/auth/signup'} style={{ fontSize: '0.84rem', textDecoration: 'underline', color: 'var(--text-secondary)' }}>
                Need an account? Sign up
              </Link>
            </div>

            {message ? (
              <p className={`save-feedback ${message.toLowerCase().includes('sent') ? 'success' : 'error'}`}>
                {message}
              </p>
            ) : null}
          </div>
        </UICard>
      </section>
    </main>
  );
}

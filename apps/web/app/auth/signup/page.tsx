'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { UICard, UIButton, UIInput } from '@notebook-ai/ui';
import { getCurrentSupabaseUser } from '../../../lib/cloud';
import { buildAuthCallbackUrl, getSupabaseClient, isSupabaseConfigured } from '../../../lib/supabase';
import { ThemeToggle } from '../../components/ThemeToggle';
import { AppLogo } from '../../components/AppLogo';

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

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryEmail = params.get('email');
    if (queryEmail) setEmail(queryEmail);
  }, []);

  async function handleGoogleSignUp() {
    if (!isSupabaseConfigured()) {
      setMessage('Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const supabase = getSupabaseClient();
      const redirectTo = buildAuthCallbackUrl('signup');
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
      setMessage(error instanceof Error ? error.message : 'Unable to start Google sign-up.');
      setLoading(false);
    }
  }

  async function handleSubmit() {
    setLoading(true);
    setMessage('');
    try {
      const currentUser = await getCurrentSupabaseUser();
      const next = new URLSearchParams();
      if (currentUser.email) next.set('email', currentUser.email);
      router.push(`/onboarding?${next.toString()}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create account.');
    } finally {
      setLoading(false);
    }
  }

  const backHref = '/auth/signin';

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
            Create your account
          </h1>
          <p className="muted" style={{ margin: '0 0 24px', fontSize: '0.88rem', lineHeight: 1.6 }}>
            Get started with Notebook AI and continue to onboarding.
          </p>

          <div className="form-stack">
            <UIButton
              onClick={() => {
                void handleGoogleSignUp();
              }}
              disabled={loading}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              <GoogleIcon />
              Continue with Google
            </UIButton>

            <label>
              Work email
              <UIInput
                value={email}
                onChange={setEmail}
                placeholder="you@company.com"
                type="email"
              />
            </label>

            <UIButton onClick={() => { void handleSubmit(); }} disabled={loading} style={{ marginTop: 4, width: '100%', justifyContent: 'center' }}>
              {loading ? (
                <><span className="spinner" /> Saving...</>
              ) : (
                'Continue'
              )}
            </UIButton>

            <Link href={backHref} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
              <ArrowLeftIcon /> Back
            </Link>

            {message ? <p className="save-feedback error">{message}</p> : null}
          </div>
        </UICard>
      </section>
    </main>
  );
}

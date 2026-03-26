'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { UICard, UIButton } from '@notebook-ai/ui';
import { AppLogo } from '../../components/AppLogo';
import { ThemeToggle } from '../../components/ThemeToggle';
import {
  completeDesktopExchange,
  fetchLegalAcceptances,
  fetchLegalDocuments,
} from '../../../lib/cloud';
import { getSupabaseClient, isSupabaseConfigured } from '../../../lib/supabase';

export default function AuthCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState('Completing sign in...');
  const [error, setError] = useState('');
  const [stage, setStage] = useState<'session' | 'legal' | 'handoff' | 'done'>('session');
  const [desktopFlow, setDesktopFlow] = useState(false);
  const [manualDesktopLink, setManualDesktopLink] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        if (!isSupabaseConfigured()) {
          throw new Error(
            'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
          );
        }

        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const desktopState = params.get('state');
        const intent = params.get('intent') === 'signup' ? 'signup' : 'signin';
        setDesktopFlow(Boolean(desktopState));
        const supabase = getSupabaseClient();

        if (code) {
          setStage('session');
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        }

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) throw new Error('No signed-in user found. Please try signing in again.');

        localStorage.setItem('notebook_web_user_id', user.id);
        if (user.email) {
          localStorage.setItem('notebook_web_user_email', user.email);
        }

        setStage('legal');
        setStatus('Checking legal acceptance...');
        const [docs, accepted] = await Promise.all([
          fetchLegalDocuments(),
          fetchLegalAcceptances(user.id),
        ]);
        const acceptedPairs = new Set(accepted.map((entry) => `${entry.type}:${entry.version}`));
        const missingDocs = docs.filter((doc) => !acceptedPairs.has(`${doc.type}:${doc.version}`));

        if (missingDocs.length > 0) {
          const next = new URLSearchParams({ user_id: user.id });
          if (desktopState) next.set('state', desktopState);
          if (user.email) next.set('email', user.email);
          setStatus('Legal acceptance required. Redirecting...');
          router.replace(`/auth/signup?${next.toString()}`);
          return;
        }

        if (desktopState) {
          setStage('handoff');
          setStatus('Returning to desktop app...');
          const result = await completeDesktopExchange(desktopState, user.id);
          if (result.deep_link_url) {
            setManualDesktopLink(result.deep_link_url);
            window.location.href = result.deep_link_url;
            window.setTimeout(() => {
              setStatus('If desktop did not open, click Open Desktop App below.');
            }, 1800);
            return;
          }
        }

        const next = new URLSearchParams({ user_id: user.id });
        if (desktopState) next.set('state', desktopState);
        setStage('done');
        setStatus('Sign in complete. Redirecting...');
        router.replace(intent === 'signin' && !desktopState ? '/home' : `/onboarding?${next.toString()}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to complete sign in.');
      }
    })();
  }, [router]);

  return (
    <main className="web-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <section className="container animate-fade-in-up" style={{ maxWidth: 560, width: '100%' }}>
        <UICard className="panel" style={{ padding: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <AppLogo size={24} />
              <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>Notebook AI</span>
            </div>
            <ThemeToggle />
          </div>
          <h1 style={{ margin: '8px 0 6px', fontSize: '1.35rem' }}>Completing authentication</h1>
          <p className="muted" style={{ margin: '0 0 14px' }}>{error || status}</p>

          {!error ? (
            <div style={{ display: 'grid', gap: 8, marginBottom: 4 }}>
              <div
                style={{
                  justifySelf: 'start',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  border: '1px solid var(--border)',
                  borderRadius: 999,
                  padding: '6px 12px',
                  fontSize: '0.78rem',
                  color: 'var(--text-secondary)',
                  background: 'var(--surface-sunken)',
                }}
              >
                <span className="spinner" />
                {stage === 'session'
                  ? 'Validating session'
                  : stage === 'legal'
                    ? 'Checking legal acceptance'
                    : stage === 'handoff'
                      ? 'Preparing desktop handoff'
                      : 'Done'}
              </div>
            </div>
          ) : null}
          {!error && desktopFlow ? (
            <div className="row" style={{ marginTop: 14 }}>
              <a href={manualDesktopLink || 'notebook-ai://open'}>
                <UIButton variant="ghost">Open Desktop App</UIButton>
              </a>
              <Link href="/home">
                <UIButton variant="ghost">Continue on web</UIButton>
              </Link>
            </div>
          ) : null}
          {error ? (
            <div style={{ marginTop: 14 }}>
              <div className="row">
                <Link href="/auth/signin">
                  <UIButton variant="ghost">Back to sign in</UIButton>
                </Link>
                <Link href="/auth/signup">
                  <UIButton variant="ghost">Go to sign up</UIButton>
                </Link>
              </div>
            </div>
          ) : null}
        </UICard>
      </section>
    </main>
  );
}

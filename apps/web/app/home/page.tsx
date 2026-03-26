'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { UIButton, UICard, UIPill } from '@notebook-ai/ui';
import { createDesktopSignInLink } from '../../lib/cloud';
import { getSupabaseClient, isSupabaseConfigured } from '../../lib/supabase';
import { AppLogo } from '../components/AppLogo';
import { ThemeToggle } from '../components/ThemeToggle';

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [openingDesktop, setOpeningDesktop] = useState(false);
  const [desktopStatus, setDesktopStatus] = useState('');
  const [userId, setUserId] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        let resolvedUserId = localStorage.getItem('notebook_web_user_id') || '';
        let resolvedEmail = localStorage.getItem('notebook_web_user_email') || '';

        if (isSupabaseConfigured()) {
          const supabase = getSupabaseClient();
          const { data } = await supabase.auth.getUser();
          if (data.user) {
            resolvedUserId = data.user.id;
            resolvedEmail = data.user.email ?? resolvedEmail;
            localStorage.setItem('notebook_web_user_id', resolvedUserId);
            if (resolvedEmail) {
              localStorage.setItem('notebook_web_user_email', resolvedEmail);
            }
          }
        }

        if (!resolvedUserId) {
          router.replace('/auth/signin');
          return;
        }

        if (!active) return;
        setUserId(resolvedUserId);
        setEmail(resolvedEmail);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      if (isSupabaseConfigured()) {
        const supabase = getSupabaseClient();
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      }
    } finally {
      localStorage.removeItem('notebook_web_user_id');
      localStorage.removeItem('notebook_web_user_email');
      router.replace('/auth/signin');
    }
  }

  async function handleOpenDesktopApp() {
    if (!userId || openingDesktop) return;
    setOpeningDesktop(true);
    setDesktopStatus('');
    try {
      const deepLink = await createDesktopSignInLink(userId);
      setDesktopStatus('Opening desktop app and completing sign in...');
      window.location.href = deepLink;
      window.setTimeout(() => {
        setDesktopStatus('If desktop did not finish sign in, click Open Desktop App again.');
      }, 2200);
    } catch (error) {
      setDesktopStatus(error instanceof Error ? error.message : 'Unable to open desktop app.');
    } finally {
      setOpeningDesktop(false);
    }
  }

  if (loading) {
    return (
      <main className="web-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <section className="container" style={{ maxWidth: 560, width: '100%' }}>
          <UICard className="panel" style={{ padding: 28 }}>
            <div className="row">
              <span className="spinner" />
              <span className="muted">Loading your workspace...</span>
            </div>
          </UICard>
        </section>
      </main>
    );
  }

  return (
    <main className="web-shell">
      <section className="container animate-fade-in-up" style={{ maxWidth: 980 }}>
        <UICard className="panel" style={{ padding: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <AppLogo size={26} />
              <span style={{ fontWeight: 700, fontSize: '0.96rem', letterSpacing: '-0.02em' }}>Notebook AI</span>
            </div>
            <div className="row">
              <UIPill>Web Home</UIPill>
              <ThemeToggle />
            </div>
          </div>

          <h1 style={{ margin: '16px 0 6px', fontSize: '1.78rem', letterSpacing: '-0.03em' }}>
            Welcome back
          </h1>
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
            Manage your account and settings here. Recording and live transcription continue in the desktop app.
          </p>

          <div className="grid-2" style={{ marginTop: 18 }}>
            <UICard className="panel" style={{ padding: 18 }}>
              <h3 style={{ margin: 0 }}>Account</h3>
              <p className="muted" style={{ marginTop: 6 }}>
                {email || 'Signed-in user'}
              </p>
              <p className="muted" style={{ fontSize: '0.78rem', marginTop: 2 }}>
                User ID: {userId}
              </p>
              <div className="row" style={{ marginTop: 14 }}>
                <Link href="/settings">
                  <UIButton>Open Settings</UIButton>
                </Link>
                <UIButton
                  variant="ghost"
                  onClick={() => {
                    void handleSignOut();
                  }}
                  disabled={signingOut}
                >
                  {signingOut ? (
                    <>
                      <span className="spinner" />
                      Signing out...
                    </>
                  ) : (
                    'Sign out'
                  )}
                </UIButton>
              </div>
            </UICard>

            <UICard className="panel" style={{ padding: 18 }}>
              <h3 style={{ margin: 0 }}>Desktop</h3>
              <p className="muted" style={{ marginTop: 6 }}>
                Open Notebook AI desktop to record meetings, run interview assist, and capture local transcripts.
              </p>
              <div className="row" style={{ marginTop: 14 }}>
                <UIButton onClick={() => { void handleOpenDesktopApp(); }} disabled={openingDesktop || !userId}>
                  {openingDesktop ? (
                    <>
                      <span className="spinner" />
                      Opening...
                    </>
                  ) : (
                    'Open Desktop App'
                  )}
                </UIButton>
                <Link href="/onboarding">
                  <UIButton variant="ghost">Run onboarding again</UIButton>
                </Link>
              </div>
              {desktopStatus ? (
                <p className={`save-feedback ${desktopStatus.toLowerCase().includes('unable') ? 'error' : 'success'}`} style={{ marginTop: 10 }}>
                  {desktopStatus}
                </p>
              ) : (
                <p className="muted" style={{ marginTop: 10, fontSize: '0.78rem' }}>
                  If prompted by your browser, allow opening Notebook AI.
                </p>
              )}
            </UICard>
          </div>
        </UICard>
      </section>
    </main>
  );
}

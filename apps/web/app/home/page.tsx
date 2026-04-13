'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { UIButton, UICard, UIPill } from '@notebook-ai/ui';
import { errorMessage, getCurrentSupabaseUser } from '../../lib/cloud';
import { getSupabaseClient, isSupabaseConfigured } from '../../lib/supabase';
import { AppLogo } from '../components/AppLogo';
import { ThemeToggle } from '../components/ThemeToggle';

function AppleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ width: 16, height: 16 }}>
      <path d="M17.566 12.524c.018 1.927 1.694 2.567 1.712 2.575-.014.045-.267.914-.881 1.813-.53.775-1.08 1.548-1.946 1.565-.85.016-1.124-.504-2.097-.504-.972 0-1.276.488-2.08.52-.836.031-1.473-.842-2.007-1.614-1.091-1.578-1.925-4.462-.806-6.402.556-.964 1.55-1.574 2.63-1.59.821-.016 1.596.552 2.096.552.5 0 1.437-.683 2.42-.583.412.017 1.568.167 2.31 1.253-.06.037-1.38.804-1.36 2.015Zm-1.362-5.768c.444-.538.744-1.286.662-2.032-.64.026-1.414.426-1.872.963-.41.474-.768 1.232-.672 1.956.713.056 1.438-.362 1.882-.887Z" />
    </svg>
  );
}

export default function HomePage() {
  const router = useRouter();
  const desktopDownloadUrl = process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL
    ?? 'https://github.com/sridharchaildn/notebook-ai/releases/latest';
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
        const currentUser = await getCurrentSupabaseUser();
        const resolvedUserId = currentUser.id;
        const resolvedEmail = currentUser.email ?? '';

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
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) throw error;
      }
    } finally {
      router.replace('/auth/signin');
    }
  }

  async function handleOpenDesktopApp() {
    if (openingDesktop) return;
    setOpeningDesktop(true);
    setDesktopStatus('');
    try {
      setDesktopStatus('Opening desktop app...');
      window.location.href = 'notebook-ai://open';
      window.setTimeout(() => {
        setDesktopStatus('If Notebook AI did not open, launch it manually from Applications.');
      }, 2200);
    } catch (error) {
      setDesktopStatus(errorMessage(error, 'Unable to open desktop app.'));
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
            Use Notebook AI on your Mac
          </h1>
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
            Your web account is ready. Download the Mac app or open it directly to record meetings and keep transcripts local-first.
          </p>

          <div className="grid-2" style={{ marginTop: 18 }}>
            <UICard className="panel" style={{ padding: 18 }}>
              <h3 style={{ margin: 0 }}>Desktop App</h3>
              <p className="muted" style={{ marginTop: 6 }}>
                Open Notebook AI desktop to record meetings, run interview assist, and capture local transcripts.
              </p>
              <div className="row" style={{ marginTop: 14 }}>
                <a href={desktopDownloadUrl} target="_blank" rel="noreferrer" aria-label="Download Notebook AI for Mac">
                  <UIButton>
                    <AppleIcon />
                    Download for Mac
                  </UIButton>
                </a>
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
              </div>
              {desktopStatus ? (
                <p
                  className={`save-feedback ${/(unable|error|invalid|expired|incomplete|mismatch)/i.test(desktopStatus) ? 'error' : 'success'}`}
                  style={{ marginTop: 10 }}
                >
                  {desktopStatus}
                </p>
              ) : (
                <p className="muted" style={{ marginTop: 10, fontSize: '0.78rem' }}>
                  Download the DMG first if Notebook AI is not installed yet. If prompted by your browser, allow opening the app.
                </p>
              )}
            </UICard>

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
                  <UIButton variant="ghost">Open Settings</UIButton>
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
          </div>
        </UICard>
      </section>
    </main>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { UICard, UIButton, UIInput, UIPill } from '@notebook-ai/ui';
import { cloudApiBaseUrl, completeDesktopExchange, saveProviderByok, saveStoragePreference } from '../../lib/cloud';
import { ThemeToggle } from '../components/ThemeToggle';
import { AppLogo } from '../components/AppLogo';

function KeyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" style={{ width: 20, height: 20 }}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" style={{ width: 20, height: 20 }}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 .75-7.425A4.502 4.502 0 0 0 14.25 7.5a5.252 5.252 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" />
    </svg>
  );
}

export default function OnboardingPage() {
  const [userId, setUserId] = useState('');
  const [desktopState, setDesktopState] = useState<string | null>(null);

  const [openrouterKey, setOpenrouterKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [storageMode, setStorageMode] = useState<'local' | 'local_and_drive'>('local');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextUserId = params.get('user_id') || localStorage.getItem('notebook_web_user_id') || '';
    setUserId(nextUserId);
    setDesktopState(params.get('state'));
  }, []);

  async function handleSaveSettings() {
    if (!userId) {
      setMessage('Missing user id. Please restart signup.');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      if (openaiKey.trim()) {
        await saveProviderByok(userId, 'openai', openaiKey.trim());
      }
      if (openrouterKey.trim()) {
        await saveProviderByok(userId, 'openrouter', openrouterKey.trim());
      }
      await saveStoragePreference(userId, storageMode);

      if (desktopState) {
        const result = await completeDesktopExchange(desktopState, userId);
        if (result.deep_link_url) {
          window.location.href = result.deep_link_url;
          setMessage('Returning to desktop app...');
          return;
        }
      }

      setMessage('Onboarding complete. Download the macOS app to start recording.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save onboarding settings.');
    } finally {
      setBusy(false);
    }
  }

  const cloudBase = cloudApiBaseUrl();
  const hasApiKey = Boolean(openaiKey.trim() || openrouterKey.trim());
  const isDriveMirror = storageMode === 'local_and_drive';

  return (
    <main className="web-shell">
      <section className="container animate-fade-in-up" style={{ maxWidth: 960 }}>
        <UICard className="panel onboarding-shell">
          <div className="onboarding-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <AppLogo size={26} />
              <span style={{ fontWeight: 700, fontSize: '0.92rem', letterSpacing: '-0.02em' }}>Notebook AI</span>
            </div>
            <div className="row">
              <UIPill>{desktopState ? 'Desktop handoff' : 'Web setup'}</UIPill>
              <ThemeToggle />
            </div>
          </div>

          <div className="onboarding-progress-wrap">
            <div className="step-indicator">
              <span className="step-dot done">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" style={{ width: 12, height: 12 }}>
                  <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                </svg>
              </span>
              <span className="step-line done" />
              <span className="step-dot active">2</span>
            </div>
            <span className="muted onboarding-progress-label">Step 2 of 2</span>
          </div>

          <h1 className="onboarding-title">Set up your workspace</h1>
          <p className="onboarding-subtitle">Connect AI and pick storage in two quick steps. You can change everything later in Settings.</p>

          <div className="onboarding-grid">
            <UICard className="panel onboarding-step">
              <div className="onboarding-step-head">
                <div className="onboarding-step-id">1</div>
                <div className="feature-icon" style={{ width: 36, height: 36, marginBottom: 0 }}>
                  <KeyIcon />
                </div>
                <div className="onboarding-step-title-wrap">
                  <h3 className="onboarding-step-title">Connect AI</h3>
                  <p className="onboarding-step-desc">Use OpenAI OAuth or add API keys. OpenRouter is supported now.</p>
                </div>
                <span className={`onboarding-mini-pill ${hasApiKey ? 'success' : ''}`}>{hasApiKey ? 'Key added' : 'Optional'}</span>
              </div>

              <div className="onboarding-step-body">
                <UIButton
                  variant="ghost"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => {
                    if (!userId) return;
                    window.location.href = `${cloudBase}/providers/openai/oauth/start?user_id=${encodeURIComponent(userId)}`;
                  }}
                >
                  Connect OpenAI OAuth
                </UIButton>

                <div className="onboarding-divider">
                  <span>Or use API keys</span>
                </div>

                <label>
                  OpenAI API key (optional)
                  <UIInput value={openaiKey} onChange={setOpenaiKey} placeholder="sk-..." type="password" />
                </label>
                <label>
                  OpenRouter API key (optional)
                  <UIInput value={openrouterKey} onChange={setOpenrouterKey} placeholder="sk-or-v1-..." type="password" />
                </label>
              </div>
            </UICard>

            <UICard className="panel onboarding-step">
              <div className="onboarding-step-head">
                <div className="onboarding-step-id">2</div>
                <div className="feature-icon" style={{ width: 36, height: 36, marginBottom: 0 }}>
                  <CloudIcon />
                </div>
                <div className="onboarding-step-title-wrap">
                  <h3 className="onboarding-step-title">Choose Storage</h3>
                  <p className="onboarding-step-desc">Local-first is fastest. Add Drive mirror if you want cloud backup.</p>
                </div>
                <span className={`onboarding-mini-pill ${isDriveMirror ? 'success' : ''}`}>{isDriveMirror ? 'Drive mirror' : 'Local only'}</span>
              </div>

              <div className="onboarding-step-body">
                <div className="radio-group">
                  <label className={`radio-option${storageMode === 'local' ? ' active' : ''}`}>
                    <input type="radio" name="storage" checked={storageMode === 'local'} onChange={() => setStorageMode('local')} />
                    Local only
                  </label>
                  <label className={`radio-option${storageMode === 'local_and_drive' ? ' active' : ''}`}>
                    <input type="radio" name="storage" checked={storageMode === 'local_and_drive'} onChange={() => setStorageMode('local_and_drive')} />
                    Local + Google Drive mirror
                  </label>
                </div>
                <UIButton
                  variant="ghost"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => {
                    if (!userId) return;
                    window.location.href = `${cloudBase}/integrations/google-drive/oauth/start?user_id=${encodeURIComponent(userId)}`;
                  }}
                >
                  Connect Google Drive
                </UIButton>
                <p className="muted onboarding-hint">Google Drive uses app-folder scope and mirrors your local transcripts.</p>
              </div>
            </UICard>
          </div>

          <div className="onboarding-action-bar">
            <div className="row onboarding-primary-actions">
              <UIButton onClick={() => { void handleSaveSettings(); }} disabled={busy}>
                {busy ? (
                  <><span className="spinner" /> Saving...</>
                ) : desktopState ? (
                  'Finish and Return to Desktop'
                ) : (
                  'Finish Setup'
                )}
              </UIButton>
              <Link href="/settings" className="onboarding-link-action">Open web settings →</Link>
            </div>
            <p className="footer-note" style={{ marginTop: 8 }}>Need the desktop app? Download the macOS DMG from the landing page.</p>
          </div>

          {message ? <p className={`save-feedback ${message.includes('complete') || message.includes('Returning') ? 'success' : 'error'}`} style={{ marginTop: 12 }}>{message}</p> : null}
        </UICard>
      </section>
    </main>
  );
}

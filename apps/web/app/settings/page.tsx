'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { UICard, UIButton, UIInput } from '@notebook-ai/ui';
import { saveProviderByok, saveStoragePreference } from '../../lib/cloud';
import { ThemeToggle } from '../components/ThemeToggle';

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

function CheckCircleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16 }}>
      <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" />
    </svg>
  );
}

export default function SettingsPage() {
  const [userId, setUserId] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [mode, setMode] = useState<'local' | 'local_and_drive'>('local');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setUserId(localStorage.getItem('notebook_web_user_id') || '');
  }, []);

  async function handleSave() {
    if (!userId) {
      setStatus('Set a user id first.');
      return;
    }
    setSaving(true);
    setStatus('');
    try {
      if (openaiKey.trim()) await saveProviderByok(userId, 'openai', openaiKey.trim());
      if (openrouterKey.trim()) await saveProviderByok(userId, 'openrouter', openrouterKey.trim());
      await saveStoragePreference(userId, mode);
      localStorage.setItem('notebook_web_user_id', userId);
      setStatus('saved');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="web-shell">
      <section className="container animate-fade-in-up" style={{ maxWidth: 720 }}>
        {/* Breadcrumb */}
        <nav className="breadcrumb">
          <Link href="/">Home</Link>
          <span className="breadcrumb-sep">›</span>
          <span style={{ color: 'var(--text)' }}>Settings</span>
        </nav>

        <UICard className="panel" style={{ padding: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <div>
              <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', letterSpacing: '-0.02em', fontWeight: 700 }}>Settings</h1>
              <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>Manage your AI providers and storage preferences.</p>
            </div>
            <ThemeToggle />
          </div>

          {/* User */}
          <div className="form-stack" style={{ marginBottom: 28 }}>
            <label>
              User ID
              <UIInput value={userId} onChange={setUserId} placeholder="user id" />
            </label>
          </div>

          {/* AI Providers */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div className="feature-icon" style={{ width: 32, height: 32, marginBottom: 0 }}>
                <KeyIcon />
              </div>
              <span className="section-header" style={{ margin: 0 }}>AI Providers</span>
            </div>
            <div className="form-stack">
              <label>
                OpenAI API key
                <UIInput value={openaiKey} onChange={setOpenaiKey} placeholder="sk-..." type="password" />
              </label>
              <label>
                OpenRouter API key
                <UIInput value={openrouterKey} onChange={setOpenrouterKey} placeholder="sk-or-v1-..." type="password" />
              </label>
            </div>
          </div>

          {/* Storage */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div className="feature-icon" style={{ width: 32, height: 32, marginBottom: 0 }}>
                <CloudIcon />
              </div>
              <span className="section-header" style={{ margin: 0 }}>Storage</span>
            </div>
            <div className="radio-group" style={{ maxWidth: 400 }}>
              <label className={`radio-option${mode === 'local' ? ' active' : ''}`}>
                <input type="radio" checked={mode === 'local'} onChange={() => setMode('local')} />
                Local only
              </label>
              <label className={`radio-option${mode === 'local_and_drive' ? ' active' : ''}`}>
                <input type="radio" checked={mode === 'local_and_drive'} onChange={() => setMode('local_and_drive')} />
                Local + Drive mirror
              </label>
            </div>
          </div>

          {/* Save */}
          <div className="row">
            <UIButton onClick={() => { void handleSave(); }} disabled={saving}>
              {saving ? (
                <><span className="spinner" /> Saving...</>
              ) : (
                'Save'
              )}
            </UIButton>
            {status === 'saved' ? (
              <span className="save-feedback success"><CheckCircleIcon /> Settings saved</span>
            ) : status ? (
              <span className="save-feedback error">{status}</span>
            ) : null}
          </div>
        </UICard>
      </section>
    </main>
  );
}

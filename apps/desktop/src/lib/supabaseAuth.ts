import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseSessionPayload } from '@notebook-ai/contracts';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const DESKTOP_CALLBACK_URL =
  import.meta.env.VITE_DESKTOP_AUTH_CALLBACK_URL ?? 'notebook-ai://auth/callback';
const DESKTOP_SUPABASE_STORAGE_KEY = 'notebook-ai-desktop-auth';
const DESKTOP_PENDING_AUTH_KEY = 'notebook-ai-desktop-auth-pending';

let supabaseClient: SupabaseClient | null = null;

function assertSupabaseConfigured() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
}

function getSecureStorageAdapter() {
  return {
    getItem: async (key: string) => window.notebookDesktop?.getAuthStorageItem?.(key) ?? null,
    setItem: async (key: string, value: string) => {
      await window.notebookDesktop?.setAuthStorageItem?.(key, value);
    },
    removeItem: async (key: string) => {
      await window.notebookDesktop?.removeAuthStorageItem?.(key);
    },
  };
}

function getDesktopSupabaseClient(): SupabaseClient {
  assertSupabaseConfigured();
  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: {
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: DESKTOP_SUPABASE_STORAGE_KEY,
        storage: getSecureStorageAdapter(),
      },
    });
  }
  return supabaseClient;
}

function toSessionPayload(session: Session): SupabaseSessionPayload {
  if (!session.user?.id || !session.access_token || !session.refresh_token) {
    throw new Error('Supabase session is missing required fields.');
  }

  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at ?? null,
    expires_in: session.expires_in ?? null,
    token_type: session.token_type ?? 'bearer',
    user: {
      id: session.user.id,
      email: session.user.email ?? null,
    },
  };
}

function openExternalUrl(url: string): Promise<boolean> {
  if (window.notebookDesktop?.openExternal) {
    return window.notebookDesktop.openExternal(url).then(
      () => true,
      () => false,
    );
  }

  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  return Promise.resolve(Boolean(opened));
}

function readCallbackValue(rawUrl: string, key: string): string | null {
  const parsed = new URL(rawUrl);
  const directValue = parsed.searchParams.get(key);
  if (directValue) return directValue;
  const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  return hashParams.get(key);
}

export function desktopSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export async function hasPendingDesktopAuthFlow(): Promise<boolean> {
  const pending = await window.notebookDesktop?.getAuthStorageItem?.(DESKTOP_PENDING_AUTH_KEY);
  if (pending) return true;
  const verifier = await window.notebookDesktop?.getAuthStorageItem?.(
    `${DESKTOP_SUPABASE_STORAGE_KEY}-code-verifier`,
  );
  return Boolean(verifier);
}

export async function startDesktopGoogleSignIn(): Promise<{ url: string; browserOpened: boolean }> {
  if (window.notebookDesktop?.startGoogleSignIn) {
    const url = await window.notebookDesktop.startGoogleSignIn();
    await window.notebookDesktop?.setAuthStorageItem?.(DESKTOP_PENDING_AUTH_KEY, '1');
    return {
      url,
      browserOpened: await openExternalUrl(url),
    };
  }

  const supabase = getDesktopSupabaseClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: DESKTOP_CALLBACK_URL,
      queryParams: {
        prompt: 'select_account',
      },
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  if (!data?.url) {
    throw new Error('Supabase did not return a sign-in URL.');
  }
  await window.notebookDesktop?.setAuthStorageItem?.(DESKTOP_PENDING_AUTH_KEY, '1');

  return {
    url: data.url,
    browserOpened: await openExternalUrl(data.url),
  };
}

export async function sendDesktopMagicLink(email: string): Promise<void> {
  const trimmed = email.trim();
  if (!trimmed) {
    throw new Error('Enter your email to receive a sign-in link.');
  }

  if (window.notebookDesktop?.sendMagicLink) {
    await window.notebookDesktop?.setAuthStorageItem?.(DESKTOP_PENDING_AUTH_KEY, '1');
    await window.notebookDesktop.sendMagicLink(trimmed);
    return;
  }

  const supabase = getDesktopSupabaseClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: {
      emailRedirectTo: DESKTOP_CALLBACK_URL,
    },
  });
  if (error) throw error;
  await window.notebookDesktop?.setAuthStorageItem?.(DESKTOP_PENDING_AUTH_KEY, '1');
}

export async function completeDesktopAuthCallback(rawUrl: string): Promise<SupabaseSessionPayload | null> {
  const errorDescription =
    readCallbackValue(rawUrl, 'error_description') ?? readCallbackValue(rawUrl, 'error');
  if (errorDescription) {
    throw new Error(decodeURIComponent(errorDescription));
  }

  const code = readCallbackValue(rawUrl, 'code');
  const supabase = getDesktopSupabaseClient();
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    if (!data.session) {
      throw new Error('Supabase did not return a desktop session.');
    }
    await window.notebookDesktop?.removeAuthStorageItem?.(DESKTOP_PENDING_AUTH_KEY);
    return toSessionPayload(data.session);
  }

  const accessToken = readCallbackValue(rawUrl, 'access_token');
  const refreshToken = readCallbackValue(rawUrl, 'refresh_token');
  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
    if (!data.session) {
      throw new Error('Supabase did not return a desktop session.');
    }
    await window.notebookDesktop?.removeAuthStorageItem?.(DESKTOP_PENDING_AUTH_KEY);
    return toSessionPayload(data.session);
  }

  throw new Error('Desktop auth callback did not include a session code or tokens.');
}

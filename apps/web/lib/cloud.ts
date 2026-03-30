import type {
  LegalAcceptanceRecord,
  LegalDocument,
  OAuthStartResponse,
  StoragePreference,
  SupabaseSessionPayload,
} from '@notebook-ai/contracts';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';

const CLOUD_API_URL = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://127.0.0.1:8790';

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function isLegalAcceptanceRequiredError(error: unknown): boolean {
  return errorMessage(error, '').includes('Legal acceptance incomplete');
}

async function parseError(res: Response): Promise<Error> {
  try {
    const payload = (await res.json()) as { detail?: string };
    return new Error(payload.detail || `Request failed: ${res.status}`);
  } catch {
    return new Error(`Request failed: ${res.status}`);
  }
}

async function getCloudSession(): Promise<SupabaseSessionPayload> {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }

  const supabase = getSupabaseClient();
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) throw error;
  if (!session?.access_token || !session.refresh_token || !session.user?.id) {
    throw new Error('No active Supabase session found.');
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

function authHeadersFromSession(session: SupabaseSessionPayload): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

async function getAuthHeaders(sessionPayload?: SupabaseSessionPayload): Promise<Record<string, string>> {
  const session = sessionPayload ?? (await getCloudSession());
  return authHeadersFromSession(session);
}

export async function getCurrentSupabaseSessionPayload(): Promise<SupabaseSessionPayload> {
  return getCloudSession();
}

export async function getCurrentSupabaseUser(): Promise<SupabaseSessionPayload['user']> {
  const session = await getCloudSession();
  return session.user;
}

export async function fetchLegalDocuments(): Promise<LegalDocument[]> {
  const res = await fetch(`${CLOUD_API_URL}/legal/current`, { cache: 'no-store' });
  if (!res.ok) throw await parseError(res);
  const payload = (await res.json()) as { documents: LegalDocument[] };
  return payload.documents;
}

export async function acceptLegalDocuments(
  acceptances: Array<{ type: 'privacy_policy' | 'user_agreement'; version: string }>,
): Promise<LegalAcceptanceRecord[]> {
  const res = await fetch(`${CLOUD_API_URL}/legal/accept`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ acceptances }),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as LegalAcceptanceRecord[];
}

export async function fetchLegalAcceptances(): Promise<LegalAcceptanceRecord[]> {
  const res = await fetch(`${CLOUD_API_URL}/legal/accept`, {
    cache: 'no-store',
    headers: await getAuthHeaders(),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as LegalAcceptanceRecord[];
}

export async function saveProviderByok(
  provider: 'openai' | 'openrouter',
  apiKey: string,
): Promise<void> {
  const res = await fetch(`${CLOUD_API_URL}/providers/byok`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ provider, api_key: apiKey }),
  });
  if (!res.ok) throw await parseError(res);
}

export async function saveStoragePreference(
  mode: StoragePreference['mode'],
  localRoot?: string | null,
): Promise<StoragePreference> {
  const res = await fetch(`${CLOUD_API_URL}/settings/storage`, {
    method: 'PUT',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ mode, local_root: localRoot ?? null }),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as StoragePreference;
}

async function startOAuthFlow(path: string): Promise<OAuthStartResponse> {
  const res = await fetch(`${CLOUD_API_URL}${path}`, {
    method: 'POST',
    headers: await getAuthHeaders(),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as OAuthStartResponse;
}

export async function startOpenAIOAuth(): Promise<OAuthStartResponse> {
  return startOAuthFlow('/providers/openai/oauth/start');
}

export async function startGoogleDriveOAuth(): Promise<OAuthStartResponse> {
  return startOAuthFlow('/integrations/google-drive/oauth/start');
}

export async function logoutCloudSession(): Promise<void> {
  const res = await fetch(`${CLOUD_API_URL}/auth/logout`, {
    method: 'POST',
    headers: await getAuthHeaders(),
  });
  if (!res.ok) throw await parseError(res);
}

export function cloudApiBaseUrl(): string {
  return CLOUD_API_URL;
}

import type {
  DesktopAuthExchangeCompleteResponse,
  DesktopAuthExchangeInitResponse,
  LegalAcceptanceRecord,
  LegalDocument,
  StoragePreference,
} from '@notebook-ai/contracts';

const CLOUD_API_URL = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? 'http://127.0.0.1:8790';

async function parseError(res: Response): Promise<Error> {
  try {
    const payload = (await res.json()) as { detail?: string };
    return new Error(payload.detail || `Request failed: ${res.status}`);
  } catch {
    return new Error(`Request failed: ${res.status}`);
  }
}

export async function fetchLegalDocuments(): Promise<LegalDocument[]> {
  const res = await fetch(`${CLOUD_API_URL}/legal/current`, { cache: 'no-store' });
  if (!res.ok) throw await parseError(res);
  const payload = (await res.json()) as { documents: LegalDocument[] };
  return payload.documents;
}

export async function acceptLegalDocuments(
  userId: string,
  acceptances: Array<{ type: 'privacy_policy' | 'user_agreement'; version: string }>,
): Promise<LegalAcceptanceRecord[]> {
  const res = await fetch(`${CLOUD_API_URL}/legal/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, acceptances }),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as LegalAcceptanceRecord[];
}

export async function fetchLegalAcceptances(userId: string): Promise<LegalAcceptanceRecord[]> {
  const res = await fetch(
    `${CLOUD_API_URL}/legal/accept?user_id=${encodeURIComponent(userId)}`,
    { cache: 'no-store' },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as LegalAcceptanceRecord[];
}

export async function saveProviderByok(userId: string, provider: 'openai' | 'openrouter', apiKey: string): Promise<void> {
  const res = await fetch(`${CLOUD_API_URL}/providers/byok`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, provider, api_key: apiKey }),
  });
  if (!res.ok) throw await parseError(res);
}

export async function saveStoragePreference(
  userId: string,
  mode: StoragePreference['mode'],
  localRoot?: string | null,
): Promise<StoragePreference> {
  const res = await fetch(`${CLOUD_API_URL}/settings/storage`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, mode, local_root: localRoot ?? null }),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as StoragePreference;
}

export async function completeDesktopExchange(state: string, userId: string): Promise<DesktopAuthExchangeCompleteResponse> {
  const res = await fetch(`${CLOUD_API_URL}/auth/desktop/exchange/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, user_id: userId }),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as DesktopAuthExchangeCompleteResponse;
}

export async function initDesktopExchange(deviceLabel = 'Notebook AI Desktop'): Promise<DesktopAuthExchangeInitResponse> {
  const res = await fetch(`${CLOUD_API_URL}/auth/desktop/exchange/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_label: deviceLabel }),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as DesktopAuthExchangeInitResponse;
}

export async function createDesktopSignInLink(userId: string): Promise<string> {
  const init = await initDesktopExchange('Notebook AI Web');
  const complete = await completeDesktopExchange(init.state, userId);
  if (!complete.deep_link_url) {
    throw new Error('Desktop handoff unavailable. Try signing in again.');
  }
  return complete.deep_link_url;
}

export function cloudApiBaseUrl(): string {
  return CLOUD_API_URL;
}

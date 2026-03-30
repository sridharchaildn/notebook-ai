import type {
  CopilotChatRequest,
  AITransformRequest,
  AITransformType,
  ContentFormat,
  DriveConnectionStatus,
  FolderNode,
  InterviewCoachRequest,
  InterviewAssistRequest,
  InterviewTurnsRequest,
  InterviewTurnsResponse,
  LegalAcceptanceRecord,
  LegalDocument,
  ModelUseCase,
  MoveNoteRequest,
  NoteAIContext,
  NoteDocument,
  NoteContextPreset,
  NoteKind,
  NoteSessionData,
  OAuthStartResponse,
  ProviderConnection,
  ProviderId,
  ProviderModel,
  StoragePreference,
  SyncStatus,
  TranscriptionChunkResponse,
} from '@notebook-ai/contracts';

const LOCAL_BASE_URL = import.meta.env.VITE_LOCAL_API_URL ?? 'http://127.0.0.1:8787';
const CLOUD_BASE_URL = import.meta.env.VITE_CLOUD_API_URL ?? 'http://127.0.0.1:8790';

const AUTH_INVALID_EVENT = 'notebook:auth-invalid';
const RENDERER_AUTH_SESSION_KEY = 'notebook-desktop-renderer-session';

export interface DesktopRendererSession {
  accessToken: string;
  expiresAt: number | null;
  userId: string;
  userEmail: string | null;
}

let rendererSessionFallback: DesktopRendererSession | null = null;

export class DesktopAuthExpiredError extends Error {
  constructor(message = 'Session expired. Sign in again.') {
    super(message);
    this.name = 'DesktopAuthExpiredError';
  }
}

function dispatchAuthInvalidEvent(message: string) {
  window.dispatchEvent(new CustomEvent(AUTH_INVALID_EVENT, { detail: message }));
}

export function authInvalidEventName(): string {
  return AUTH_INVALID_EVENT;
}

function parseRendererSessionFallback(rawValue: string | null): DesktopRendererSession | null {
  if (!rawValue) return null;
  try {
    const payload = JSON.parse(rawValue) as Partial<DesktopRendererSession>;
    if (
      typeof payload.accessToken !== 'string' ||
      typeof payload.userId !== 'string' ||
      payload.userId.trim().length === 0
    ) {
      return null;
    }
    return {
      accessToken: payload.accessToken,
      expiresAt: typeof payload.expiresAt === 'number' ? payload.expiresAt : null,
      userId: payload.userId,
      userEmail: typeof payload.userEmail === 'string' ? payload.userEmail : null,
    };
  } catch {
    return null;
  }
}

export function getRendererSessionFallback(): DesktopRendererSession | null {
  if (rendererSessionFallback) return rendererSessionFallback;
  if (typeof window === 'undefined') return null;
  const parsed = parseRendererSessionFallback(window.localStorage.getItem(RENDERER_AUTH_SESSION_KEY));
  rendererSessionFallback = parsed;
  return parsed;
}

export function setRendererSessionFallback(session: DesktopRendererSession | null) {
  rendererSessionFallback = session;
  if (typeof window === 'undefined') return;
  if (session) {
    window.localStorage.setItem(RENDERER_AUTH_SESSION_KEY, JSON.stringify(session));
    return;
  }
  window.localStorage.removeItem(RENDERER_AUTH_SESSION_KEY);
}

async function getDesktopAuthSession() {
  const bridgeSession = await window.notebookDesktop?.getAuthSession?.();
  if (bridgeSession?.userId) {
    setRendererSessionFallback(bridgeSession);
    return bridgeSession;
  }
  return getRendererSessionFallback();
}

async function getDesktopAccessToken(): Promise<string | null> {
  return (await getDesktopAuthSession())?.accessToken ?? null;
}

async function clearDesktopAuthSession(message = 'Session expired. Sign in again.') {
  try {
    await window.notebookDesktop?.clearAuthSession?.();
  } finally {
    setRendererSessionFallback(null);
    dispatchAuthInvalidEvent(message);
  }
}

async function authorizedCloudHeaders(
  contentType: 'json' | 'none' = 'json',
): Promise<Record<string, string>> {
  const accessToken = await getDesktopAccessToken();
  if (!accessToken) {
    throw new DesktopAuthExpiredError('Sign in required.');
  }
  return {
    ...(contentType === 'json' ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${accessToken}`,
  };
}

async function localAuthHeaders(
  contentType: 'json' | 'none' = 'json',
): Promise<Record<string, string>> {
  const accessToken = await getDesktopAccessToken();
  return {
    ...(contentType === 'json' ? { 'Content-Type': 'application/json' } : {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

async function parseResponseError(res: Response, fallback: string): Promise<Error> {
  try {
    const payload = (await res.json()) as { detail?: string };
    if (typeof payload.detail === 'string' && payload.detail.trim().length > 0) {
      return new Error(payload.detail);
    }
  } catch {
    /* ignore */
  }
  return new Error(fallback);
}

async function openExternalUrl(url: string): Promise<void> {
  if (window.notebookDesktop?.openExternal) {
    await window.notebookDesktop.openExternal(url);
    return;
  }

  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    throw new Error('Unable to open browser automatically.');
  }
}

async function cloudFetch(
  input: string,
  init: RequestInit = {},
  fallback = 'Cloud request failed.',
): Promise<Response> {
  const headers = {
    ...(await authorizedCloudHeaders(init.body ? 'json' : 'none')),
    ...(init.headers ?? {}),
  };
  const response = await fetch(`${CLOUD_BASE_URL}${input}`, { ...init, headers });
  if (response.status === 401) {
    await clearDesktopAuthSession();
    throw new DesktopAuthExpiredError();
  }
  if (!response.ok) {
    throw await parseResponseError(response, fallback);
  }
  return response;
}

async function startOAuthFlow(path: string): Promise<OAuthStartResponse> {
  const response = await cloudFetch(
    path,
    {
      method: 'POST',
      headers: await authorizedCloudHeaders('json'),
    },
    'Unable to start OAuth connection.',
  );
  return (await response.json()) as OAuthStartResponse;
}

export interface SaveNoteInput {
  id: string;
  title: string;
  content: string;
  tags: string[];
  provider?: ProviderId;
  model?: string;
  kind?: NoteKind;
  content_format?: ContentFormat;
  session?: NoteSessionData | null;
  context_preset?: NoteContextPreset | null;
  context_text?: string | null;
}

export async function fetchNotes(query = ''): Promise<NoteDocument[]> {
  const res = await fetch(`${LOCAL_BASE_URL}/notes?query=${encodeURIComponent(query)}`, {
    headers: await localAuthHeaders('none'),
  });
  if (!res.ok) {
    throw new Error('Failed to load notes.');
  }
  return (await res.json()) as NoteDocument[];
}

export async function createNote(payload: Omit<SaveNoteInput, 'id'>): Promise<NoteDocument> {
  const res = await fetch(`${LOCAL_BASE_URL}/notes`, {
    method: 'POST',
    headers: await localAuthHeaders('json'),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error('Failed to create note.');
  }
  return (await res.json()) as NoteDocument;
}

export async function updateNote(payload: SaveNoteInput): Promise<NoteDocument> {
  const res = await fetch(`${LOCAL_BASE_URL}/notes/${payload.id}`, {
    method: 'PUT',
    headers: await localAuthHeaders('json'),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error('Failed to save note.');
  }
  return (await res.json()) as NoteDocument;
}

export async function deleteNote(noteId: string): Promise<void> {
  const res = await fetch(`${LOCAL_BASE_URL}/notes/${encodeURIComponent(noteId)}`, {
    method: 'DELETE',
    headers: await localAuthHeaders('none'),
  });
  if (!res.ok) {
    throw new Error('Failed to delete note.');
  }
}

export async function moveNote(noteId: string, payload: MoveNoteRequest): Promise<NoteDocument> {
  const res = await fetch(`${LOCAL_BASE_URL}/notes/${encodeURIComponent(noteId)}/move`, {
    method: 'PATCH',
    headers: await localAuthHeaders('json'),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error('Failed to move note.');
  }
  return (await res.json()) as NoteDocument;
}

export async function fetchFolders(): Promise<FolderNode[]> {
  const res = await fetch(`${LOCAL_BASE_URL}/folders`, {
    headers: await localAuthHeaders('none'),
  });
  if (!res.ok) {
    throw new Error('Failed to load folders.');
  }
  return (await res.json()) as FolderNode[];
}

export async function createFolder(name: string): Promise<FolderNode> {
  const res = await fetch(`${LOCAL_BASE_URL}/folders`, {
    method: 'POST',
    headers: await localAuthHeaders('json'),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    throw new Error('Failed to create folder.');
  }
  return (await res.json()) as FolderNode;
}

export async function renameFolder(folderId: string, name: string): Promise<FolderNode> {
  const res = await fetch(`${LOCAL_BASE_URL}/folders/${encodeURIComponent(folderId)}`, {
    method: 'PATCH',
    headers: await localAuthHeaders('json'),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    throw new Error('Failed to rename folder.');
  }
  return (await res.json()) as FolderNode;
}

export async function deleteFolder(folderId: string): Promise<void> {
  const res = await fetch(`${LOCAL_BASE_URL}/folders/${encodeURIComponent(folderId)}`, {
    method: 'DELETE',
    headers: await localAuthHeaders('none'),
  });
  if (!res.ok) {
    throw new Error('Failed to delete folder.');
  }
}

export async function fetchLocalRoot(): Promise<string> {
  const res = await fetch(`${LOCAL_BASE_URL}/storage/local-root`, {
    headers: await localAuthHeaders('none'),
  });
  if (!res.ok) {
    throw new Error('Failed to load local storage folder.');
  }
  const payload = (await res.json()) as { local_root: string };
  return payload.local_root;
}

export async function setLocalRoot(localRoot: string): Promise<string> {
  const res = await fetch(`${LOCAL_BASE_URL}/storage/local-root`, {
    method: 'PUT',
    headers: await localAuthHeaders('json'),
    body: JSON.stringify({ local_root: localRoot }),
  });
  if (!res.ok) {
    throw new Error('Failed to update local storage folder.');
  }
  const payload = (await res.json()) as { local_root: string };
  return payload.local_root;
}

export async function fetchStoragePreference(): Promise<StoragePreference> {
  const res = await fetch(`${LOCAL_BASE_URL}/storage/preference`, {
    headers: await localAuthHeaders('none'),
  });
  if (!res.ok) {
    throw new Error('Failed to load storage preference.');
  }
  return (await res.json()) as StoragePreference;
}

export async function updateStoragePreference(mode: StoragePreference['mode']): Promise<StoragePreference> {
  const res = await fetch(`${LOCAL_BASE_URL}/storage/preference`, {
    method: 'PUT',
    headers: await localAuthHeaders('json'),
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) {
    throw new Error('Failed to update storage preference.');
  }
  return (await res.json()) as StoragePreference;
}

export async function fetchSyncStatus(): Promise<SyncStatus> {
  const res = await fetch(`${LOCAL_BASE_URL}/sync/status`, {
    headers: await localAuthHeaders('none'),
  });
  if (!res.ok) {
    throw new Error('Failed to load sync status.');
  }
  return (await res.json()) as SyncStatus;
}

export async function runSyncNow(): Promise<SyncStatus> {
  const res = await fetch(`${LOCAL_BASE_URL}/sync/run`, {
    method: 'POST',
    headers: await localAuthHeaders('none'),
  });
  if (!res.ok) {
    throw new Error('Failed to run sync.');
  }
  return (await res.json()) as SyncStatus;
}

export async function fetchGoogleDriveStatus(): Promise<DriveConnectionStatus> {
  const response = await cloudFetch(
    '/integrations/google-drive/status',
    { headers: await authorizedCloudHeaders('none') },
    'Failed to load Google Drive status.',
  );
  return (await response.json()) as DriveConnectionStatus;
}

export async function openGoogleDriveConnect(): Promise<void> {
  const payload = await startOAuthFlow('/integrations/google-drive/oauth/start');
  await openExternalUrl(payload.url);
}

export async function logoutCloudSession(): Promise<void> {
  await cloudFetch(
    '/auth/logout',
    {
      method: 'POST',
      headers: await authorizedCloudHeaders('json'),
    },
    'Unable to sign out of cloud session.',
  );
}

export async function fetchLegalDocuments(): Promise<LegalDocument[]> {
  const res = await fetch(`${CLOUD_BASE_URL}/legal/current`, { cache: 'no-store' });
  if (!res.ok) {
    throw await parseResponseError(res, 'Unable to load legal documents.');
  }
  const payload = (await res.json()) as { documents: LegalDocument[] };
  return payload.documents;
}

export async function fetchLegalAcceptances(): Promise<LegalAcceptanceRecord[]> {
  const response = await cloudFetch(
    '/legal/accept',
    { headers: await authorizedCloudHeaders('none') },
    'Unable to load legal acceptance status.',
  );
  return (await response.json()) as LegalAcceptanceRecord[];
}

export async function acceptLegalDocuments(
  acceptances: Array<{ type: 'privacy_policy' | 'user_agreement'; version: string }>,
): Promise<LegalAcceptanceRecord[]> {
  const response = await cloudFetch(
    '/legal/accept',
    {
      method: 'POST',
      headers: await authorizedCloudHeaders('json'),
      body: JSON.stringify({ acceptances }),
    },
    'Unable to accept legal documents.',
  );
  return (await response.json()) as LegalAcceptanceRecord[];
}

export async function fetchProviderStatus(): Promise<ProviderConnection[]> {
  const [local, cloud] = await Promise.all([
    fetch(`${LOCAL_BASE_URL}/providers/status`)
      .then(async (res) => {
        if (!res.ok) return [] as ProviderConnection[];
        return (await res.json()) as ProviderConnection[];
      })
      .catch(() => [] as ProviderConnection[]),
    cloudFetch('/providers/status', { headers: await authorizedCloudHeaders('none') }, 'Unable to load provider status')
      .then(async (res) => (await res.json()) as ProviderConnection[])
      .catch((error) => {
        if (error instanceof DesktopAuthExpiredError) throw error;
        return [] as ProviderConnection[];
      }),
  ]);

  if (local.length === 0 && cloud.length === 0) {
    throw new Error('Unable to load provider status');
  }

  const merged = new Map<string, ProviderConnection>();
  for (const status of local) {
    merged.set(status.provider, status);
  }
  for (const status of cloud) {
    const existing = merged.get(status.provider);
    if (!existing || (!existing.connected && status.connected)) {
      merged.set(status.provider, status);
    }
  }

  return Array.from(merged.values());
}

export async function fetchProviderModels(
  provider: ProviderId,
  useCase: ModelUseCase,
): Promise<ProviderModel[]> {
  const response = await cloudFetch(
    `/providers/models?provider=${encodeURIComponent(provider)}&use_case=${encodeURIComponent(useCase)}`,
    { headers: await authorizedCloudHeaders('none') },
    'Unable to load provider models.',
  );
  return (await response.json()) as ProviderModel[];
}

export async function storeByok(provider: ProviderId, apiKey: string): Promise<void> {
  await cloudFetch(
    '/providers/byok',
    {
      method: 'POST',
      headers: await authorizedCloudHeaders('json'),
      body: JSON.stringify({
        provider,
        api_key: apiKey,
      }),
    },
    'Unable to save provider key.',
  );

  await fetch(`${LOCAL_BASE_URL}/providers/status/cache`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, via: 'api_key', connected: true }),
  });
}

export async function openOpenAIOAuth(): Promise<void> {
  const payload = await startOAuthFlow('/providers/openai/oauth/start');
  await openExternalUrl(payload.url);
}

export async function disconnectProvider(provider: ProviderId): Promise<void> {
  await cloudFetch(
    `/providers/${encodeURIComponent(provider)}`,
    {
      method: 'DELETE',
      headers: await authorizedCloudHeaders('none'),
    },
    'Unable to disconnect provider.',
  );

  await fetch(`${LOCAL_BASE_URL}/providers/status/cache`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, via: 'api_key', connected: false }),
  });
}

export async function streamTransform(
  noteId: string,
  content: string,
  transform: AITransformType,
  onToken: (chunk: string) => void,
  tone: AITransformRequest['tone'] = 'concise',
  provider?: ProviderId,
  model?: string,
  noteContext?: NoteAIContext | null,
): Promise<void> {
  const res = await fetch(`${LOCAL_BASE_URL}/ai/transform/stream`, {
    method: 'POST',
    headers: await localAuthHeaders('json'),
    body: JSON.stringify({
      note_id: noteId,
      content,
      transform,
      tone,
      provider,
      model,
      note_context: noteContext,
    }),
  });

  if (!res.ok || !res.body) {
    throw new Error('Unable to stream AI output.');
  }

  await consumeSseStream(res, onToken);
}

export async function streamCopilotChat(
  payload: CopilotChatRequest,
  onToken: (chunk: string) => void,
): Promise<void> {
  const res = await fetch(`${LOCAL_BASE_URL}/ai/copilot/chat/stream`, {
    method: 'POST',
    headers: await localAuthHeaders('json'),
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.body) {
    throw new Error('Unable to stream copilot response.');
  }

  await consumeSseStream(res, onToken);
}

export async function streamInterviewAssist(
  payload: InterviewAssistRequest,
  onToken: (chunk: string) => void,
): Promise<void> {
  const res = await fetch(`${LOCAL_BASE_URL}/ai/interview/stream`, {
    method: 'POST',
    headers: await localAuthHeaders('json'),
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.body) {
    throw new Error('Unable to stream interview guidance.');
  }

  await consumeSseStream(res, onToken);
}

export async function fetchInterviewTurns(
  payload: InterviewTurnsRequest,
): Promise<InterviewTurnsResponse> {
  const res = await fetch(`${LOCAL_BASE_URL}/ai/interview/turns`, {
    method: 'POST',
    headers: await localAuthHeaders('json'),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error('Unable to extract interview turns.');
  }

  return (await res.json()) as InterviewTurnsResponse;
}

export async function streamInterviewCoach(
  payload: InterviewCoachRequest,
  onToken: (chunk: string) => void,
): Promise<void> {
  const res = await fetch(`${LOCAL_BASE_URL}/ai/interview/coach/stream`, {
    method: 'POST',
    headers: await localAuthHeaders('json'),
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.body) {
    throw new Error('Unable to stream interview coach response.');
  }

  await consumeSseStream(res, onToken);
}

export type TranscriptionEngine = 'whisper' | 'llm';

function audioExtensionFromMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('webm')) return 'webm';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('x-m4a') || normalized.includes('m4a')) return 'm4a';
  if (normalized.includes('mp4')) return 'mp4';
  if (normalized.includes('flac')) return 'flac';
  return 'webm';
}

export async function transcribeAudioChunk(
  chunk: Blob,
  provider: ProviderId = 'openai',
  engine: TranscriptionEngine = 'whisper',
  segmentId?: number,
  model?: string,
  options?: {
    contextPreset?: NoteContextPreset | null;
    contextText?: string | null;
    sourceHint?: 'me' | 'other_audio' | 'unknown' | null;
  },
): Promise<TranscriptionChunkResponse> {
  const formData = new FormData();
  const extension = audioExtensionFromMimeType(chunk.type);
  formData.append('file', chunk, `chunk-${Date.now()}.${extension}`);
  formData.append('provider', provider);
  formData.append('transcription_mode', engine);
  if (typeof segmentId === 'number') {
    formData.append('segment_id', String(segmentId));
  }
  if (typeof model === 'string' && model.trim().length > 0) {
    formData.append('model', model.trim());
  }
  if (options?.contextPreset) {
    formData.append('context_preset', options.contextPreset);
  }
  if (typeof options?.contextText === 'string' && options.contextText.trim().length > 0) {
    formData.append('context_text', options.contextText.trim());
  }
  if (options?.sourceHint) {
    formData.append('source_hint', options.sourceHint);
  }

  const accessToken = await getDesktopAccessToken();
  const res = await fetch(`${LOCAL_BASE_URL}/transcription/chunk`, {
    method: 'POST',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    body: formData,
  });

  if (!res.ok) {
    let msg = 'Unable to transcribe captured audio.';
    try {
      const errBody = (await res.json()) as { detail?: string | string[] | Record<string, unknown> };
      const d = errBody.detail;
      if (typeof d === 'string') {
        msg = d;
      } else if (Array.isArray(d) && d.length > 0) {
        const first = d[0] as { msg?: string };
        if (typeof first.msg === 'string') {
          msg = first.msg;
        }
      }
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  return (await res.json()) as TranscriptionChunkResponse;
}

async function consumeSseStream(res: Response, onToken: (chunk: string) => void): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('Streaming response body is unavailable.');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const eventLine = line
        .split('\n')
        .find((chunk) => chunk.startsWith('data:'));
      if (!eventLine) continue;

      const payloadEvent = JSON.parse(eventLine.replace(/^data:\s*/, '')) as {
        event: 'token' | 'complete' | 'error';
        data: string;
      };

      if (payloadEvent.event === 'token') {
        onToken(payloadEvent.data);
      }

      if (payloadEvent.event === 'error') {
        throw new Error(payloadEvent.data);
      }
    }
  }
}

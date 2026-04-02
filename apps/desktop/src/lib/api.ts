import type {
  CopilotChatRequest,
  AITransformRequest,
  AITransformType,
  ContentFormat,
  CaptureMode,
  CaptureSessionChunkAck,
  CaptureSessionMode,
  CaptureSessionStartRequest,
  CaptureSessionStatus,
  DriveConnectionStatus,
  FolderNode,
  InterviewCoachRequest,
  InterviewAssistRequest,
  InterviewTurnsRequest,
  InterviewTurnsResponse,
  MarkdownSettings,
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
  TranscriptionPreferences,
  TranscriptionChunkResponse,
  TranscriptionEngine,
} from '@notebook-ai/contracts';
import { buildLiveCaptureChunkFilename, LIVE_CAPTURE_MIME_TYPE } from './liveAudioCapture';

export type { TranscriptionEngine } from '@notebook-ai/contracts';

const LOCAL_BASE_URL = import.meta.env.VITE_LOCAL_API_URL ?? 'http://127.0.0.1:8787';
const CLOUD_BASE_URL = import.meta.env.VITE_CLOUD_API_URL ?? 'http://127.0.0.1:8790';

const AUTH_INVALID_EVENT = 'notebook:auth-invalid';
const LOCAL_DESKTOP_TOKEN_HEADER = 'X-Notebook-Desktop-Token';

export interface DesktopRendererSession {
  accessToken: string;
  expiresAt: number | null;
  userId: string;
  userEmail: string | null;
}

let rendererSessionFallback: DesktopRendererSession | null = null;
let localDesktopTokenFallback: string | null = null;

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

export function getRendererSessionFallback(): DesktopRendererSession | null {
  return rendererSessionFallback;
}

export function setRendererSessionFallback(session: DesktopRendererSession | null) {
  rendererSessionFallback = session;
}

function isRendererSessionExpired(session: DesktopRendererSession | null): boolean {
  return Boolean(session?.expiresAt && session.expiresAt * 1000 <= Date.now() + 5_000);
}

async function getDesktopAuthSession() {
  const bridgeSession = await window.notebookDesktop?.getAuthSession?.();
  if (bridgeSession?.userId) {
    if (isRendererSessionExpired(bridgeSession)) {
      await clearDesktopAuthSession();
      return null;
    }
    setRendererSessionFallback(bridgeSession);
    return bridgeSession;
  }

  const fallbackSession = getRendererSessionFallback();
  if (isRendererSessionExpired(fallbackSession)) {
    await clearDesktopAuthSession();
    return null;
  }
  return fallbackSession;
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
  const desktopToken = await getLocalDesktopToken();
  return {
    ...(contentType === 'json' ? { 'Content-Type': 'application/json' } : {}),
    [LOCAL_DESKTOP_TOKEN_HEADER]: desktopToken,
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

async function getLocalDesktopToken(): Promise<string> {
  if (localDesktopTokenFallback) return localDesktopTokenFallback;
  const bridgeToken = await window.notebookDesktop?.getLocalApiToken?.();
  if (!bridgeToken) {
    throw new Error('Desktop local API token unavailable.');
  }
  localDesktopTokenFallback = bridgeToken;
  return bridgeToken;
}

function isDesktopTokenMismatch(status: number, detail: string | null): boolean {
  if (status !== 401 || !detail) return false;
  const normalized = detail.trim().toLowerCase();
  return normalized.includes('desktop token') && (normalized.includes('missing') || normalized.includes('invalid'));
}

function desktopTokenMismatchMessage(): string {
  return 'Desktop token mismatch. Restart the desktop app, or restart the sidecar with the matching NOTEBOOK_LOCAL_DESKTOP_TOKEN.';
}

async function parseResponseError(res: Response, fallback: string): Promise<Error> {
  let detail: string | null = null;
  try {
    const payload = (await res.json()) as { detail?: string };
    if (typeof payload.detail === 'string' && payload.detail.trim().length > 0) {
      detail = payload.detail.trim();
    }
  } catch {
    /* ignore */
  }
  if (isDesktopTokenMismatch(res.status, detail)) {
    return new Error(desktopTokenMismatchMessage());
  }
  if (detail) {
    return new Error(detail);
  }
  if (res.status === 401) return new Error(desktopTokenMismatchMessage());
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
  folder_id?: string | null;
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
    throw await parseResponseError(res, 'Failed to load notes.');
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
    throw await parseResponseError(res, 'Failed to create note.');
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
    throw await parseResponseError(res, 'Failed to save note.');
  }
  return (await res.json()) as NoteDocument;
}

export async function deleteNote(noteId: string): Promise<void> {
  const res = await fetch(`${LOCAL_BASE_URL}/notes/${encodeURIComponent(noteId)}`, {
    method: 'DELETE',
    headers: await localAuthHeaders('none'),
  });
  if (!res.ok) {
    throw await parseResponseError(res, 'Failed to delete note.');
  }
}

export async function moveNote(noteId: string, payload: MoveNoteRequest): Promise<NoteDocument> {
  const res = await fetch(`${LOCAL_BASE_URL}/notes/${encodeURIComponent(noteId)}/move`, {
    method: 'PATCH',
    headers: await localAuthHeaders('json'),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await parseResponseError(res, 'Failed to move note.');
  }
  return (await res.json()) as NoteDocument;
}

export async function fetchFolders(): Promise<FolderNode[]> {
  const res = await fetch(`${LOCAL_BASE_URL}/folders`, {
    headers: await localAuthHeaders('none'),
  });
  if (!res.ok) {
    throw await parseResponseError(res, 'Failed to load folders.');
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
    throw await parseResponseError(res, 'Failed to create folder.');
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
    throw await parseResponseError(res, 'Failed to rename folder.');
  }
  return (await res.json()) as FolderNode;
}

export async function deleteFolder(folderId: string): Promise<void> {
  const res = await fetch(`${LOCAL_BASE_URL}/folders/${encodeURIComponent(folderId)}`, {
    method: 'DELETE',
    headers: await localAuthHeaders('none'),
  });
  if (!res.ok) {
    throw await parseResponseError(res, 'Failed to delete folder.');
  }
}

export async function fetchLocalRoot(): Promise<string> {
  const res = await fetch(`${LOCAL_BASE_URL}/storage/local-root`, {
    headers: await localAuthHeaders('none'),
  });
  if (!res.ok) {
    throw await parseResponseError(res, 'Failed to load local storage folder.');
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
    throw await parseResponseError(res, 'Failed to update local storage folder.');
  }
  const payload = (await res.json()) as { local_root: string };
  return payload.local_root;
}

export async function fetchStoragePreference(): Promise<StoragePreference> {
  const res = await fetch(`${LOCAL_BASE_URL}/storage/preference`, {
    headers: await localAuthHeaders('none'),
  });
  if (!res.ok) {
    throw await parseResponseError(res, 'Failed to load storage preference.');
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
    throw await parseResponseError(res, 'Failed to update storage preference.');
  }
  return (await res.json()) as StoragePreference;
}

export async function fetchTranscriptionPreferences(): Promise<TranscriptionPreferences> {
  const res = await fetch(`${LOCAL_BASE_URL}/settings/transcription`, {
    headers: await localAuthHeaders('none'),
  });
  if (!res.ok) {
    throw await parseResponseError(res, 'Failed to load transcription settings.');
  }
  return (await res.json()) as TranscriptionPreferences;
}

export async function updateTranscriptionPreferences(
  payload: Omit<TranscriptionPreferences, 'updated_at'>,
): Promise<TranscriptionPreferences> {
  const res = await fetch(`${LOCAL_BASE_URL}/settings/transcription`, {
    method: 'PUT',
    headers: await localAuthHeaders('json'),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await parseResponseError(res, 'Failed to update transcription settings.');
  }
  return (await res.json()) as TranscriptionPreferences;
}

export async function fetchMarkdownSettings(): Promise<MarkdownSettings> {
  const res = await fetch(`${LOCAL_BASE_URL}/settings/markdown`, {
    headers: await localAuthHeaders('none'),
  });
  if (!res.ok) {
    throw await parseResponseError(res, 'Failed to load markdown settings.');
  }
  return (await res.json()) as MarkdownSettings;
}

export async function updateMarkdownSettings(
  payload: Omit<MarkdownSettings, 'updated_at'>,
): Promise<MarkdownSettings> {
  const res = await fetch(`${LOCAL_BASE_URL}/settings/markdown`, {
    method: 'PUT',
    headers: await localAuthHeaders('json'),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await parseResponseError(res, 'Failed to update markdown settings.');
  }
  return (await res.json()) as MarkdownSettings;
}

export async function fetchSyncStatus(): Promise<SyncStatus> {
  const res = await fetch(`${LOCAL_BASE_URL}/sync/status`, {
    headers: await localAuthHeaders('none'),
  });
  if (!res.ok) {
    throw await parseResponseError(res, 'Failed to load sync status.');
  }
  return (await res.json()) as SyncStatus;
}

export async function runSyncNow(): Promise<SyncStatus> {
  const res = await fetch(`${LOCAL_BASE_URL}/sync/run`, {
    method: 'POST',
    headers: await localAuthHeaders('none'),
  });
  if (!res.ok) {
    throw await parseResponseError(res, 'Failed to run sync.');
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

export async function fetchProviderStatus(): Promise<ProviderConnection[]> {
  const response = await fetch(`${LOCAL_BASE_URL}/providers/status`, {
    headers: await localAuthHeaders('none'),
  }).catch(() => null);

  if (!response?.ok) {
    throw response
      ? await parseResponseError(response, 'Unable to load provider status.')
      : new Error('Unable to load provider status.');
  }
  return (await response.json()) as ProviderConnection[];
}

export async function fetchProviderModels(
  provider: ProviderId,
  useCase: ModelUseCase,
): Promise<ProviderModel[]> {
  const response = await fetch(
    `${LOCAL_BASE_URL}/providers/models?provider=${encodeURIComponent(provider)}&use_case=${encodeURIComponent(useCase)}`,
    { headers: await localAuthHeaders('none') },
  );
  if (!response.ok) {
    throw await parseResponseError(response, 'Unable to load provider models.');
  }
  return (await response.json()) as ProviderModel[];
}

export async function storeByok(provider: ProviderId, apiKey: string): Promise<void> {
  const response = await fetch(`${LOCAL_BASE_URL}/providers/byok`, {
    method: 'POST',
    headers: await localAuthHeaders('json'),
    body: JSON.stringify({
      provider,
      api_key: apiKey,
    }),
  });
  if (!response.ok) {
    throw await parseResponseError(response, 'Unable to save provider key.');
  }
}

export async function disconnectProvider(provider: ProviderId): Promise<void> {
  const response = await fetch(`${LOCAL_BASE_URL}/providers/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
    headers: await localAuthHeaders('none'),
  });
  if (!response.ok) {
    throw await parseResponseError(response, 'Unable to disconnect provider.');
  }
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
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${LOCAL_BASE_URL}/ai/transform/stream`, {
    method: 'POST',
    headers: await localAuthHeaders('json'),
    signal,
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
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${LOCAL_BASE_URL}/ai/copilot/chat/stream`, {
    method: 'POST',
    headers: await localAuthHeaders('json'),
    signal,
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

export async function startCaptureSession(
  payload: CaptureSessionStartRequest,
): Promise<CaptureSessionStatus> {
  const res = await fetch(`${LOCAL_BASE_URL}/capture-sessions/start`, {
    method: 'POST',
    headers: await localAuthHeaders('json'),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw await parseResponseError(res, 'Unable to start capture session.');
  }
  return (await res.json()) as CaptureSessionStatus;
}

export async function appendCaptureSessionChunk(
  sessionId: string,
  chunk: Blob,
  chunkIndex: number,
  options?: {
    sourceHint?: 'me' | 'other_audio' | 'unknown';
    startedAtMs?: number;
    durationMs?: number;
  },
): Promise<CaptureSessionChunkAck> {
  const formData = new FormData();
  const filename =
    chunk.type === LIVE_CAPTURE_MIME_TYPE
      ? buildLiveCaptureChunkFilename(chunkIndex)
      : `chunk-${chunkIndex}.${audioExtensionFromMimeType(chunk.type)}`;
  formData.append('file', chunk, filename);
  formData.append('chunk_index', String(chunkIndex));
  formData.append('source_hint', options?.sourceHint ?? 'unknown');
  if (typeof options?.startedAtMs === 'number') {
    formData.append('started_at_ms', String(Math.max(0, Math.round(options.startedAtMs))));
  }
  if (typeof options?.durationMs === 'number') {
    formData.append('duration_ms', String(Math.max(0, Math.round(options.durationMs))));
  }

  const res = await fetch(`${LOCAL_BASE_URL}/capture-sessions/${encodeURIComponent(sessionId)}/chunks`, {
    method: 'POST',
    headers: await localAuthHeaders('none'),
    body: formData,
  });
  if (!res.ok) {
    throw await parseResponseError(res, 'Unable to append captured audio chunk.');
  }
  return (await res.json()) as CaptureSessionChunkAck;
}

export async function finalizeCaptureSession(sessionId: string): Promise<CaptureSessionStatus> {
  const res = await fetch(`${LOCAL_BASE_URL}/capture-sessions/${encodeURIComponent(sessionId)}/finalize`, {
    method: 'POST',
    headers: await localAuthHeaders('none'),
  });
  if (!res.ok) {
    throw await parseResponseError(res, 'Unable to finalize capture session.');
  }
  return (await res.json()) as CaptureSessionStatus;
}

export async function fetchCaptureSessionStatus(sessionId: string): Promise<CaptureSessionStatus> {
  const res = await fetch(`${LOCAL_BASE_URL}/capture-sessions/${encodeURIComponent(sessionId)}`, {
    headers: await localAuthHeaders('none'),
  });
  if (!res.ok) {
    throw await parseResponseError(res, 'Unable to load capture session status.');
  }
  return (await res.json()) as CaptureSessionStatus;
}

export async function retryCaptureSessionRecovery(sessionId: string): Promise<CaptureSessionStatus> {
  const res = await fetch(`${LOCAL_BASE_URL}/capture-sessions/${encodeURIComponent(sessionId)}/retry-recovery`, {
    method: 'POST',
    headers: await localAuthHeaders('none'),
  });
  if (!res.ok) {
    throw await parseResponseError(res, 'Unable to retry capture recovery.');
  }
  return (await res.json()) as CaptureSessionStatus;
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

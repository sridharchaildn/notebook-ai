import type {
  AITransformRequest,
  AITransformType,
  DesktopAuthExchangeCompleteResponse,
  DesktopAuthExchangeInitResponse,
  DesktopAuthExchangePollResponse,
  DriveConnectionStatus,
  FolderNode,
  InterviewCoachRequest,
  InterviewAssistRequest,
  InterviewTurnsRequest,
  InterviewTurnsResponse,
  MoveNoteRequest,
  NoteDocument,
  ProviderConnection,
  ProviderId,
  StoragePreference,
  SyncStatus,
  TranscriptionChunkResponse,
} from '@notebook-ai/contracts';

const LOCAL_BASE_URL = import.meta.env.VITE_LOCAL_API_URL ?? 'http://127.0.0.1:8787';
const CLOUD_BASE_URL = import.meta.env.VITE_CLOUD_API_URL ?? 'http://127.0.0.1:8790';
const CLOUD_USER_ID = import.meta.env.VITE_CLOUD_USER_ID ?? 'local-dev-user';
const WEB_APP_URL = import.meta.env.VITE_WEB_APP_URL ?? 'http://127.0.0.1:3000';

function getDesktopSessionToken(): string | null {
  try {
    return localStorage.getItem('notebook_session_token');
  } catch {
    return null;
  }
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

export interface SaveNoteInput {
  id: string;
  title: string;
  body: string;
  tags: string[];
  provider?: ProviderId;
  model?: string;
}

export async function fetchNotes(query = ''): Promise<NoteDocument[]> {
  const res = await fetch(`${LOCAL_BASE_URL}/notes?query=${encodeURIComponent(query)}`);
  if (!res.ok) {
    throw new Error('Failed to load notes.');
  }
  return (await res.json()) as NoteDocument[];
}

export async function createNote(payload: Omit<SaveNoteInput, 'id'>): Promise<NoteDocument> {
  const res = await fetch(`${LOCAL_BASE_URL}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    headers: { 'Content-Type': 'application/json' },
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
  });
  if (!res.ok) {
    throw new Error('Failed to delete note.');
  }
}

export async function moveNote(noteId: string, payload: MoveNoteRequest): Promise<NoteDocument> {
  const res = await fetch(`${LOCAL_BASE_URL}/notes/${encodeURIComponent(noteId)}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error('Failed to move note.');
  }
  return (await res.json()) as NoteDocument;
}

export async function fetchFolders(): Promise<FolderNode[]> {
  const res = await fetch(`${LOCAL_BASE_URL}/folders`);
  if (!res.ok) {
    throw new Error('Failed to load folders.');
  }
  return (await res.json()) as FolderNode[];
}

export async function createFolder(name: string): Promise<FolderNode> {
  const res = await fetch(`${LOCAL_BASE_URL}/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    headers: { 'Content-Type': 'application/json' },
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
  });
  if (!res.ok) {
    throw new Error('Failed to delete folder.');
  }
}

export async function fetchLocalRoot(): Promise<string> {
  const res = await fetch(`${LOCAL_BASE_URL}/storage/local-root`);
  if (!res.ok) {
    throw new Error('Failed to load local storage folder.');
  }
  const payload = (await res.json()) as { local_root: string };
  return payload.local_root;
}

export async function setLocalRoot(localRoot: string): Promise<string> {
  const res = await fetch(`${LOCAL_BASE_URL}/storage/local-root`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ local_root: localRoot }),
  });
  if (!res.ok) {
    throw new Error('Failed to update local storage folder.');
  }
  const payload = (await res.json()) as { local_root: string };
  return payload.local_root;
}

export async function fetchStoragePreference(): Promise<StoragePreference> {
  const res = await fetch(`${LOCAL_BASE_URL}/storage/preference`);
  if (!res.ok) {
    throw new Error('Failed to load storage preference.');
  }
  return (await res.json()) as StoragePreference;
}

export async function updateStoragePreference(mode: StoragePreference['mode']): Promise<StoragePreference> {
  const res = await fetch(`${LOCAL_BASE_URL}/storage/preference`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) {
    throw new Error('Failed to update storage preference.');
  }
  return (await res.json()) as StoragePreference;
}

export async function fetchSyncStatus(): Promise<SyncStatus> {
  const res = await fetch(`${LOCAL_BASE_URL}/sync/status`);
  if (!res.ok) {
    throw new Error('Failed to load sync status.');
  }
  return (await res.json()) as SyncStatus;
}

export async function runSyncNow(): Promise<SyncStatus> {
  const res = await fetch(`${LOCAL_BASE_URL}/sync/run`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error('Failed to run sync.');
  }
  return (await res.json()) as SyncStatus;
}

export async function fetchGoogleDriveStatus(): Promise<DriveConnectionStatus> {
  const sessionToken = getDesktopSessionToken();
  const query = sessionToken
    ? `session_token=${encodeURIComponent(sessionToken)}`
    : `user_id=${encodeURIComponent(CLOUD_USER_ID)}`;
  const res = await fetch(`${CLOUD_BASE_URL}/integrations/google-drive/status?${query}`);
  if (!res.ok) {
    throw new Error('Failed to load Google Drive status.');
  }
  return (await res.json()) as DriveConnectionStatus;
}

export function openGoogleDriveConnect(): void {
  const sessionToken = getDesktopSessionToken();
  const query = sessionToken
    ? `session_token=${encodeURIComponent(sessionToken)}`
    : `user_id=${encodeURIComponent(CLOUD_USER_ID)}`;
  const url = `${CLOUD_BASE_URL}/integrations/google-drive/oauth/start?${query}`;
  void window.notebookDesktop.openExternal(url);
}

export interface StartDesktopAuthFlowResult {
  authUrl: string;
  state: string;
  browserOpened: boolean;
}

export async function startDesktopAuthFlow(
  deviceLabel = 'Notebook AI Desktop',
): Promise<StartDesktopAuthFlowResult> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);

  let res: Response;
  try {
    res = await fetch(`${CLOUD_BASE_URL}/auth/desktop/exchange/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_label: deviceLabel }),
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new Error(
        `Desktop sign in timed out. Verify cloud API is running at ${CLOUD_BASE_URL}.`,
      );
    }
    throw new Error(
      `Unable to reach cloud API at ${CLOUD_BASE_URL}. Start services/cloud-api first.`,
    );
  } finally {
    window.clearTimeout(timeout);
  }

  if (!res.ok) {
    throw await parseResponseError(res, 'Unable to start desktop sign in.');
  }

  const payload = (await res.json()) as DesktopAuthExchangeInitResponse;
  const authUrl = payload.auth_url || `${WEB_APP_URL}/desktop/auth`;

  let browserOpened = false;
  if (window.notebookDesktop?.openExternal) {
    try {
      await window.notebookDesktop.openExternal(authUrl);
      browserOpened = true;
    } catch {
      browserOpened = false;
    }
  } else {
    browserOpened = false;
  }

  return {
    authUrl,
    state: payload.state,
    browserOpened,
  };
}

export async function pollDesktopAuthState(state: string): Promise<DesktopAuthExchangePollResponse> {
  const res = await fetch(
    `${CLOUD_BASE_URL}/auth/desktop/exchange/poll?state=${encodeURIComponent(state)}`,
  );
  if (!res.ok) {
    throw await parseResponseError(res, 'Unable to poll desktop sign-in status.');
  }
  return (await res.json()) as DesktopAuthExchangePollResponse;
}

export async function completeDesktopAuth(code: string): Promise<DesktopAuthExchangeCompleteResponse> {
  const res = await fetch(`${CLOUD_BASE_URL}/auth/desktop/exchange/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    throw await parseResponseError(res, 'Unable to complete desktop sign in.');
  }
  return (await res.json()) as DesktopAuthExchangeCompleteResponse;
}

export async function fetchProviderStatus(): Promise<ProviderConnection[]> {
  const sessionToken = getDesktopSessionToken();
  const cloudQuery = sessionToken
    ? `session_token=${encodeURIComponent(sessionToken)}`
    : `user_id=${encodeURIComponent(CLOUD_USER_ID)}`;

  const [local, cloud] = await Promise.all([
    fetch(`${LOCAL_BASE_URL}/providers/status`)
      .then(async (res) => {
        if (!res.ok) return [] as ProviderConnection[];
        return (await res.json()) as ProviderConnection[];
      })
      .catch(() => [] as ProviderConnection[]),
    fetch(`${CLOUD_BASE_URL}/providers/status?${cloudQuery}`)
      .then(async (res) => {
        if (!res.ok) return [] as ProviderConnection[];
        return (await res.json()) as ProviderConnection[];
      })
      .catch(() => [] as ProviderConnection[]),
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

export async function storeByok(provider: ProviderId, apiKey: string): Promise<void> {
  const sessionToken = getDesktopSessionToken();
  const res = await fetch(`${CLOUD_BASE_URL}/providers/byok`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider,
      api_key: apiKey,
      user_id: CLOUD_USER_ID,
      session_token: sessionToken,
    }),
  });

  if (!res.ok) {
    throw new Error('Unable to save provider key.');
  }

  await fetch(`${LOCAL_BASE_URL}/providers/status/cache`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, via: 'api_key', connected: true }),
  });
}

export function openOpenAIOAuth(): void {
  const sessionToken = getDesktopSessionToken();
  const query = sessionToken
    ? `session_token=${encodeURIComponent(sessionToken)}`
    : `user_id=${encodeURIComponent(CLOUD_USER_ID)}`;
  const url = `${CLOUD_BASE_URL}/providers/openai/oauth/start?${query}`;
  void window.notebookDesktop.openExternal(url);
}

export async function disconnectProvider(provider: ProviderId): Promise<void> {
  const sessionToken = getDesktopSessionToken();
  const query = sessionToken
    ? `session_token=${encodeURIComponent(sessionToken)}`
    : `user_id=${encodeURIComponent(CLOUD_USER_ID)}`;
  const res = await fetch(
    `${CLOUD_BASE_URL}/providers/${encodeURIComponent(provider)}?${query}`,
    { method: 'DELETE' },
  );

  if (!res.ok) {
    let msg = 'Unable to disconnect provider.';
    try {
      const errBody = (await res.json()) as { detail?: string | string[] };
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
): Promise<void> {
  const res = await fetch(`${LOCAL_BASE_URL}/ai/transform/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note_id: noteId, content, transform, tone }),
  });

  if (!res.ok || !res.body) {
    throw new Error('Unable to stream AI output.');
  }

  const reader = res.body.getReader();
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

      const payload = JSON.parse(eventLine.replace(/^data:\s*/, '')) as {
        event: 'token' | 'complete' | 'error';
        data: string;
      };

      if (payload.event === 'token') {
        onToken(payload.data);
      }

      if (payload.event === 'error') {
        throw new Error(payload.data);
      }
    }
  }
}

export async function streamInterviewAssist(
  payload: InterviewAssistRequest,
  onToken: (chunk: string) => void,
): Promise<void> {
  // Deprecated compatibility path. Prefer fetchInterviewTurns + streamInterviewCoach.
  const res = await fetch(`${LOCAL_BASE_URL}/ai/interview/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.body) {
    throw new Error('Unable to stream interview guidance.');
  }

  const reader = res.body.getReader();
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

export async function fetchInterviewTurns(
  payload: InterviewTurnsRequest,
): Promise<InterviewTurnsResponse> {
  const res = await fetch(`${LOCAL_BASE_URL}/ai/interview/turns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.body) {
    throw new Error('Unable to stream interview coach response.');
  }

  const reader = res.body.getReader();
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
): Promise<TranscriptionChunkResponse> {
  const formData = new FormData();
  const extension = audioExtensionFromMimeType(chunk.type);
  formData.append('file', chunk, `chunk-${Date.now()}.${extension}`);
  formData.append('provider', provider);
  formData.append('transcription_mode', engine);
  if (typeof segmentId === 'number') {
    formData.append('segment_id', String(segmentId));
  }

  const res = await fetch(`${LOCAL_BASE_URL}/transcription/chunk`, {
    method: 'POST',
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

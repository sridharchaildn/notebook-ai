import type {
  AITransformRequest,
  AITransformType,
  NoteDocument,
  ProviderConnection,
  ProviderId,
  TranscriptionChunkResponse,
} from '@notebook-ai/contracts';

const LOCAL_BASE_URL = import.meta.env.VITE_LOCAL_API_URL ?? 'http://127.0.0.1:8787';
const CLOUD_BASE_URL = import.meta.env.VITE_CLOUD_API_URL ?? 'http://127.0.0.1:8790';

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

export async function fetchProviderStatus(): Promise<ProviderConnection[]> {
  const [local, cloud] = await Promise.all([
    fetch(`${LOCAL_BASE_URL}/providers/status`)
      .then(async (res) => {
        if (!res.ok) return [] as ProviderConnection[];
        return (await res.json()) as ProviderConnection[];
      })
      .catch(() => [] as ProviderConnection[]),
    fetch(`${CLOUD_BASE_URL}/providers/status?user_id=local-dev-user`)
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
  const res = await fetch(`${CLOUD_BASE_URL}/providers/byok`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, api_key: apiKey, user_id: 'local-dev-user' }),
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
  const url = `${CLOUD_BASE_URL}/providers/openai/oauth/start?user_id=local-dev-user`;
  void window.notebookDesktop.openExternal(url);
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

export type TranscriptionEngine = 'whisper' | 'llm';

export async function transcribeAudioChunk(
  chunk: Blob,
  provider: ProviderId = 'openai',
  engine: TranscriptionEngine = 'whisper',
): Promise<TranscriptionChunkResponse> {
  const formData = new FormData();
  formData.append('file', chunk, `chunk-${Date.now()}.webm`);
  formData.append('provider', provider);
  formData.append('transcription_mode', engine);

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

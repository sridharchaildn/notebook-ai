import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateObject, streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import type {
  AITransformRequest,
  InterviewCoachRequest,
  InterviewTurn,
  InterviewTurnsRequest,
  InterviewTurnsResponse,
  ProviderCapability,
  ProviderId,
  TranscriptionChunkResponse,
} from '@notebook-ai/contracts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const specsDir = path.join(repoRoot, 'specs');
const cloudApiUrl = process.env.NEXT_PUBLIC_CLOUD_API_URL ?? process.env.CLOUD_API_URL ?? 'http://127.0.0.1:8790';
const defaultOpenRouterBaseUrl = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';

interface CredentialContext {
  provider: ProviderId;
  accessToken?: string | null;
  model?: string | null;
}

interface ProviderSecret {
  provider: ProviderId;
  secret: string;
}

let capabilityCache: ProviderCapability[] | null = null;

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function loadProviderCapabilities(): Promise<ProviderCapability[]> {
  if (capabilityCache) return capabilityCache;
  const raw = await readFile(path.join(specsDir, 'provider-capabilities.json'), 'utf-8');
  const parsed = JSON.parse(raw) as { providers: ProviderCapability[] };
  capabilityCache = parsed.providers;
  return capabilityCache;
}

async function resolveSecret({
  provider,
  accessToken,
}: CredentialContext): Promise<ProviderSecret> {
  if (!accessToken) {
    throw new Error('Missing bearer token for provider credential lookup.');
  }

  const res = await fetch(`${cloudApiUrl}/providers/credential?provider=${encodeURIComponent(provider)}`, {
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    throw new Error('Provider credential unavailable for this account.');
  }

  const payload = (await res.json()) as { provider: ProviderId; secret: string; connection_type?: string };
  let secret = payload.secret?.trim();
  if (!secret) {
    throw new Error('Empty provider credential received.');
  }

  if (payload.connection_type === 'oauth') {
    try {
      const parsed = JSON.parse(secret) as { access_token?: string };
      if (parsed.access_token) {
        secret = parsed.access_token;
      }
    } catch {
      /* ignore raw non-json secrets */
    }
  }

  return { provider: payload.provider, secret };
}

async function resolveLanguageModel({ provider, accessToken, model }: CredentialContext) {
  const capabilities = await loadProviderCapabilities();
  const capability = capabilities.find((entry) => entry.provider === provider);
  if (!capability?.supports_streaming) {
    throw new Error(`${provider} is not configured for web AI generation.`);
  }

  const { secret } = await resolveSecret({ provider, accessToken, model });

  if (provider === 'openrouter') {
    const client = createOpenAICompatible({
      name: 'openrouter',
      apiKey: secret,
      baseURL: defaultOpenRouterBaseUrl,
      headers: {
        'HTTP-Referer': 'https://notebook-ai.app',
        'X-Title': 'Notebook AI',
      },
    });
    return client(model || 'openai/gpt-4o-mini');
  }

  const client = createOpenAI({
    apiKey: secret,
  });
  return client(model || 'gpt-4o-mini');
}

function buildTransformPrompts(payload: AITransformRequest): { system: string; prompt: string } {
  if (payload.transform === 'summarize') {
    return {
      system:
        'You are a precise note assistant. Produce concise, high-signal summaries in plain text. No markdown bullets unless the user content already depends on them.',
      prompt: `Summarize this note in 5 to 8 compact bullets.\n\n${payload.content}`,
    };
  }

  if (payload.transform === 'rewrite') {
    return {
      system:
        'You rewrite notes to improve clarity while preserving meaning. Return plain text only.',
      prompt: `Rewrite this note in a ${payload.tone ?? 'concise'} tone. Preserve the meaning.\n\n${payload.content}`,
    };
  }

  return {
    system:
      'Extract action items from notes. Return short plain-text checklist items. No markdown headings.',
    prompt: `Extract action items from this note.\n\n${payload.content}`,
  };
}

export async function* streamTransformText(
  payload: AITransformRequest,
  context: CredentialContext,
): AsyncIterable<string> {
  const { system, prompt } = buildTransformPrompts(payload);
  const model = await resolveLanguageModel(context);
  const result = streamText({
    model,
    system,
    prompt,
    temperature: 0.2,
  });

  for await (const token of result.textStream) {
    yield token;
  }
}

function transcriptDigest(transcript: string): string {
  return sha(transcript.trim().toLowerCase());
}

function normalizeTurn(role: InterviewTurn['role'], text: string): InterviewTurn {
  const clean = text.trim();
  return {
    id: sha(`${role}:${clean.toLowerCase()}`).slice(0, 16),
    role,
    text: clean,
  };
}

function heuristicTurnsFromTranscript(transcript: string): InterviewTurn[] {
  const parts = transcript
    .split(/(?=(?:Interviewer|Interviewee)\s*:)/i)
    .map((part) => part.trim())
    .filter(Boolean);

  const turns: InterviewTurn[] = [];
  for (const part of parts) {
    const match = /^(Interviewer|Interviewee)\s*:\s*(.+)$/i.exec(part);
    if (!match) continue;
    const role = match[1].toLowerCase() === 'interviewer' ? 'interviewer' : 'interviewee';
    turns.push(normalizeTurn(role, match[2]));
  }
  return turns;
}

function mergeTurns(previousTurns: InterviewTurn[], nextTurns: InterviewTurn[]): InterviewTurn[] {
  const merged = new Map<string, InterviewTurn>();
  for (const turn of previousTurns) merged.set(turn.id, turn);
  for (const turn of nextTurns) merged.set(turn.id, turn);
  return Array.from(merged.values());
}

const interviewTurnsSchema = z.object({
  turns: z.array(
    z.object({
      role: z.enum(['interviewer', 'interviewee']),
      text: z.string().min(1),
    }),
  ),
});

export async function extractInterviewTurns(
  payload: InterviewTurnsRequest,
  context: CredentialContext,
): Promise<InterviewTurnsResponse> {
  const transcript = payload.transcript.trim();
  const digest = transcriptDigest(transcript);
  if (!transcript) {
    return {
      turns: payload.previous_turns,
      latest_interviewer_turn_id:
        [...payload.previous_turns].reverse().find((turn) => turn.role === 'interviewer')?.id ?? null,
      transcript_digest: digest,
    };
  }

  try {
    const model = await resolveLanguageModel(context);
    const result = await generateObject({
      model,
      schema: interviewTurnsSchema,
      temperature: 0,
      system:
        'Split the transcript into coherent interviewer and interviewee turns. Return only role-tagged turns. No summaries.',
      prompt:
        `Transcript:\n${transcript}\n\nPrevious turns:\n${JSON.stringify(payload.previous_turns)}`,
    });
    const parsedTurns = result.object.turns.map((turn) => normalizeTurn(turn.role, turn.text));
    const merged = mergeTurns(payload.previous_turns, parsedTurns);
    return {
      turns: merged,
      latest_interviewer_turn_id:
        [...merged].reverse().find((turn) => turn.role === 'interviewer')?.id ?? null,
      transcript_digest: digest,
    };
  } catch {
    const parsedTurns = heuristicTurnsFromTranscript(transcript);
    const merged = mergeTurns(payload.previous_turns, parsedTurns);
    return {
      turns: merged,
      latest_interviewer_turn_id:
        [...merged].reverse().find((turn) => turn.role === 'interviewer')?.id ?? null,
      transcript_digest: digest,
    };
  }
}

function buildCoachPrompt(payload: InterviewCoachRequest): { system: string; prompt: string } {
  return {
    system:
      'You are a concise interview coach. Respond in first person, directly speakable, plain text only. No headings, no markdown, no analysis.',
    prompt: [
      `Interviewer asked: ${payload.latest_interviewer_turn.text}`,
      payload.latest_interviewee_turn?.text
        ? `Candidate last answer: ${payload.latest_interviewee_turn.text}`
        : null,
      payload.brevity === 'one_liner'
        ? 'Reply with one short sentence.'
        : 'Reply in 2 or 3 short lines maximum.',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

export async function* streamInterviewCoachText(
  payload: InterviewCoachRequest,
  context: CredentialContext,
): AsyncIterable<string> {
  const model = await resolveLanguageModel(context);
  const { system, prompt } = buildCoachPrompt(payload);
  const result = streamText({
    model,
    system,
    prompt,
    temperature: 0.2,
  });

  for await (const token of result.textStream) {
    yield token;
  }
}

export async function transcribeAudioChunk(
  file: File,
  context: CredentialContext,
): Promise<TranscriptionChunkResponse> {
  if (context.provider !== 'openai') {
    return {
      text: '',
      provider: context.provider,
      model: context.model || 'gpt-4o-mini-transcribe',
      ok: false,
      detail: 'Web transcription currently supports OpenAI only.',
      error_code: 'provider_http_error',
      recoverable: false,
    };
  }

  const { secret } = await resolveSecret(context);
  const form = new FormData();
  form.append('file', file, file.name || 'capture.webm');
  form.append('model', context.model || 'gpt-4o-mini-transcribe');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
    },
    body: form,
  });

  if (!response.ok) {
    const body = await response.text();
    return {
      text: '',
      provider: 'openai',
      model: context.model || 'gpt-4o-mini-transcribe',
      ok: false,
      detail: body || `OpenAI transcription failed (${response.status}).`,
      error_code: response.status === 401 || response.status === 402 || response.status === 429 ? 'auth_or_quota' : 'provider_http_error',
      recoverable: response.status >= 500,
    };
  }

  const payload = (await response.json()) as { text?: string };
  return {
    text: payload.text?.trim() || '',
    provider: 'openai',
    model: context.model || 'gpt-4o-mini-transcribe',
    ok: true,
    detail: payload.text?.trim() ? null : 'Transcription returned no text.',
    error_code: 'none',
    recoverable: false,
  };
}

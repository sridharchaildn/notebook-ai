export type ProviderId = 'openai' | 'openrouter';

export interface NoteFrontmatter {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  tags: string[];
  provider?: ProviderId;
  model?: string;
}

export interface NoteDocument {
  frontmatter: NoteFrontmatter;
  body: string;
}

export interface ProviderConnection {
  provider: ProviderId;
  connected: boolean;
  via: 'oauth' | 'api_key' | 'none';
  last_updated_at?: string;
}

export type AITransformType = 'summarize' | 'rewrite' | 'extract_action_items';

export interface AITransformRequest {
  note_id?: string;
  content: string;
  transform: AITransformType;
  tone?: 'concise' | 'professional' | 'friendly' | 'actionable';
  provider?: ProviderId;
  model?: string;
}

export interface AITransformStreamEvent {
  event: 'token' | 'complete' | 'error';
  data: string;
}

export interface TranscriptionChunkResponse {
  text: string;
  provider: ProviderId;
  model: string;
  /** Hint when text is empty (e.g. missing API key). */
  detail?: string | null;
}

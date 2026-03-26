export type ProviderId = 'openai' | 'openrouter';
export type StorageMode = 'local' | 'local_and_drive';
export type LegalDocumentType = 'privacy_policy' | 'user_agreement';
export type ThemePreference = 'light' | 'dark' | 'system';
export type ThemeTokensVersion = 'v1';

export interface NoteFrontmatter {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  tags: string[];
  provider?: ProviderId;
  model?: string;
  folder_id?: string | null;
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

export interface StoragePreference {
  mode: StorageMode;
  local_root?: string | null;
  updated_at?: string | null;
}

export interface FolderNode {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface MoveNoteRequest {
  folder_id?: string | null;
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

export type InterviewRole = 'interviewer' | 'interviewee';

export interface InterviewTurn {
  id: string;
  role: InterviewRole;
  text: string;
}

export interface InterviewTurnsRequest {
  transcript: string;
  previous_turns: InterviewTurn[];
  provider?: ProviderId;
  model?: string;
}

export interface InterviewTurnsResponse {
  turns: InterviewTurn[];
  latest_interviewer_turn_id?: string | null;
  transcript_digest: string;
}

export interface InterviewCoachRequest {
  latest_interviewer_turn: InterviewTurn;
  latest_interviewee_turn?: InterviewTurn | null;
  brevity?: 'short' | 'one_liner';
  provider?: ProviderId;
  model?: string;
}

export interface InterviewCoachStreamEvent {
  event: 'token' | 'complete' | 'error';
  data: string;
}

/** @deprecated Use InterviewTurnsRequest + InterviewCoachRequest. */
export interface InterviewAssistRequest {
  transcript: string;
  provider?: ProviderId;
  model?: string;
}

/** @deprecated Use InterviewCoachStreamEvent. */
export interface InterviewAssistStreamEvent {
  event: 'token' | 'complete' | 'error';
  data: string;
}

export interface TranscriptionChunkResponse {
  text: string;
  provider: ProviderId;
  model: string;
  /** Hint when text is empty (e.g. missing API key). */
  detail?: string | null;
  ok: boolean;
  error_code?: 'invalid_audio_format' | 'auth_or_quota' | 'network_error' | 'provider_http_error' | 'none';
  recoverable?: boolean;
  segment_id?: number | null;
}

export interface SyncStatus {
  enabled: boolean;
  pending_ops: number;
  last_run_at?: string | null;
  last_error?: string | null;
}

export interface DriveConnectionStatus {
  connected: boolean;
  folder_name: string;
  folder_id?: string | null;
  last_updated_at?: string | null;
}

export interface LegalDocument {
  type: LegalDocumentType;
  version: string;
  title: string;
  url: string;
}

export interface LegalAcceptanceRecord {
  type: LegalDocumentType;
  version: string;
  accepted_at: string;
}

export interface DesktopAuthExchangeInitRequest {
  device_label?: string;
}

export interface DesktopAuthExchangeInitResponse {
  state: string;
  auth_url: string;
  expires_in_seconds: number;
}

export interface DesktopAuthExchangeCompleteRequest {
  state?: string;
  user_id?: string;
  code?: string;
}

export interface DesktopAuthExchangeCompleteResponse {
  deep_link_url?: string;
  code?: string;
  session_token?: string;
  user_id?: string;
  expires_in_seconds?: number;
  onboarding_complete?: boolean;
}

export interface DesktopAuthExchangePollResponse {
  ready: boolean;
  session_token?: string;
  user_id?: string;
  expires_in_seconds?: number;
  onboarding_complete?: boolean;
}

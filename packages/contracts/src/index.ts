export type ProviderId = 'openai' | 'openrouter';
export type StorageMode = 'local' | 'local_and_drive';
export type LegalDocumentType = 'privacy_policy' | 'user_agreement';
export type ThemePreference = 'light' | 'dark' | 'system';
export type ThemeTokensVersion = 'v1';
export type WorkspaceKind = 'desktop_local_only' | 'drive_shared';
export type NoteKind = 'note' | 'transcript' | 'interview_assist';
export type ContentFormat = 'plain_text' | 'markdown';
export type SyncState = 'idle' | 'syncing' | 'needs_setup' | 'error';
export type SyncPhase = 'idle' | 'preparing' | 'pulling' | 'merging' | 'pushing' | 'finalizing';
export type ModelUseCase = 'copilot' | 'transcription';

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

export interface ProviderConnection {
  provider: ProviderId;
  connected: boolean;
  via: 'oauth' | 'api_key' | 'none';
  last_updated_at?: string;
}

export interface ProviderCapability {
  provider: ProviderId;
  supports_streaming: boolean;
  supports_transcription: boolean;
  supports_oauth: boolean;
  supports_api_key: boolean;
  preferred_for?: Array<'notes' | 'interview' | 'transcription'>;
}

export interface ProviderModel {
  id: string;
  label: string;
  provider: ProviderId;
  owned_by?: string | null;
  context_length?: number | null;
  supports_audio_input?: boolean | null;
}

export interface StoragePreference {
  mode: StorageMode;
  local_root?: string | null;
  updated_at?: string | null;
}

export interface WorkspaceDescriptor {
  id: string;
  name: string;
  kind: WorkspaceKind;
  storage_mode: StorageMode;
  drive_folder_id?: string | null;
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

export interface AIWorkflowSpec {
  id: AITransformType | 'interview_turns' | 'interview_coach';
  label: string;
  output_mode: 'plain_text' | 'json' | 'sse_text';
  max_lines?: number;
}

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

export interface TranscriptSessionData {
  session_type: 'transcript';
  transcript: string;
  last_updated_at?: string | null;
}

export interface InterviewSessionData {
  session_type: 'interview_assist';
  transcript: string;
  guidance: string;
  turns: InterviewTurn[];
  last_coached_interviewer_turn_id?: string | null;
  last_updated_at?: string | null;
}

export type NoteSessionData = TranscriptSessionData | InterviewSessionData;

export interface NoteDocument {
  frontmatter: NoteFrontmatter;
  kind: NoteKind;
  content_format: ContentFormat;
  content: string;
  session?: NoteSessionData | null;
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
  detail?: string | null;
  ok: boolean;
  error_code?: 'invalid_audio_format' | 'auth_or_quota' | 'network_error' | 'provider_http_error' | 'none';
  recoverable?: boolean;
  segment_id?: number | null;
}

export interface SyncConflictPolicy {
  on_remote_newer: 'prefer_remote' | 'prefer_local' | 'manual_review';
  on_local_missing_remote: 'restore_remote' | 'keep_deleted';
}

export interface SyncStatus {
  enabled: boolean;
  pending_ops: number;
  state?: SyncState;
  phase?: SyncPhase | null;
  current_item?: string | null;
  completed_items?: number;
  total_items?: number;
  last_run_at?: string | null;
  last_synced_at?: string | null;
  last_error?: string | null;
}

export interface DriveConnectionStatus {
  connected: boolean;
  folder_name: string;
  folder_id?: string | null;
  last_updated_at?: string | null;
}

export interface GoogleDriveTokenResponse {
  access_token: string;
  token_type: string;
  folder_id?: string | null;
  folder_name?: string | null;
}

export interface GoogleDriveFolderUpdateRequest {
  folder_id: string;
  folder_name?: string | null;
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

export interface AuthenticatedUser {
  id: string;
  email?: string | null;
}

export interface SupabaseSessionPayload {
  access_token: string;
  refresh_token: string;
  expires_at?: number | null;
  expires_in?: number | null;
  token_type?: string | null;
  user: AuthenticatedUser;
}

export interface AuthRefreshRequest {
  refresh_token: string;
}

export interface AuthRefreshResponse {
  session: SupabaseSessionPayload;
}

export interface AuthLogoutResponse {
  ok: boolean;
}

export interface OAuthStartResponse {
  url: string;
  state: string;
  expires_in_seconds: number;
}

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

ProviderId = Literal["openai", "openrouter"]
TransformType = Literal["summarize", "rewrite", "extract_action_items"]
ToneType = Literal["concise", "professional", "friendly", "actionable"]
InterviewRole = Literal["interviewer", "interviewee"]
NoteKind = Literal["note", "transcript", "interview_assist"]
ContentFormat = Literal["plain_text", "markdown"]
NoteContextPreset = Literal["meeting", "podcast", "youtube", "custom"]
SourceHint = Literal["me", "other_audio", "unknown"]
WorkspaceKind = Literal["desktop_local_only", "drive_shared"]
SyncState = Literal["idle", "syncing", "needs_setup", "error"]
SyncPhase = Literal["idle", "preparing", "pulling", "merging", "pushing", "finalizing"]
TranscriptionErrorCode = Literal[
    "invalid_audio_format",
    "auth_or_quota",
    "network_error",
    "provider_http_error",
    "none",
]


class NoteFrontmatter(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    tags: list[str] = Field(default_factory=list)
    provider: ProviderId | None = None
    model: str | None = None
    folder_id: str | None = None
    context_preset: NoteContextPreset | None = None
    context_text: str | None = None


class InterviewTurn(BaseModel):
    id: str
    role: InterviewRole
    text: str
    source_hint: SourceHint | None = None


class TranscriptSegment(BaseModel):
    id: str
    text: str
    source_hint: SourceHint = "unknown"


class TranscriptSessionData(BaseModel):
    session_type: Literal["transcript"] = "transcript"
    transcript: str = ""
    segments: list[TranscriptSegment] = Field(default_factory=list)
    summary: str | None = None
    last_updated_at: datetime | None = None


class InterviewSessionData(BaseModel):
    session_type: Literal["interview_assist"] = "interview_assist"
    transcript: str = ""
    guidance: str = ""
    turns: list[InterviewTurn] = Field(default_factory=list)
    summary: str | None = None
    last_coached_interviewer_turn_id: str | None = None
    last_updated_at: datetime | None = None


NoteSessionData = Annotated[
    TranscriptSessionData | InterviewSessionData,
    Field(discriminator="session_type"),
]


class NoteDocument(BaseModel):
    frontmatter: NoteFrontmatter
    kind: NoteKind = "note"
    content_format: ContentFormat = "plain_text"
    content: str = ""
    session: NoteSessionData | None = None


class NoteCreateRequest(BaseModel):
    title: str = "Untitled note"
    content: str = ""
    body: str | None = None
    tags: list[str] = Field(default_factory=list)
    provider: ProviderId | None = None
    model: str | None = None
    folder_id: str | None = None
    context_preset: NoteContextPreset | None = None
    context_text: str | None = None
    kind: NoteKind = "note"
    content_format: ContentFormat = "plain_text"
    session: NoteSessionData | None = None

    @model_validator(mode="after")
    def fill_content_from_legacy_body(self) -> "NoteCreateRequest":
        if self.body is not None and not self.content:
            self.content = self.body
        return self


class NoteUpdateRequest(BaseModel):
    title: str
    content: str = ""
    body: str | None = None
    tags: list[str] = Field(default_factory=list)
    provider: ProviderId | None = None
    model: str | None = None
    folder_id: str | None = None
    context_preset: NoteContextPreset | None = None
    context_text: str | None = None
    kind: NoteKind = "note"
    content_format: ContentFormat = "plain_text"
    session: NoteSessionData | None = None

    @model_validator(mode="after")
    def fill_content_from_legacy_body(self) -> "NoteUpdateRequest":
        if self.body is not None and not self.content:
            self.content = self.body
        return self


class MoveNoteRequest(BaseModel):
    folder_id: str | None = None


class NoteAIContext(BaseModel):
    title: str
    tags: list[str] = Field(default_factory=list)
    note_kind: NoteKind = "note"
    context_preset: NoteContextPreset | None = None
    context_text: str | None = None
    transcript_segments: list[TranscriptSegment] = Field(default_factory=list)
    summary: str | None = None


class AITransformRequest(BaseModel):
    note_id: str | None = None
    content: str
    transform: TransformType
    tone: ToneType = "concise"
    provider: ProviderId | None = None
    model: str | None = None
    note_context: NoteAIContext | None = None


class InterviewAssistRequest(BaseModel):
    transcript: str
    provider: ProviderId | None = None
    model: str | None = None


class InterviewTurnsRequest(BaseModel):
    transcript: str
    previous_turns: list[InterviewTurn] = Field(default_factory=list)
    provider: ProviderId | None = None
    model: str | None = None


class InterviewTurnsResponse(BaseModel):
    turns: list[InterviewTurn] = Field(default_factory=list)
    latest_interviewer_turn_id: str | None = None
    transcript_digest: str


class InterviewCoachRequest(BaseModel):
    latest_interviewer_turn: InterviewTurn
    latest_interviewee_turn: InterviewTurn | None = None
    brevity: Literal["short", "one_liner"] = "short"
    provider: ProviderId | None = None
    model: str | None = None


class CopilotChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class CopilotChatRequest(BaseModel):
    question: str
    content: str
    history: list[CopilotChatMessage] = Field(default_factory=list)
    note_context: NoteAIContext | None = None
    provider: ProviderId | None = None
    model: str | None = None


class ProviderConnection(BaseModel):
    provider: ProviderId
    connected: bool
    via: Literal["oauth", "api_key", "none"]
    last_updated_at: datetime | None = None


class ProviderStatusUpdateRequest(BaseModel):
    provider: ProviderId
    via: Literal["oauth", "api_key"]
    connected: bool = True


class HealthResponse(BaseModel):
    status: str = "ok"


class WorkspaceDescriptor(BaseModel):
    id: str
    name: str
    kind: WorkspaceKind
    storage_mode: Literal["local", "local_and_drive"] = "local"
    drive_folder_id: str | None = None
    local_root: str | None = None
    updated_at: datetime | None = None


class TranscriptionChunkResponse(BaseModel):
    text: str
    provider: ProviderId
    model: str
    detail: str | None = None
    ok: bool = True
    error_code: TranscriptionErrorCode = "none"
    recoverable: bool = False
    segment_id: int | None = None


class StoragePreference(BaseModel):
    mode: Literal["local", "local_and_drive"] = "local"
    local_root: str | None = None
    updated_at: datetime | None = None


class StoragePreferenceUpdateRequest(BaseModel):
    mode: Literal["local", "local_and_drive"] = "local"
    local_root: str | None = None


class FolderNode(BaseModel):
    id: str
    name: str
    created_at: datetime
    updated_at: datetime


class FolderCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)


class FolderUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)


class LocalRootResponse(BaseModel):
    local_root: str


class LocalRootUpdateRequest(BaseModel):
    local_root: str = Field(min_length=1)


class SyncStatus(BaseModel):
    enabled: bool = False
    pending_ops: int = 0
    state: SyncState = "idle"
    phase: SyncPhase | None = "idle"
    current_item: str | None = None
    completed_items: int = 0
    total_items: int = 0
    last_run_at: datetime | None = None
    last_synced_at: datetime | None = None
    last_error: str | None = None

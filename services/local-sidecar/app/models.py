from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ProviderId = Literal["openai", "openrouter"]
TransformType = Literal["summarize", "rewrite", "extract_action_items"]
ToneType = Literal["concise", "professional", "friendly", "actionable"]
InterviewRole = Literal["interviewer", "interviewee"]
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


class NoteDocument(BaseModel):
    frontmatter: NoteFrontmatter
    body: str


class NoteCreateRequest(BaseModel):
    title: str = "Untitled note"
    body: str = ""
    tags: list[str] = Field(default_factory=list)
    provider: ProviderId | None = None
    model: str | None = None
    folder_id: str | None = None


class NoteUpdateRequest(BaseModel):
    title: str
    body: str
    tags: list[str] = Field(default_factory=list)
    provider: ProviderId | None = None
    model: str | None = None
    folder_id: str | None = None


class MoveNoteRequest(BaseModel):
    folder_id: str | None = None


class AITransformRequest(BaseModel):
    note_id: str | None = None
    content: str
    transform: TransformType
    tone: ToneType = "concise"
    provider: ProviderId | None = None
    model: str | None = None


class InterviewAssistRequest(BaseModel):
    transcript: str
    provider: ProviderId | None = None
    model: str | None = None


class InterviewTurn(BaseModel):
    id: str
    role: InterviewRole
    text: str


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
    last_run_at: datetime | None = None
    last_error: str | None = None

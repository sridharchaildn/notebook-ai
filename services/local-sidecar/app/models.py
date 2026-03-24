from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ProviderId = Literal["openai", "openrouter"]
TransformType = Literal["summarize", "rewrite", "extract_action_items"]
ToneType = Literal["concise", "professional", "friendly", "actionable"]


class NoteFrontmatter(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    tags: list[str] = Field(default_factory=list)
    provider: ProviderId | None = None
    model: str | None = None


class NoteDocument(BaseModel):
    frontmatter: NoteFrontmatter
    body: str


class NoteCreateRequest(BaseModel):
    title: str = "Untitled note"
    body: str = ""
    tags: list[str] = Field(default_factory=list)
    provider: ProviderId | None = None
    model: str | None = None


class NoteUpdateRequest(BaseModel):
    title: str
    body: str
    tags: list[str] = Field(default_factory=list)
    provider: ProviderId | None = None
    model: str | None = None


class AITransformRequest(BaseModel):
    note_id: str | None = None
    content: str
    transform: TransformType
    tone: ToneType = "concise"
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

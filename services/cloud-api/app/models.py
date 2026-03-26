from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ProviderId = Literal["openai", "openrouter"]
StorageMode = Literal["local", "local_and_drive"]
LegalDocumentType = Literal["privacy_policy", "user_agreement"]


class AuthSessionExchangeRequest(BaseModel):
    access_token: str | None = None


class AuthSessionExchangeResponse(BaseModel):
    user_id: str
    session_token: str
    expires_in_seconds: int


class DesktopAuthExchangeInitRequest(BaseModel):
    device_label: str | None = None


class DesktopAuthExchangeInitResponse(BaseModel):
    state: str
    auth_url: str
    expires_in_seconds: int


class DesktopAuthExchangeCompleteRequest(BaseModel):
    state: str | None = None
    user_id: str | None = None
    code: str | None = None


class DesktopAuthExchangeCompleteResponse(BaseModel):
    deep_link_url: str | None = None
    code: str | None = None
    session_token: str | None = None
    user_id: str | None = None
    expires_in_seconds: int | None = None
    onboarding_complete: bool | None = None


class ProviderByokRequest(BaseModel):
    provider: ProviderId
    api_key: str = Field(min_length=4)
    session_token: str | None = None
    user_id: str | None = None


class ProviderStatus(BaseModel):
    provider: ProviderId
    connected: bool
    via: Literal["oauth", "api_key", "none"]
    last_updated_at: datetime | None = None


class ProviderDeleteResponse(BaseModel):
    provider: ProviderId
    connected: bool = False


class ProviderCredentialResponse(BaseModel):
    provider: ProviderId
    connection_type: Literal["oauth", "api_key"]
    secret: str


class LegalDocument(BaseModel):
    type: LegalDocumentType
    version: str
    title: str
    url: str


class LegalCurrentResponse(BaseModel):
    documents: list[LegalDocument]


class LegalAcceptanceInput(BaseModel):
    type: LegalDocumentType
    version: str


class LegalAcceptRequest(BaseModel):
    session_token: str | None = None
    user_id: str | None = None
    acceptances: list[LegalAcceptanceInput] = Field(default_factory=list)


class LegalAcceptanceRecord(BaseModel):
    type: LegalDocumentType
    version: str
    accepted_at: datetime


class StoragePreference(BaseModel):
    mode: StorageMode = "local"
    local_root: str | None = None
    updated_at: datetime | None = None


class StoragePreferenceRequest(BaseModel):
    mode: StorageMode = "local"
    local_root: str | None = None
    session_token: str | None = None
    user_id: str | None = None


class DriveConnectionStatus(BaseModel):
    connected: bool
    folder_name: str = "Notebook AI"
    folder_id: str | None = None
    last_updated_at: datetime | None = None


class GoogleDriveTokenResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"


class GoogleDriveByokRequest(BaseModel):
    refresh_token: str = Field(min_length=4)
    folder_id: str | None = None
    session_token: str | None = None
    user_id: str | None = None

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ProviderId = Literal["openai", "openrouter"]
StorageMode = Literal["local", "local_and_drive"]
WorkspaceKind = Literal["desktop_local_only", "drive_shared"]
ModelUseCase = Literal["copilot", "transcription"]


class AuthenticatedUser(BaseModel):
    id: str
    email: str | None = None


class SupabaseSessionPayload(BaseModel):
    access_token: str
    refresh_token: str
    expires_at: int | None = None
    expires_in: int | None = None
    token_type: str | None = "bearer"
    user: AuthenticatedUser


class AuthRefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=4)


class AuthRefreshResponse(BaseModel):
    session: SupabaseSessionPayload


class AuthLogoutResponse(BaseModel):
    ok: bool = True


class OAuthStartResponse(BaseModel):
    url: str
    state: str
    expires_in_seconds: int = 900


class ProviderByokRequest(BaseModel):
    provider: ProviderId
    api_key: str = Field(min_length=4)


class ProviderStatus(BaseModel):
    provider: ProviderId
    connected: bool
    via: Literal["oauth", "api_key", "none"]
    scope: Literal["desktop_local", "account_vault", "none"] = "none"
    last_updated_at: datetime | None = None


class ProviderModel(BaseModel):
    id: str
    label: str
    provider: ProviderId
    owned_by: str | None = None
    context_length: int | None = None
    supports_audio_input: bool | None = None


class ProviderDeleteResponse(BaseModel):
    provider: ProviderId
    connected: bool = False


class ProviderCredentialResponse(BaseModel):
    provider: ProviderId
    connection_type: Literal["oauth", "api_key"]
    secret: str

class StoragePreference(BaseModel):
    mode: StorageMode = "local"
    local_root: str | None = None
    updated_at: datetime | None = None


class StoragePreferenceRequest(BaseModel):
    mode: StorageMode = "local"
    local_root: str | None = None


class WorkspaceDescriptor(BaseModel):
    id: str
    name: str
    kind: WorkspaceKind
    storage_mode: StorageMode
    drive_folder_id: str | None = None
    local_root: str | None = None
    updated_at: datetime | None = None


class DriveConnectionStatus(BaseModel):
    connected: bool
    folder_name: str = "Notebook AI"
    folder_id: str | None = None
    last_updated_at: datetime | None = None


class GoogleDriveTokenResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    folder_id: str | None = None
    folder_name: str | None = None


class GoogleDriveFolderUpdateRequest(BaseModel):
    folder_id: str = Field(min_length=3)
    folder_name: str | None = None


class GoogleDriveByokRequest(BaseModel):
    refresh_token: str = Field(min_length=4)
    folder_id: str | None = None

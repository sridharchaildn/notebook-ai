from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ProviderId = Literal["openai", "openrouter"]


class AuthSessionExchangeRequest(BaseModel):
    access_token: str | None = None


class AuthSessionExchangeResponse(BaseModel):
    user_id: str
    session_token: str
    expires_in_seconds: int


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

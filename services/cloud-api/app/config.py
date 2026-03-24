from __future__ import annotations

from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="NOTEBOOK_CLOUD_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_path: Path = Path(".notebook-ai/cloud-api.db")
    app_jwt_secret: str = "dev-app-secret"
    app_jwt_exp_minutes: int = 240
    credential_secret: str = "dev-credential-secret"
    dev_user_id: str = "local-dev-user"

    supabase_jwt_secret: str | None = None
    supabase_jwks_url: str | None = None

    openai_oauth_authorize_url: str = "https://auth.openai.com/oauth/authorize"
    openai_oauth_token_url: str | None = None
    openai_oauth_client_id: str | None = None
    openai_oauth_client_secret: str | None = None
    openai_oauth_redirect_uri: str = "http://127.0.0.1:8790/providers/openai/oauth/callback"
    openai_oauth_scope: str = "openid profile email"
    debug: bool = False

    @field_validator("database_path", mode="before")
    @classmethod
    def expand_path(cls, value: str | Path) -> Path:
        return Path(value).expanduser().resolve()

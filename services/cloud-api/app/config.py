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

    credential_secret: str = "dev-credential-secret"

    supabase_url: str = "http://127.0.0.1:54321"
    supabase_anon_key: str | None = None
    supabase_secret_key: str | None = None
    supabase_service_role_key: str | None = None
    supabase_jwt_secret: str | None = None
    supabase_jwks_url: str | None = None

    openai_oauth_authorize_url: str = "https://auth.openai.com/oauth/authorize"
    openai_oauth_token_url: str | None = None
    openai_oauth_client_id: str | None = None
    openai_oauth_client_secret: str | None = None
    openai_oauth_redirect_uri: str = "http://127.0.0.1:8790/providers/openai/oauth/callback"
    openai_oauth_scope: str = "openid profile email"

    privacy_policy_version: str = "2026-03-25"
    privacy_policy_url: str = "https://notebook-ai.app/legal/privacy"
    user_agreement_version: str = "2026-03-25"
    user_agreement_url: str = "https://notebook-ai.app/legal/terms"

    google_drive_oauth_authorize_url: str = "https://accounts.google.com/o/oauth2/v2/auth"
    google_drive_oauth_token_url: str | None = None
    google_drive_client_id: str | None = None
    google_drive_client_secret: str | None = None
    google_drive_redirect_uri: str = "http://127.0.0.1:8790/integrations/google-drive/oauth/callback"
    google_drive_scope: str = "https://www.googleapis.com/auth/drive.file"
    google_drive_default_folder_name: str = "Notebook AI"
    debug: bool = False

    @field_validator("supabase_url", mode="before")
    @classmethod
    def normalize_supabase_url(cls, value: str | Path) -> str:
        return str(value).strip().rstrip("/")

    @property
    def supabase_server_key(self) -> str | None:
        return self.supabase_secret_key or self.supabase_service_role_key

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
    web_app_url: str = "http://127.0.0.1:3000"
    desktop_callback_scheme: str = "notebook-ai://auth/callback"
    desktop_auth_path: str = "/desktop/auth"

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

    @field_validator("database_path", mode="before")
    @classmethod
    def expand_path(cls, value: str | Path) -> Path:
        return Path(value).expanduser().resolve()

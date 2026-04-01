from __future__ import annotations

from pathlib import Path
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


def _read_repo_version() -> str:
    version_file = Path(__file__).resolve().parents[3] / "VERSION"
    try:
        return version_file.read_text(encoding="utf-8").strip() or "0.1.0"
    except OSError:
        return "0.1.0"


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

    google_drive_oauth_authorize_url: str = "https://accounts.google.com/o/oauth2/v2/auth"
    google_drive_oauth_token_url: str | None = None
    google_drive_client_id: str | None = None
    google_drive_client_secret: str | None = None
    google_drive_redirect_uri: str = "http://127.0.0.1:8790/integrations/google-drive/oauth/callback"
    google_drive_scope: str = "https://www.googleapis.com/auth/drive.file"
    google_drive_default_folder_name: str = "Notebook AI"
    allowed_origins: Annotated[tuple[str, ...], NoDecode] = (
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "null",
    )
    app_version: str = _read_repo_version()
    build_version: str | None = None
    debug: bool = False

    @field_validator("supabase_url", mode="before")
    @classmethod
    def normalize_supabase_url(cls, value: str | Path) -> str:
        return str(value).strip().rstrip("/")

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def parse_allowed_origins(
        cls,
        value: str | tuple[str, ...] | list[str],
    ) -> tuple[str, ...]:
        if isinstance(value, str):
            return tuple(item.strip() for item in value.split(",") if item.strip())
        return tuple(item.strip() for item in value if item.strip())

    @property
    def supabase_server_key(self) -> str | None:
        return self.supabase_secret_key or self.supabase_service_role_key

    @property
    def resolved_build_version(self) -> str:
        return self.build_version or self.app_version

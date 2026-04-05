from __future__ import annotations

from pathlib import Path
import sys
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


def _read_repo_version() -> str:
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        version_file = Path(meipass) / "VERSION"
    else:
        version_file = Path(__file__).resolve().parents[3] / "VERSION"
    try:
        return version_file.read_text(encoding="utf-8").strip() or "0.1.0"
    except OSError:
        return "0.1.0"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="NOTEBOOK_LOCAL_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    notes_dir: Path = Path("~/.notebook-ai")
    profile_path: Path = Path("~/.notebook-ai/provider_status.json")
    storage_profile_path: Path = Path("~/.notebook-ai/storage_profile.json")
    sync_profile_path: Path = Path("~/.notebook-ai/sync_profile.json")
    sync_state_path: Path = Path("~/.notebook-ai/sync_state.json")
    settings_profile_path: Path = Path("~/.notebook-ai/user_settings.json")

    default_provider: str = "openai"
    openai_model: str = "gpt-4o-mini"
    openrouter_model: str = "openai/gpt-4o-mini"
    openai_transcription_model: str = "gpt-4o-mini-transcribe"
    # Multimodal chat transcription (OpenRouter or OpenAI chat/completions + input_audio).
    # Must be a model that advertises audio input (e.g. on OpenRouter: filter models by audio input).
    transcription_llm_openrouter_model: str = "openai/gpt-4o-audio-preview"
    transcription_llm_openai_model: str = "gpt-4o-audio-preview"

    openai_api_key: str | None = None
    openrouter_api_key: str | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    cloud_api_url: str = "http://127.0.0.1:8790"
    allowed_origins: Annotated[tuple[str, ...], NoDecode] = (
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "null",
    )
    desktop_token: str = "notebook-local-dev-token"
    app_version: str = _read_repo_version()
    build_version: str | None = None
    ffmpeg_path: Path | None = None
    debug: bool = False

    @field_validator(
        "notes_dir",
        "profile_path",
        "storage_profile_path",
        "sync_profile_path",
        "sync_state_path",
        "settings_profile_path",
        "ffmpeg_path",
        mode="before",
    )
    @classmethod
    def expand_path(cls, value: str | Path | None) -> Path | None:
        if value in {None, ""}:
            return None
        return Path(value).expanduser().resolve()

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
    def resolved_build_version(self) -> str:
        return self.build_version or self.app_version

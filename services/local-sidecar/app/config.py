from __future__ import annotations

from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="NOTEBOOK_LOCAL_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    notes_dir: Path = Path(".notebook-ai/notes")
    profile_path: Path = Path(".notebook-ai/provider_status.json")

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
    cloud_user_id: str = "local-dev-user"
    debug: bool = False

    @field_validator("notes_dir", "profile_path", mode="before")
    @classmethod
    def expand_path(cls, value: str | Path) -> Path:
        return Path(value).expanduser().resolve()

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from .models import (
    MarkdownSettings,
    MarkdownSettingsUpdateRequest,
    TranscriptionPreferences,
    TranscriptionPreferencesUpdateRequest,
)


class LocalSettingsStore:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def get_transcription_preferences(self) -> TranscriptionPreferences:
        payload = self._read_payload().get("transcription")
        if not isinstance(payload, dict):
            return TranscriptionPreferences()
        updated_at = payload.get("updated_at")
        return TranscriptionPreferences(
            main_language=str(payload.get("main_language") or "auto"),
            spoken_languages=_normalize_list(payload.get("spoken_languages")),
            custom_vocabulary=_normalize_list(payload.get("custom_vocabulary")),
            updated_at=_parse_datetime(updated_at),
        )

    def set_transcription_preferences(
        self,
        payload: TranscriptionPreferencesUpdateRequest,
    ) -> TranscriptionPreferences:
        current = self._read_payload()
        updated_at = datetime.now(UTC).isoformat()
        current["transcription"] = {
            "main_language": payload.main_language.strip() or "auto",
            "spoken_languages": _normalize_list(payload.spoken_languages),
            "custom_vocabulary": _normalize_list(payload.custom_vocabulary),
            "updated_at": updated_at,
        }
        self._write_payload(current)
        return self.get_transcription_preferences()

    def get_markdown_settings(self) -> MarkdownSettings:
        payload = self._read_payload().get("markdown")
        if not isinstance(payload, dict):
            return MarkdownSettings()
        updated_at = payload.get("updated_at")
        return MarkdownSettings(
            enable_import=bool(payload.get("enable_import", True)),
            enable_export=bool(payload.get("enable_export", True)),
            editor_mode=_normalize_editor_mode(payload.get("editor_mode")),
            updated_at=_parse_datetime(updated_at),
        )

    def set_markdown_settings(self, payload: MarkdownSettingsUpdateRequest) -> MarkdownSettings:
        current = self._read_payload()
        updated_at = datetime.now(UTC).isoformat()
        current["markdown"] = {
            "enable_import": payload.enable_import,
            "enable_export": payload.enable_export,
            "editor_mode": payload.editor_mode,
            "updated_at": updated_at,
        }
        self._write_payload(current)
        return self.get_markdown_settings()

    def _read_payload(self) -> dict[str, object]:
        if not self.path.exists():
            return {}
        try:
            parsed = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return parsed if isinstance(parsed, dict) else {}

    def _write_payload(self, payload: dict[str, object]) -> None:
        self.path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _normalize_list(raw: object) -> list[str]:
    if not isinstance(raw, list):
        return []
    seen: set[str] = set()
    items: list[str] = []
    for value in raw:
        normalized = str(value or "").strip()
        if not normalized:
            continue
        key = normalized.casefold()
        if key in seen:
            continue
        seen.add(key)
        items.append(normalized)
    return items


def _parse_datetime(raw: object) -> datetime | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed


def _normalize_editor_mode(raw: object) -> str:
    value = str(raw or "rich_text").strip().lower()
    return value if value in {"rich_text", "preview"} else "rich_text"

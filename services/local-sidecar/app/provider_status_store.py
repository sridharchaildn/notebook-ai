from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import json

from .models import ProviderConnection


class ProviderStatusStore:
    def __init__(self, profile_path: Path):
        self.profile_path = profile_path
        self.profile_path.parent.mkdir(parents=True, exist_ok=True)

    def get_statuses(
        self,
        openai_key: str | None,
        openrouter_key: str | None,
    ) -> list[ProviderConnection]:
        profile = self._load_profile()

        results: list[ProviderConnection] = []
        for provider in ("openai", "openrouter"):
            cached = profile.get(provider, {})
            stored_key = str(cached.get("api_key") or "").strip()
            env_key = self.get_api_key(provider, openai_key, openrouter_key)
            connected = bool(env_key or stored_key)
            via = "api_key" if connected else "none"
            scope = "desktop_local" if connected else "none"
            last_updated = cached.get("last_updated_at")

            results.append(
                ProviderConnection(
                    provider=provider,
                    connected=connected,
                    via=via,
                    scope=scope,
                    last_updated_at=_parse_datetime(last_updated) if last_updated else None,
                )
            )

        return results

    def save_api_key(self, provider: str, api_key: str) -> None:
        profile = self._load_profile()
        profile[provider] = {
            "api_key": api_key,
            "via": "api_key",
            "last_updated_at": datetime.now(timezone.utc).isoformat(),
        }
        self._write_profile(profile)

    def delete_provider(self, provider: str) -> None:
        profile = self._load_profile()
        if provider in profile:
            del profile[provider]
            self._write_profile(profile)

    def get_api_key(
        self,
        provider: str,
        openai_key: str | None,
        openrouter_key: str | None,
    ) -> str | None:
        if provider == "openai":
            candidate = (openai_key or "").strip()
            if candidate:
                return candidate
        if provider == "openrouter":
            candidate = (openrouter_key or "").strip()
            if candidate:
                return candidate

        profile = self._load_profile()
        cached = profile.get(provider, {})
        stored_key = str(cached.get("api_key") or "").strip()
        return stored_key or None

    def _load_profile(self) -> dict:
        if not self.profile_path.exists():
            return {}

        try:
            raw = self.profile_path.read_text(encoding="utf-8")
            data = json.loads(raw)
            return data if isinstance(data, dict) else {}
        except (json.JSONDecodeError, OSError):
            return {}

    def _write_profile(self, payload: dict) -> None:
        self.profile_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _parse_datetime(raw_value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(raw_value)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        return datetime.now(timezone.utc)

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
        now = datetime.now(timezone.utc)

        results: list[ProviderConnection] = []
        for provider in ("openai", "openrouter"):
            cached = profile.get(provider, {})
            connected = bool(cached.get("connected", False))
            via = str(cached.get("via", "none"))
            last_updated = cached.get("last_updated_at")

            if provider == "openai" and openai_key:
                connected, via = True, "api_key"
            if provider == "openrouter" and openrouter_key:
                connected, via = True, "api_key"

            if not connected:
                via = "none"

            results.append(
                ProviderConnection(
                    provider=provider,
                    connected=connected,
                    via=via,
                    last_updated_at=_parse_datetime(last_updated) if last_updated else now,
                )
            )

        return results

    def cache_status(self, provider: str, via: str, connected: bool = True) -> None:
        profile = self._load_profile()
        profile[provider] = {
            "connected": connected,
            "via": via if connected else "none",
            "last_updated_at": datetime.now(timezone.utc).isoformat(),
        }
        self._write_profile(profile)

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

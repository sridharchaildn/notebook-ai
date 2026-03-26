from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from .models import StoragePreference, SyncStatus


class StorageProfileStore:
    def __init__(self, storage_path: Path, sync_path: Path):
        self.storage_path = storage_path
        self.sync_path = sync_path
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        self.sync_path.parent.mkdir(parents=True, exist_ok=True)

    def get_preference(self, local_root: str) -> StoragePreference:
        data = self._read_json(self.storage_path)
        updated = data.get("updated_at")
        return StoragePreference(
            mode=str(data.get("mode") or "local"),
            local_root=str(data.get("local_root") or local_root),
            updated_at=_parse_datetime(str(updated)) if updated else None,
        )

    def set_preference(self, mode: str, local_root: str | None = None) -> StoragePreference:
        payload = {
            "mode": mode,
            "local_root": local_root,
            "updated_at": datetime.now(UTC).isoformat(),
        }
        self.storage_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        return StoragePreference(
            mode=mode, local_root=local_root, updated_at=_parse_datetime(str(payload["updated_at"]))
        )

    def get_sync_status(self) -> SyncStatus:
        data = self._read_json(self.sync_path)
        last_run = data.get("last_run_at")
        return SyncStatus(
            enabled=bool(data.get("enabled", False)),
            pending_ops=int(data.get("pending_ops", 0)),
            last_run_at=_parse_datetime(str(last_run)) if last_run else None,
            last_error=str(data.get("last_error")) if data.get("last_error") else None,
        )

    def mark_sync_run(self) -> SyncStatus:
        current = self.get_sync_status()
        payload = {
            "enabled": current.enabled,
            "pending_ops": 0,
            "last_run_at": datetime.now(UTC).isoformat(),
            "last_error": None,
        }
        self.sync_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        return SyncStatus(
            enabled=payload["enabled"],
            pending_ops=0,
            last_run_at=_parse_datetime(str(payload["last_run_at"])),
            last_error=None,
        )

    def enqueue_sync_operation(self) -> None:
        status = self.get_sync_status()
        payload = {
            "enabled": status.enabled,
            "pending_ops": status.pending_ops + 1,
            "last_run_at": status.last_run_at.isoformat() if status.last_run_at else None,
            "last_error": status.last_error,
        }
        self.sync_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    def set_sync_enabled(self, enabled: bool) -> SyncStatus:
        status = self.get_sync_status()
        payload = {
            "enabled": enabled,
            "pending_ops": status.pending_ops,
            "last_run_at": status.last_run_at.isoformat() if status.last_run_at else None,
            "last_error": status.last_error,
        }
        self.sync_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        return self.get_sync_status()

    @staticmethod
    def _read_json(path: Path) -> dict[str, object]:
        if not path.exists():
            return {}
        try:
            raw = path.read_text(encoding="utf-8")
            data = json.loads(raw)
            return data if isinstance(data, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}


def _parse_datetime(raw: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(raw)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed
    except ValueError:
        return None

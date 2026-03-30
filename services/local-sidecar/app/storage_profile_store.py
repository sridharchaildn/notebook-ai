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
        data = self._read_sync_payload()
        last_run = data.get("last_run_at")
        last_synced = data.get("last_synced_at")
        return SyncStatus(
            enabled=bool(data.get("enabled", False)),
            pending_ops=int(data.get("pending_ops", 0)),
            state=str(data.get("state") or "idle"),
            phase=str(data.get("phase") or "idle"),
            current_item=str(data.get("current_item")) if data.get("current_item") else None,
            completed_items=int(data.get("completed_items", 0)),
            total_items=int(data.get("total_items", 0)),
            last_run_at=_parse_datetime(str(last_run)) if last_run else None,
            last_synced_at=_parse_datetime(str(last_synced)) if last_synced else None,
            last_error=str(data.get("last_error")) if data.get("last_error") else None,
        )

    def mark_sync_run(self, consumed_ops: int | None = None) -> SyncStatus:
        current = self._read_sync_payload()
        now = datetime.now(UTC).isoformat()
        remaining_pending = int(current.get("pending_ops", 0))
        if consumed_ops is not None:
            remaining_pending = max(remaining_pending - max(consumed_ops, 0), 0)
        payload = {
            "enabled": bool(current.get("enabled", False)),
            "pending_ops": remaining_pending,
            "state": "idle",
            "phase": "idle",
            "current_item": None,
            "completed_items": int(current.get("total_items", 0)),
            "total_items": int(current.get("total_items", 0)),
            "last_run_at": now,
            "last_synced_at": now,
            "last_error": None,
            "deleted_note_ids": list(current.get("deleted_note_ids") or []),
            "deleted_folder_ids": list(current.get("deleted_folder_ids") or []),
        }
        self._write_sync_payload(payload)
        return self.get_sync_status()

    def enqueue_sync_operation(self) -> None:
        payload = self._read_sync_payload()
        payload = {
            "enabled": bool(payload.get("enabled", False)),
            "pending_ops": int(payload.get("pending_ops", 0)) + 1,
            "state": "idle" if payload.get("state") != "syncing" else "syncing",
            "phase": payload.get("phase") or "idle",
            "current_item": payload.get("current_item"),
            "completed_items": int(payload.get("completed_items", 0)),
            "total_items": int(payload.get("total_items", 0)),
            "last_run_at": payload.get("last_run_at"),
            "last_synced_at": payload.get("last_synced_at"),
            "last_error": payload.get("last_error"),
            "deleted_note_ids": list(payload.get("deleted_note_ids") or []),
            "deleted_folder_ids": list(payload.get("deleted_folder_ids") or []),
        }
        self._write_sync_payload(payload)

    def set_sync_enabled(self, enabled: bool) -> SyncStatus:
        status = self._read_sync_payload()
        payload = {
            "enabled": enabled,
            "pending_ops": int(status.get("pending_ops", 0)),
            "state": "idle" if enabled else "idle",
            "phase": "idle" if not enabled else str(status.get("phase") or "idle"),
            "current_item": None if not enabled else status.get("current_item"),
            "completed_items": 0 if not enabled else int(status.get("completed_items", 0)),
            "total_items": 0 if not enabled else int(status.get("total_items", 0)),
            "last_run_at": status.get("last_run_at"),
            "last_synced_at": status.get("last_synced_at"),
            "last_error": None if not enabled else status.get("last_error"),
            "deleted_note_ids": list(status.get("deleted_note_ids") or []),
            "deleted_folder_ids": list(status.get("deleted_folder_ids") or []),
        }
        self._write_sync_payload(payload)
        return self.get_sync_status()

    def mark_sync_started(self, total_items: int) -> SyncStatus:
        payload = self._read_sync_payload()
        payload.update(
            {
                "state": "syncing",
                "phase": "preparing",
                "current_item": None,
                "completed_items": 0,
                "total_items": max(total_items, 0),
                "last_error": None,
            }
        )
        self._write_sync_payload(payload)
        return self.get_sync_status()

    def mark_sync_progress(
        self,
        *,
        phase: str,
        completed_items: int,
        total_items: int,
        current_item: str | None = None,
    ) -> SyncStatus:
        payload = self._read_sync_payload()
        payload.update(
            {
                "state": "syncing",
                "phase": phase,
                "current_item": current_item,
                "completed_items": max(completed_items, 0),
                "total_items": max(total_items, 0),
            }
        )
        self._write_sync_payload(payload)
        return self.get_sync_status()

    def mark_sync_needs_setup(self, message: str) -> SyncStatus:
        payload = self._read_sync_payload()
        payload.update(
            {
                "state": "needs_setup",
                "phase": "idle",
                "current_item": None,
                "completed_items": 0,
                "total_items": 0,
                "last_error": message,
            }
        )
        self._write_sync_payload(payload)
        return self.get_sync_status()

    def mark_sync_error(self, message: str) -> SyncStatus:
        payload = self._read_sync_payload()
        payload.update(
            {
                "state": "error",
                "phase": "idle",
                "current_item": None,
                "last_error": message,
                "last_run_at": datetime.now(UTC).isoformat(),
            }
        )
        self._write_sync_payload(payload)
        return self.get_sync_status()

    def record_note_deletion(self, note_id: str) -> None:
        payload = self._read_sync_payload()
        deleted = {str(item) for item in payload.get("deleted_note_ids") or []}
        deleted.add(note_id)
        payload["deleted_note_ids"] = sorted(deleted)
        payload["pending_ops"] = int(payload.get("pending_ops", 0)) + 1
        self._write_sync_payload(payload)

    def record_folder_deletion(self, folder_id: str) -> None:
        payload = self._read_sync_payload()
        deleted = {str(item) for item in payload.get("deleted_folder_ids") or []}
        deleted.add(folder_id)
        payload["deleted_folder_ids"] = sorted(deleted)
        payload["pending_ops"] = int(payload.get("pending_ops", 0)) + 1
        self._write_sync_payload(payload)

    def deleted_note_ids(self) -> set[str]:
        payload = self._read_sync_payload()
        return {str(item) for item in payload.get("deleted_note_ids") or []}

    def deleted_folder_ids(self) -> set[str]:
        payload = self._read_sync_payload()
        return {str(item) for item in payload.get("deleted_folder_ids") or []}

    def clear_deleted_note(self, note_id: str) -> None:
        payload = self._read_sync_payload()
        payload["deleted_note_ids"] = sorted(
            item for item in {str(value) for value in payload.get("deleted_note_ids") or []} if item != note_id
        )
        self._write_sync_payload(payload)

    def clear_deleted_folder(self, folder_id: str) -> None:
        payload = self._read_sync_payload()
        payload["deleted_folder_ids"] = sorted(
            item for item in {str(value) for value in payload.get("deleted_folder_ids") or []} if item != folder_id
        )
        self._write_sync_payload(payload)

    def _read_sync_payload(self) -> dict[str, object]:
        payload = self._read_json(self.sync_path)
        return {
            "enabled": bool(payload.get("enabled", False)),
            "pending_ops": int(payload.get("pending_ops", 0)),
            "state": str(payload.get("state") or "idle"),
            "phase": str(payload.get("phase") or "idle"),
            "current_item": str(payload.get("current_item")) if payload.get("current_item") else None,
            "completed_items": int(payload.get("completed_items", 0)),
            "total_items": int(payload.get("total_items", 0)),
            "last_run_at": payload.get("last_run_at"),
            "last_synced_at": payload.get("last_synced_at"),
            "last_error": str(payload.get("last_error")) if payload.get("last_error") else None,
            "deleted_note_ids": [str(item) for item in payload.get("deleted_note_ids") or []],
            "deleted_folder_ids": [str(item) for item in payload.get("deleted_folder_ids") or []],
        }

    def _write_sync_payload(self, payload: dict[str, object]) -> None:
        self.sync_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

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

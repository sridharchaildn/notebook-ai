from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class NoteSyncRemoteState:
    remote_file_id: str | None = None
    last_synced_hash: str | None = None
    last_synced_updated_at: str | None = None


@dataclass
class FolderSyncRemoteState:
    remote_file_id: str | None = None
    last_synced_hash: str | None = None


@dataclass
class SyncQueueState:
    note_upserts: set[str] = field(default_factory=set)
    note_deletes: set[str] = field(default_factory=set)
    folders_dirty: bool = False
    full_reconcile_reason: str | None = None

    def pending_ops(self) -> int:
        count = len(self.note_upserts) + len(self.note_deletes)
        if self.folders_dirty:
            count += 1
        if self.full_reconcile_reason:
            count += 1
        return count


@dataclass
class SyncState:
    version: int = 1
    queue: SyncQueueState = field(default_factory=SyncQueueState)
    notes: dict[str, NoteSyncRemoteState] = field(default_factory=dict)
    folders: FolderSyncRemoteState = field(default_factory=FolderSyncRemoteState)

    def pending_ops(self) -> int:
        return self.queue.pending_ops()


class SyncStateStore:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def get_state(self) -> SyncState:
        payload = self._read_payload()
        notes_payload = payload.get("notes")
        folders_payload = payload.get("folders")
        queue_payload = payload.get("queue")
        return SyncState(
            version=int(payload.get("version", 1)),
            queue=SyncQueueState(
                note_upserts={str(item) for item in (queue_payload or {}).get("note_upserts") or []},
                note_deletes={str(item) for item in (queue_payload or {}).get("note_deletes") or []},
                folders_dirty=bool((queue_payload or {}).get("folders_dirty", False)),
                full_reconcile_reason=(
                    str((queue_payload or {}).get("full_reconcile_reason"))
                    if (queue_payload or {}).get("full_reconcile_reason")
                    else None
                ),
            ),
            notes={
                str(note_id): NoteSyncRemoteState(
                    remote_file_id=(
                        str(note_payload.get("remote_file_id"))
                        if isinstance(note_payload, dict) and note_payload.get("remote_file_id")
                        else None
                    ),
                    last_synced_hash=(
                        str(note_payload.get("last_synced_hash"))
                        if isinstance(note_payload, dict) and note_payload.get("last_synced_hash")
                        else None
                    ),
                    last_synced_updated_at=(
                        str(note_payload.get("last_synced_updated_at"))
                        if isinstance(note_payload, dict) and note_payload.get("last_synced_updated_at")
                        else None
                    ),
                )
                for note_id, note_payload in (notes_payload.items() if isinstance(notes_payload, dict) else [])
            },
            folders=FolderSyncRemoteState(
                remote_file_id=(
                    str(folders_payload.get("remote_file_id"))
                    if isinstance(folders_payload, dict) and folders_payload.get("remote_file_id")
                    else None
                ),
                last_synced_hash=(
                    str(folders_payload.get("last_synced_hash"))
                    if isinstance(folders_payload, dict) and folders_payload.get("last_synced_hash")
                    else None
                ),
            ),
        )

    def pending_ops(self) -> int:
        return self.get_state().pending_ops()

    def queue_note_upsert(self, note_id: str) -> SyncState:
        state = self.get_state()
        state.queue.note_deletes.discard(note_id)
        state.queue.note_upserts.add(note_id)
        self._write_state(state)
        return state

    def queue_note_upserts(self, note_ids: list[str] | tuple[str, ...] | set[str]) -> SyncState:
        state = self.get_state()
        for note_id in note_ids:
            if not note_id:
                continue
            state.queue.note_deletes.discard(note_id)
            state.queue.note_upserts.add(note_id)
        self._write_state(state)
        return state

    def clear_note_upsert(self, note_id: str) -> SyncState:
        state = self.get_state()
        state.queue.note_upserts.discard(note_id)
        self._write_state(state)
        return state

    def queue_note_delete(self, note_id: str) -> SyncState:
        state = self.get_state()
        state.queue.note_upserts.discard(note_id)
        state.queue.note_deletes.add(note_id)
        self._write_state(state)
        return state

    def clear_note_delete(self, note_id: str) -> SyncState:
        state = self.get_state()
        state.queue.note_deletes.discard(note_id)
        self._write_state(state)
        return state

    def mark_folders_dirty(self) -> SyncState:
        state = self.get_state()
        state.queue.folders_dirty = True
        self._write_state(state)
        return state

    def clear_folders_dirty(self) -> SyncState:
        state = self.get_state()
        state.queue.folders_dirty = False
        self._write_state(state)
        return state

    def request_full_reconcile(self, reason: str) -> SyncState:
        state = self.get_state()
        state.queue.full_reconcile_reason = reason
        self._write_state(state)
        return state

    def clear_full_reconcile(self) -> SyncState:
        state = self.get_state()
        state.queue.full_reconcile_reason = None
        self._write_state(state)
        return state

    def get_note_remote_state(self, note_id: str) -> NoteSyncRemoteState | None:
        return self.get_state().notes.get(note_id)

    def upsert_note_remote_state(
        self,
        note_id: str,
        *,
        remote_file_id: str | None,
        last_synced_hash: str | None,
        last_synced_updated_at: str | None,
    ) -> SyncState:
        state = self.get_state()
        state.notes[note_id] = NoteSyncRemoteState(
            remote_file_id=remote_file_id,
            last_synced_hash=last_synced_hash,
            last_synced_updated_at=last_synced_updated_at,
        )
        self._write_state(state)
        return state

    def clear_note_remote_state(self, note_id: str) -> SyncState:
        state = self.get_state()
        state.notes.pop(note_id, None)
        self._write_state(state)
        return state

    def set_folder_remote_state(self, *, remote_file_id: str | None, last_synced_hash: str | None) -> SyncState:
        state = self.get_state()
        state.folders = FolderSyncRemoteState(
            remote_file_id=remote_file_id,
            last_synced_hash=last_synced_hash,
        )
        self._write_state(state)
        return state

    def replace_index(
        self,
        *,
        notes: dict[str, NoteSyncRemoteState],
        folders: FolderSyncRemoteState,
    ) -> SyncState:
        state = self.get_state()
        state.notes = dict(notes)
        state.folders = folders
        self._write_state(state)
        return state

    def save_state(self, state: SyncState) -> SyncState:
        self._write_state(state)
        return state

    def _read_payload(self) -> dict[str, object]:
        if not self.path.exists():
            return {}
        try:
            raw = self.path.read_text(encoding="utf-8")
            payload = json.loads(raw)
            return payload if isinstance(payload, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}

    def _write_state(self, state: SyncState) -> None:
        payload = {
            "version": state.version,
            "queue": {
                "note_upserts": sorted(state.queue.note_upserts),
                "note_deletes": sorted(state.queue.note_deletes),
                "folders_dirty": state.queue.folders_dirty,
                "full_reconcile_reason": state.queue.full_reconcile_reason,
            },
            "notes": {
                note_id: {
                    "remote_file_id": note_state.remote_file_id,
                    "last_synced_hash": note_state.last_synced_hash,
                    "last_synced_updated_at": note_state.last_synced_updated_at,
                }
                for note_id, note_state in sorted(state.notes.items())
            },
            "folders": {
                "remote_file_id": state.folders.remote_file_id,
                "last_synced_hash": state.folders.last_synced_hash,
            },
        }
        self.path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

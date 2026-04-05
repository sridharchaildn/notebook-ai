from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlparse

import httpx

from ..config import Settings
from ..models import FolderNode, NoteDocument, SyncStatus
from ..notes_store import NoteStore
from ..storage_profile_store import StorageProfileStore
from ..sync_state_store import FolderSyncRemoteState, NoteSyncRemoteState, SyncState, SyncStateStore

log = logging.getLogger("notebook.sidecar.drive_sync")

DRIVE_API_BASE = "https://www.googleapis.com/drive/v3"
DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3"
FOLDERS_FILENAME = ".folders.json"
NOTE_FILENAME_SUFFIX = ".note.json"


@dataclass
class RemoteFile:
    id: str
    name: str
    mime_type: str | None = None
    modified_time: str | None = None


@dataclass
class RemoteNote:
    file_id: str
    document: NoteDocument


class DriveSyncService:
    def __init__(
        self,
        settings: Settings,
        note_store: NoteStore,
        profile_store: StorageProfileStore,
        sync_state_store: SyncStateStore,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.settings = settings
        self.note_store = note_store
        self.profile_store = profile_store
        self.sync_state_store = sync_state_store
        self.transport = transport
        self._desktop_access_token: str | None = None
        self._sync_task: asyncio.Task[SyncStatus] | None = None
        self._lock = asyncio.Lock()

    def remember_desktop_session(self, access_token: str | None) -> None:
        if access_token:
            self._desktop_access_token = access_token
            self.schedule_if_needed()

    def get_status(self) -> SyncStatus:
        status = self.profile_store.get_sync_status()
        pending_ops = self.sync_state_store.pending_ops()
        if status.pending_ops == pending_ops:
            return status
        return status.model_copy(update={"pending_ops": pending_ops})

    def request_sync(self) -> SyncStatus:
        return self.request_full_resync()

    def request_note_upsert(self, note_id: str) -> SyncStatus:
        if not self.get_status().enabled:
            return self.get_status()
        self.sync_state_store.queue_note_upsert(note_id)
        self._update_pending_ops()
        self.schedule_if_needed()
        return self.get_status()

    def request_note_upserts(self, note_ids: list[str] | tuple[str, ...] | set[str]) -> SyncStatus:
        if not self.get_status().enabled:
            return self.get_status()
        self.sync_state_store.queue_note_upserts(note_ids)
        self._update_pending_ops()
        self.schedule_if_needed()
        return self.get_status()

    def request_folder_sync(self) -> SyncStatus:
        if not self.get_status().enabled:
            return self.get_status()
        self.sync_state_store.mark_folders_dirty()
        self._update_pending_ops()
        self.schedule_if_needed()
        return self.get_status()

    def request_full_resync(self, reason: str = "Full reconcile requested.") -> SyncStatus:
        if not self.get_status().enabled:
            return self.get_status()
        self.sync_state_store.request_full_reconcile(reason)
        self._update_pending_ops()
        self.schedule_if_needed()
        return self.get_status()

    def record_note_deletion(self, note_id: str) -> SyncStatus:
        if not self.get_status().enabled:
            return self.get_status()
        self.profile_store.record_note_deletion(note_id)
        self.sync_state_store.queue_note_delete(note_id)
        self._update_pending_ops()
        self.schedule_if_needed()
        return self.get_status()

    def record_folder_deletion(self, folder_id: str, moved_note_ids: list[str]) -> SyncStatus:
        if not self.get_status().enabled:
            return self.get_status()
        self.profile_store.record_folder_deletion(folder_id)
        self.sync_state_store.mark_folders_dirty()
        self.sync_state_store.queue_note_upserts(moved_note_ids)
        self._update_pending_ops()
        self.schedule_if_needed()
        return self.get_status()

    def schedule_if_needed(self) -> None:
        status = self.get_status()
        if not status.enabled or not self._desktop_access_token:
            return
        if self.sync_state_store.pending_ops() <= 0:
            return
        if self._sync_task and not self._sync_task.done():
            return
        log.info("Drive sync scheduled pending_ops=%s", self.sync_state_store.pending_ops())
        self._sync_task = asyncio.create_task(self.run_sync())

    async def run_sync(self) -> SyncStatus:
        async with self._lock:
            return await self._run_sync_internal()

    async def run_sync_now(self) -> SyncStatus:
        task = self._sync_task
        if task and not task.done():
            log.info("Drive sync already in progress; waiting for current run")
            return await task
        log.info("Drive sync requested manually")
        self._sync_task = asyncio.create_task(self.run_sync())
        return await self._sync_task

    async def _run_sync_internal(self) -> SyncStatus:
        status = self.get_status()
        log.info("Drive sync starting enabled=%s pending_ops=%s", status.enabled, status.pending_ops)
        if not status.enabled:
            return status

        desktop_access_token = self._desktop_access_token
        if not desktop_access_token:
            log.info("Drive sync blocked: missing desktop session")
            return self.profile_store.mark_sync_needs_setup("Sign in again to resume Google Drive sync.")

        try:
            log.info("Drive sync checking Drive connection via cloud API")
            drive_status = await self._fetch_drive_status(desktop_access_token)
        except Exception as exc:
            log.exception("Drive sync failed while loading cloud status")
            return self.profile_store.mark_sync_error(self._format_sync_error(exc, service_name="cloud API"))

        if not drive_status.get("connected"):
            log.info("Drive sync needs setup: Google Drive is not connected")
            return self.profile_store.mark_sync_needs_setup(
                "Connect Google Drive to start mirroring your local workspace."
            )

        try:
            log.info("Drive sync requesting Drive access token from cloud API")
            drive_access = await self._fetch_drive_access_token(desktop_access_token)
            folder_name = str(
                drive_access.get("folder_name")
                or drive_status.get("folder_name")
                or "Notebook AI"
            )
            folder_id = await self._ensure_remote_folder(
                desktop_access_token=desktop_access_token,
                drive_access_token=str(drive_access["access_token"]),
                folder_id=str(drive_access.get("folder_id") or drive_status.get("folder_id") or "") or None,
                folder_name=folder_name,
            )
            state = self.sync_state_store.get_state()
            log.info(
                "Drive sync ready mode=%s folder_name=%s folder_id=%s pending_ops=%s",
                "full_reconcile" if state.queue.full_reconcile_reason else "incremental",
                folder_name,
                folder_id,
                state.pending_ops(),
            )
            if state.queue.full_reconcile_reason:
                final_status = await self._run_full_reconcile(
                    drive_access_token=str(drive_access["access_token"]),
                    folder_id=folder_id,
                )
            else:
                final_status = await self._run_incremental_sync(
                    drive_access_token=str(drive_access["access_token"]),
                    folder_id=folder_id,
                    state=state,
            )
            if final_status.pending_ops > 0:
                self.schedule_if_needed()
            log.info(
                "Drive sync completed state=%s pending_ops=%s last_synced_at=%s",
                final_status.state,
                final_status.pending_ops,
                final_status.last_synced_at,
            )
            return final_status
        except Exception as exc:
            log.exception("Drive sync failed")
            return self.profile_store.mark_sync_error(self._format_sync_error(exc))

    async def _run_full_reconcile(
        self,
        *,
        drive_access_token: str,
        folder_id: str,
    ) -> SyncStatus:
        remote_files = await self._list_remote_files(drive_access_token, folder_id)
        remote_file_by_name = {item.name: item for item in remote_files}
        remote_notes = await self._load_remote_notes(drive_access_token, remote_file_by_name)
        remote_folders_file = remote_file_by_name.get(FOLDERS_FILENAME)
        remote_folders = await self._load_remote_folders(
            drive_access_token,
            remote_folders_file,
        )

        local_folders = self.note_store.list_folders()
        deleted_folder_ids = self.profile_store.deleted_folder_ids()

        total_items = 1 + len(set(self.note_store_note_ids()).union(remote_notes)) + len(self.profile_store.deleted_note_ids())
        log.info(
            "Drive sync full reconcile items=%s remote_notes=%s deleted_notes=%s deleted_folders=%s",
            total_items,
            len(remote_notes),
            len(self.profile_store.deleted_note_ids()),
            len(deleted_folder_ids),
        )
        self.profile_store.mark_sync_started(total_items=max(total_items, 1))

        completed_items = 0
        self.profile_store.mark_sync_progress(
            phase="pulling",
            completed_items=completed_items,
            total_items=max(total_items, 1),
            current_item="Loading Google Drive mirror",
        )

        merged_folders = self._merge_folders(local_folders, remote_folders, deleted_folder_ids)
        local_folders_payload = self.note_store.serialize_folders(local_folders)
        merged_folders_payload = self.note_store.serialize_folders(merged_folders)
        remote_folders_payload = self.note_store.serialize_folders(remote_folders)
        folder_remote_file_id = remote_folders_file.id if remote_folders_file else None

        self.profile_store.mark_sync_progress(
            phase="merging",
            completed_items=completed_items,
            total_items=max(total_items, 1),
            current_item="Folders",
        )
        if self._canonical_json(local_folders_payload) != self._canonical_json(merged_folders_payload):
            self.note_store.replace_folders(merged_folders)

        if (
            remote_folders_file is None
            or self._canonical_json(remote_folders_payload) != self._canonical_json(merged_folders_payload)
        ):
            folder_remote_file_id = await self._upload_json_file(
                drive_access_token=drive_access_token,
                folder_id=folder_id,
                remote_file=remote_folders_file,
                name=FOLDERS_FILENAME,
                content=merged_folders_payload,
            )

        for deleted_folder_id in list(deleted_folder_ids):
            if all(folder.id != deleted_folder_id for folder in merged_folders):
                self.profile_store.clear_deleted_folder(deleted_folder_id)

        completed_items += 1
        local_notes = {note.frontmatter.id: note for note in self.note_store.list_notes()}
        deleted_note_ids = self.profile_store.deleted_note_ids()
        note_ids = sorted(set(local_notes).union(remote_notes).union(deleted_note_ids))
        synced_note_states: dict[str, NoteSyncRemoteState] = {}

        for note_id in note_ids:
            local_note = local_notes.get(note_id)
            remote_note = remote_notes.get(note_id)

            if note_id in deleted_note_ids:
                if remote_note:
                    self.profile_store.mark_sync_progress(
                        phase="pushing",
                        completed_items=completed_items,
                        total_items=max(total_items, 1),
                        current_item=f"Removing {note_id}",
                    )
                    await self._delete_remote_file(drive_access_token, remote_note.file_id)
                if self.note_store.get_note(note_id) is None:
                    self.profile_store.clear_deleted_note(note_id)
                completed_items += 1
                continue

            display_name = local_note.frontmatter.title if local_note else remote_note.document.frontmatter.title
            remote_file_id: str | None = remote_note.file_id if remote_note else None
            synced_document: NoteDocument | None = local_note

            if local_note and not remote_note:
                self.profile_store.mark_sync_progress(
                    phase="pushing",
                    completed_items=completed_items,
                    total_items=max(total_items, 1),
                    current_item=display_name,
                )
                remote_file_id = await self._upload_note(
                    drive_access_token=drive_access_token,
                    folder_id=folder_id,
                    remote_file=None,
                    note=local_note,
                )
                synced_document = local_note
            elif remote_note and not local_note:
                self.profile_store.mark_sync_progress(
                    phase="pulling",
                    completed_items=completed_items,
                    total_items=max(total_items, 1),
                    current_item=display_name,
                )
                synced_document = self.note_store.save_note_document(remote_note.document)
                local_notes[note_id] = synced_document
            elif local_note and remote_note:
                resolution = self._resolve_note_conflict(local_note, remote_note.document)
                if resolution == "remote":
                    self.profile_store.mark_sync_progress(
                        phase="pulling",
                        completed_items=completed_items,
                        total_items=max(total_items, 1),
                        current_item=display_name,
                    )
                    synced_document = self.note_store.save_note_document(remote_note.document)
                    local_notes[note_id] = synced_document
                elif resolution == "local":
                    self.profile_store.mark_sync_progress(
                        phase="pushing",
                        completed_items=completed_items,
                        total_items=max(total_items, 1),
                        current_item=display_name,
                    )
                    remote_file_id = await self._upload_note(
                        drive_access_token=drive_access_token,
                        folder_id=folder_id,
                        remote_file=RemoteFile(id=remote_note.file_id, name=self._note_filename(note_id)),
                        note=local_note,
                    )
                    synced_document = local_note
                else:
                    self.profile_store.mark_sync_progress(
                        phase="merging",
                        completed_items=completed_items,
                        total_items=max(total_items, 1),
                        current_item=display_name,
                    )
                    synced_document = local_note
            else:
                self.profile_store.mark_sync_progress(
                    phase="merging",
                    completed_items=completed_items,
                    total_items=max(total_items, 1),
                    current_item=display_name,
                )

            if synced_document is not None and remote_file_id is not None:
                synced_note_states[note_id] = NoteSyncRemoteState(
                    remote_file_id=remote_file_id,
                    last_synced_hash=self._note_hash(synced_document),
                    last_synced_updated_at=synced_document.frontmatter.updated_at.isoformat(),
                )

            completed_items += 1

        self.profile_store.mark_sync_progress(
            phase="finalizing",
            completed_items=completed_items,
            total_items=max(total_items, 1),
            current_item="Finalizing mirror state",
        )

        self.sync_state_store.replace_index(
            notes=synced_note_states,
            folders=FolderSyncRemoteState(
                remote_file_id=folder_remote_file_id,
                last_synced_hash=self._payload_hash(merged_folders_payload),
            ),
        )
        self._finalize_full_reconcile_queue(
            synced_note_states=synced_note_states,
            synced_folder_hash=self._payload_hash(merged_folders_payload),
        )
        self.profile_store.mark_sync_run()
        self._update_pending_ops()
        return self.get_status()

    async def _run_incremental_sync(
        self,
        *,
        drive_access_token: str,
        folder_id: str,
        state: SyncState,
    ) -> SyncStatus:
        total_items = (
            len(state.queue.note_upserts)
            + len(state.queue.note_deletes)
            + (1 if state.queue.folders_dirty else 0)
        )
        log.info(
            "Drive sync incremental items=%s note_upserts=%s note_deletes=%s folders_dirty=%s",
            total_items,
            len(state.queue.note_upserts),
            len(state.queue.note_deletes),
            state.queue.folders_dirty,
        )
        if total_items <= 0:
            self._update_pending_ops()
            return self.get_status()

        self.profile_store.mark_sync_started(total_items=max(total_items, 1))
        completed_items = 0

        if state.queue.folders_dirty:
            self.profile_store.mark_sync_progress(
                phase="pulling",
                completed_items=completed_items,
                total_items=max(total_items, 1),
                current_item="Folders",
            )
            await self._sync_folders_incrementally(
                drive_access_token=drive_access_token,
                folder_id=folder_id,
            )
            completed_items += 1

        for note_id in sorted(state.queue.note_deletes):
            self.profile_store.mark_sync_progress(
                phase="pushing",
                completed_items=completed_items,
                total_items=max(total_items, 1),
                current_item=f"Removing {note_id}",
            )
            await self._sync_note_delete_incrementally(
                drive_access_token=drive_access_token,
                folder_id=folder_id,
                note_id=note_id,
            )
            completed_items += 1

        for note_id in sorted(state.queue.note_upserts):
            note = self.note_store.get_note(note_id)
            display_name = note.frontmatter.title if note else note_id
            self.profile_store.mark_sync_progress(
                phase="merging",
                completed_items=completed_items,
                total_items=max(total_items, 1),
                current_item=display_name,
            )
            await self._sync_note_upsert_incrementally(
                drive_access_token=drive_access_token,
                folder_id=folder_id,
                note_id=note_id,
            )
            completed_items += 1

        self.profile_store.mark_sync_progress(
            phase="finalizing",
            completed_items=completed_items,
            total_items=max(total_items, 1),
            current_item="Finalizing mirror state",
        )
        self.profile_store.mark_sync_run()
        self._update_pending_ops()
        return self.get_status()

    async def _sync_folders_incrementally(
        self,
        *,
        drive_access_token: str,
        folder_id: str,
    ) -> None:
        current_state = self.sync_state_store.get_state()
        remote_file = await self._resolve_named_file(
            drive_access_token=drive_access_token,
            folder_id=folder_id,
            file_name=FOLDERS_FILENAME,
            cached_file_id=current_state.folders.remote_file_id,
        )
        remote_folders = await self._load_remote_folders(drive_access_token, remote_file)
        local_folders = self.note_store.list_folders()
        merged_folders = self._merge_folders(
            local_folders,
            remote_folders,
            self.profile_store.deleted_folder_ids(),
        )

        local_payload = self.note_store.serialize_folders(local_folders)
        merged_payload = self.note_store.serialize_folders(merged_folders)
        remote_payload = self.note_store.serialize_folders(remote_folders)
        remote_file_id = remote_file.id if remote_file else None

        if self._canonical_json(local_payload) != self._canonical_json(merged_payload):
            self.note_store.replace_folders(merged_folders)

        if remote_file is None or self._canonical_json(remote_payload) != self._canonical_json(merged_payload):
            remote_file_id = await self._upload_json_file(
                drive_access_token=drive_access_token,
                folder_id=folder_id,
                remote_file=remote_file,
                name=FOLDERS_FILENAME,
                content=merged_payload,
            )

        self.sync_state_store.set_folder_remote_state(
            remote_file_id=remote_file_id,
            last_synced_hash=self._payload_hash(merged_payload),
        )

        current_folder_hash = self._payload_hash(self.note_store.serialize_folders())
        if current_folder_hash == self._payload_hash(merged_payload):
            self.sync_state_store.clear_folders_dirty()

        for deleted_folder_id in list(self.profile_store.deleted_folder_ids()):
            if all(folder.id != deleted_folder_id for folder in merged_folders):
                self.profile_store.clear_deleted_folder(deleted_folder_id)

    async def _sync_note_delete_incrementally(
        self,
        *,
        drive_access_token: str,
        folder_id: str,
        note_id: str,
    ) -> None:
        remote_state = self.sync_state_store.get_note_remote_state(note_id)
        remote_file = await self._resolve_named_file(
            drive_access_token=drive_access_token,
            folder_id=folder_id,
            file_name=self._note_filename(note_id),
            cached_file_id=remote_state.remote_file_id if remote_state else None,
        )
        if remote_file is not None:
            await self._delete_remote_file(drive_access_token, remote_file.id)

        self.sync_state_store.clear_note_remote_state(note_id)
        if self.note_store.get_note(note_id) is None:
            self.sync_state_store.clear_note_delete(note_id)
            self.profile_store.clear_deleted_note(note_id)

    async def _sync_note_upsert_incrementally(
        self,
        *,
        drive_access_token: str,
        folder_id: str,
        note_id: str,
    ) -> None:
        local_note = self.note_store.get_note(note_id)
        if local_note is None:
            self.sync_state_store.clear_note_upsert(note_id)
            return

        local_hash = self._note_hash(local_note)
        remote_state = self.sync_state_store.get_note_remote_state(note_id)
        remote_file = await self._resolve_named_file(
            drive_access_token=drive_access_token,
            folder_id=folder_id,
            file_name=self._note_filename(note_id),
            cached_file_id=remote_state.remote_file_id if remote_state else None,
        )
        remote_note = await self._load_remote_note(drive_access_token, remote_file) if remote_file else None

        if remote_note is None:
            remote_file_id = await self._upload_note(
                drive_access_token=drive_access_token,
                folder_id=folder_id,
                remote_file=None,
                note=local_note,
            )
            self.sync_state_store.upsert_note_remote_state(
                note_id,
                remote_file_id=remote_file_id,
                last_synced_hash=local_hash,
                last_synced_updated_at=local_note.frontmatter.updated_at.isoformat(),
            )
            current_local = self.note_store.get_note(note_id)
            if current_local and self._note_hash(current_local) == local_hash:
                self.sync_state_store.clear_note_upsert(note_id)
            return

        remote_hash = self._note_hash(remote_note.document)
        last_synced_hash = remote_state.last_synced_hash if remote_state else None
        action = self._determine_incremental_action(
            local_note=local_note,
            local_hash=local_hash,
            remote_note=remote_note.document,
            remote_hash=remote_hash,
            last_synced_hash=last_synced_hash,
        )

        if action == "remote":
            current_local = self.note_store.get_note(note_id)
            if current_local is not None:
                current_hash = self._note_hash(current_local)
                if current_hash != local_hash:
                    local_note = current_local
                    local_hash = current_hash
                    action = self._determine_incremental_action(
                        local_note=local_note,
                        local_hash=local_hash,
                        remote_note=remote_note.document,
                        remote_hash=remote_hash,
                        last_synced_hash=last_synced_hash,
                    )

        if action == "local":
            remote_file_id = await self._upload_note(
                drive_access_token=drive_access_token,
                folder_id=folder_id,
                remote_file=RemoteFile(id=remote_note.file_id, name=self._note_filename(note_id)),
                note=local_note,
            )
            synced_hash = local_hash
            synced_updated_at = local_note.frontmatter.updated_at.isoformat()
        elif action == "remote":
            synced_document = self.note_store.save_note_document(remote_note.document)
            synced_hash = remote_hash
            synced_updated_at = synced_document.frontmatter.updated_at.isoformat()
            remote_file_id = remote_note.file_id
        else:
            synced_document = self.note_store.get_note(note_id) or local_note
            synced_hash = self._note_hash(synced_document)
            synced_updated_at = synced_document.frontmatter.updated_at.isoformat()
            remote_file_id = remote_note.file_id

        self.sync_state_store.upsert_note_remote_state(
            note_id,
            remote_file_id=remote_file_id,
            last_synced_hash=synced_hash,
            last_synced_updated_at=synced_updated_at,
        )
        current_local = self.note_store.get_note(note_id)
        if current_local and self._note_hash(current_local) == synced_hash:
            self.sync_state_store.clear_note_upsert(note_id)

    def _determine_incremental_action(
        self,
        *,
        local_note: NoteDocument,
        local_hash: str,
        remote_note: NoteDocument,
        remote_hash: str,
        last_synced_hash: str | None,
    ) -> str | None:
        if local_hash == remote_hash:
            return None
        if last_synced_hash:
            local_changed = local_hash != last_synced_hash
            remote_changed = remote_hash != last_synced_hash
            if local_changed and not remote_changed:
                return "local"
            if remote_changed and not local_changed:
                return "remote"
        return self._resolve_note_conflict(local_note, remote_note)

    def _finalize_full_reconcile_queue(
        self,
        *,
        synced_note_states: dict[str, NoteSyncRemoteState],
        synced_folder_hash: str,
    ) -> None:
        state = self.sync_state_store.get_state()
        for note_id in list(state.queue.note_upserts):
            current_local = self.note_store.get_note(note_id)
            synced_state = synced_note_states.get(note_id)
            if current_local and synced_state and self._note_hash(current_local) == synced_state.last_synced_hash:
                state.queue.note_upserts.discard(note_id)

        for note_id in list(state.queue.note_deletes):
            if self.note_store.get_note(note_id) is None:
                state.queue.note_deletes.discard(note_id)

        current_folder_hash = self._payload_hash(self.note_store.serialize_folders())
        if current_folder_hash == synced_folder_hash:
            state.queue.folders_dirty = False

        state.queue.full_reconcile_reason = None
        self.sync_state_store.save_state(state)

    def _update_pending_ops(self) -> SyncStatus:
        return self.profile_store.set_pending_ops(self.sync_state_store.pending_ops())

    def note_store_note_ids(self) -> set[str]:
        return {note.frontmatter.id for note in self.note_store.list_notes()}

    def _format_sync_error(self, exc: Exception, *, service_name: str | None = None) -> str:
        if isinstance(exc, httpx.RequestError):
            host = exc.request.url.host if exc.request else None
            cloud_host = urlparse(self.settings.cloud_api_url).hostname
            resolved_service = service_name
            if resolved_service is None:
                if host == "www.googleapis.com":
                    resolved_service = "Google Drive API"
                elif cloud_host and host == cloud_host:
                    resolved_service = "cloud API"
                else:
                    resolved_service = "remote service"

            host_detail = f" ({host})" if host else ""
            return f"Unable to reach {resolved_service}{host_detail}: {exc}"

        return str(exc)

    async def _fetch_drive_status(self, desktop_access_token: str) -> dict[str, Any]:
        response = await self._cloud_request(
            "GET",
            "/integrations/google-drive/status",
            desktop_access_token=desktop_access_token,
        )
        return response.json()

    async def _fetch_drive_access_token(self, desktop_access_token: str) -> dict[str, Any]:
        response = await self._cloud_request(
            "POST",
            "/integrations/google-drive/access-token",
            desktop_access_token=desktop_access_token,
        )
        return response.json()

    async def _persist_drive_folder(
        self,
        desktop_access_token: str,
        folder_id: str,
        folder_name: str,
    ) -> None:
        await self._cloud_request(
            "PUT",
            "/integrations/google-drive/folder",
            desktop_access_token=desktop_access_token,
            json_body={"folder_id": folder_id, "folder_name": folder_name},
        )

    async def _cloud_request(
        self,
        method: str,
        path: str,
        *,
        desktop_access_token: str,
        json_body: object | None = None,
    ) -> httpx.Response:
        log.debug("Drive sync cloud request method=%s path=%s", method, path)
        async with httpx.AsyncClient(timeout=20.0, transport=self.transport) as client:
            response = await client.request(
                method,
                f"{self.settings.cloud_api_url.rstrip('/')}{path}",
                json=json_body,
                headers={"Authorization": f"Bearer {desktop_access_token}"},
            )
        response.raise_for_status()
        return response

    async def _drive_request(
        self,
        method: str,
        url: str,
        *,
        drive_access_token: str,
        params: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
        content: bytes | None = None,
        json_body: object | None = None,
    ) -> httpx.Response:
        log.debug("Drive sync drive request method=%s url=%s", method, url)
        req_headers = {
            "Authorization": f"Bearer {drive_access_token}",
            **(headers or {}),
        }
        async with httpx.AsyncClient(timeout=30.0, transport=self.transport) as client:
            response = await client.request(
                method,
                url,
                params=params,
                headers=req_headers,
                content=content,
                json=json_body,
            )
        response.raise_for_status()
        return response

    async def _ensure_remote_folder(
        self,
        *,
        desktop_access_token: str,
        drive_access_token: str,
        folder_id: str | None,
        folder_name: str,
    ) -> str:
        if folder_id:
            existing = await self._fetch_remote_file_metadata(drive_access_token, folder_id)
            if existing is not None:
                return existing.id

        existing = await self._find_named_root_folder(drive_access_token, folder_name)
        if existing:
            await self._persist_drive_folder(desktop_access_token, existing.id, folder_name)
            return existing.id

        created = await self._drive_request(
            "POST",
            f"{DRIVE_API_BASE}/files",
            drive_access_token=drive_access_token,
            params={"fields": "id,name"},
            headers={"Content-Type": "application/json"},
            json_body={
                "name": folder_name,
                "mimeType": "application/vnd.google-apps.folder",
            },
        )
        payload = created.json()
        created_folder_id = str(payload["id"])
        await self._persist_drive_folder(desktop_access_token, created_folder_id, folder_name)
        return created_folder_id

    async def _fetch_remote_file_metadata(self, drive_access_token: str, file_id: str) -> RemoteFile | None:
        try:
            response = await self._drive_request(
                "GET",
                f"{DRIVE_API_BASE}/files/{file_id}",
                drive_access_token=drive_access_token,
                params={"fields": "id,name,mimeType,modifiedTime"},
            )
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                return None
            raise

        payload = response.json()
        return RemoteFile(
            id=str(payload["id"]),
            name=str(payload.get("name") or file_id),
            mime_type=str(payload.get("mimeType")) if payload.get("mimeType") else None,
            modified_time=str(payload.get("modifiedTime")) if payload.get("modifiedTime") else None,
        )

    async def _find_named_root_folder(self, drive_access_token: str, folder_name: str) -> RemoteFile | None:
        query = (
            f"name = '{self._escape_drive_query(folder_name)}' "
            "and mimeType = 'application/vnd.google-apps.folder' "
            "and trashed = false and 'root' in parents"
        )
        response = await self._drive_request(
            "GET",
            f"{DRIVE_API_BASE}/files",
            drive_access_token=drive_access_token,
            params={"q": query, "fields": "files(id,name,mimeType,modifiedTime)", "pageSize": "10"},
        )
        files = response.json().get("files") or []
        if not files:
            return None
        first = files[0]
        return RemoteFile(
            id=str(first["id"]),
            name=str(first["name"]),
            mime_type=str(first.get("mimeType")) if first.get("mimeType") else None,
            modified_time=str(first.get("modifiedTime")) if first.get("modifiedTime") else None,
        )

    async def _list_remote_files(self, drive_access_token: str, folder_id: str) -> list[RemoteFile]:
        query = f"'{self._escape_drive_query(folder_id)}' in parents and trashed = false"
        response = await self._drive_request(
            "GET",
            f"{DRIVE_API_BASE}/files",
            drive_access_token=drive_access_token,
            params={"q": query, "fields": "files(id,name,mimeType,modifiedTime)", "pageSize": "1000"},
        )
        payload = response.json()
        files = payload.get("files") or []
        return [
            RemoteFile(
                id=str(file["id"]),
                name=str(file["name"]),
                mime_type=str(file.get("mimeType")) if file.get("mimeType") else None,
                modified_time=str(file.get("modifiedTime")) if file.get("modifiedTime") else None,
            )
            for file in files
            if file.get("id") and file.get("name")
        ]

    async def _resolve_named_file(
        self,
        *,
        drive_access_token: str,
        folder_id: str,
        file_name: str,
        cached_file_id: str | None,
    ) -> RemoteFile | None:
        if cached_file_id:
            cached = await self._fetch_remote_file_metadata(drive_access_token, cached_file_id)
            if cached is not None:
                return cached
        return await self._find_named_file(drive_access_token, folder_id, file_name)

    async def _find_named_file(
        self,
        drive_access_token: str,
        folder_id: str,
        file_name: str,
    ) -> RemoteFile | None:
        query = (
            f"name = '{self._escape_drive_query(file_name)}' "
            f"and '{self._escape_drive_query(folder_id)}' in parents "
            "and trashed = false"
        )
        response = await self._drive_request(
            "GET",
            f"{DRIVE_API_BASE}/files",
            drive_access_token=drive_access_token,
            params={"q": query, "fields": "files(id,name,mimeType,modifiedTime)", "pageSize": "10"},
        )
        files = response.json().get("files") or []
        if not files:
            return None
        first = files[0]
        return RemoteFile(
            id=str(first["id"]),
            name=str(first["name"]),
            mime_type=str(first.get("mimeType")) if first.get("mimeType") else None,
            modified_time=str(first.get("modifiedTime")) if first.get("modifiedTime") else None,
        )

    async def _load_remote_notes(
        self,
        drive_access_token: str,
        remote_file_by_name: dict[str, RemoteFile],
    ) -> dict[str, RemoteNote]:
        remote_notes: dict[str, RemoteNote] = {}
        for name, remote in remote_file_by_name.items():
            if not name.endswith(NOTE_FILENAME_SUFFIX):
                continue
            loaded = await self._load_remote_note(drive_access_token, remote)
            if loaded is None:
                continue
            remote_notes[loaded.document.frontmatter.id] = loaded
        return remote_notes

    async def _load_remote_note(
        self,
        drive_access_token: str,
        remote_file: RemoteFile | None,
    ) -> RemoteNote | None:
        if remote_file is None:
            return None
        response = await self._drive_request(
            "GET",
            f"{DRIVE_API_BASE}/files/{remote_file.id}",
            drive_access_token=drive_access_token,
            params={"alt": "media"},
        )
        try:
            payload = json.loads(response.text)
            document = NoteDocument.model_validate(payload)
        except Exception:
            log.warning("Skipping invalid remote note payload name=%s", remote_file.name)
            return None
        return RemoteNote(file_id=remote_file.id, document=document)

    async def _load_remote_folders(
        self,
        drive_access_token: str,
        remote_file: RemoteFile | None,
    ) -> list[FolderNode]:
        if not remote_file:
            return []
        response = await self._drive_request(
            "GET",
            f"{DRIVE_API_BASE}/files/{remote_file.id}",
            drive_access_token=drive_access_token,
            params={"alt": "media"},
        )
        try:
            payload = json.loads(response.text)
        except json.JSONDecodeError:
            return []
        if not isinstance(payload, list):
            return []
        folders: list[FolderNode] = []
        for row in payload:
            if not isinstance(row, dict) or not row.get("id"):
                continue
            try:
                folders.append(FolderNode.model_validate(row))
            except Exception:
                continue
        return folders

    async def _upload_note(
        self,
        *,
        drive_access_token: str,
        folder_id: str,
        remote_file: RemoteFile | None,
        note: NoteDocument,
    ) -> str:
        return await self._upload_json_file(
            drive_access_token=drive_access_token,
            folder_id=folder_id,
            remote_file=remote_file,
            name=self._note_filename(note.frontmatter.id),
            content=self.note_store.serialize_note_document(note),
        )

    async def _upload_json_file(
        self,
        *,
        drive_access_token: str,
        folder_id: str,
        remote_file: RemoteFile | None,
        name: str,
        content: str,
    ) -> str:
        metadata: dict[str, Any] = {
            "name": name,
            "mimeType": "application/json",
        }
        method = "PATCH" if remote_file else "POST"
        url = (
            f"{DRIVE_UPLOAD_BASE}/files/{remote_file.id}"
            if remote_file
            else f"{DRIVE_UPLOAD_BASE}/files"
        )
        if not remote_file:
            metadata["parents"] = [folder_id]
        body, boundary = self._multipart_json_body(metadata, content)
        response = await self._drive_request(
            method,
            url,
            drive_access_token=drive_access_token,
            params={"uploadType": "multipart", "fields": "id,name"},
            headers={"Content-Type": f'multipart/related; boundary="{boundary}"'},
            content=body,
        )
        return str(response.json()["id"])

    async def _delete_remote_file(self, drive_access_token: str, file_id: str) -> None:
        try:
            await self._drive_request(
                "DELETE",
                f"{DRIVE_API_BASE}/files/{file_id}",
                drive_access_token=drive_access_token,
            )
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 404:
                raise

    def _merge_folders(
        self,
        local_folders: list[FolderNode],
        remote_folders: list[FolderNode],
        deleted_folder_ids: set[str],
    ) -> list[FolderNode]:
        local_by_id = {folder.id: folder for folder in local_folders}
        remote_by_id = {folder.id: folder for folder in remote_folders}
        merged: list[FolderNode] = []
        for folder_id in sorted(set(local_by_id).union(remote_by_id)):
            local_folder = local_by_id.get(folder_id)
            remote_folder = remote_by_id.get(folder_id)
            if folder_id in deleted_folder_ids and not local_folder:
                continue
            if local_folder and not remote_folder:
                merged.append(local_folder)
                continue
            if remote_folder and not local_folder:
                merged.append(remote_folder)
                continue
            if not local_folder or not remote_folder:
                continue
            if self._is_remote_newer(local_folder.updated_at, remote_folder.updated_at):
                merged.append(remote_folder)
            else:
                merged.append(local_folder)
        return sorted(merged, key=lambda folder: folder.name.lower())

    def _resolve_note_conflict(self, local_note: NoteDocument, remote_note: NoteDocument) -> str | None:
        local_payload = self.note_store.serialize_note_document(local_note)
        remote_payload = self.note_store.serialize_note_document(remote_note)
        if self._canonical_json(local_payload) == self._canonical_json(remote_payload):
            return None
        local_updated = local_note.frontmatter.updated_at
        remote_updated = remote_note.frontmatter.updated_at
        if self._is_remote_newer(local_updated, remote_updated):
            return "remote"
        return "local"

    @staticmethod
    def _is_remote_newer(local_updated: datetime, remote_updated: datetime) -> bool:
        return remote_updated > (local_updated + timedelta(seconds=1))

    @staticmethod
    def _note_filename(note_id: str) -> str:
        return f"{note_id}{NOTE_FILENAME_SUFFIX}"

    @staticmethod
    def _canonical_json(payload: str) -> str:
        try:
            return json.dumps(json.loads(payload), sort_keys=True)
        except json.JSONDecodeError:
            return payload

    @classmethod
    def _payload_hash(cls, payload: str) -> str:
        return hashlib.sha256(cls._canonical_json(payload).encode("utf-8")).hexdigest()

    def _note_hash(self, note: NoteDocument) -> str:
        return self._payload_hash(self.note_store.serialize_note_document(note))

    @staticmethod
    def _multipart_json_body(metadata: dict[str, Any], content: str) -> tuple[bytes, str]:
        boundary = f"notebook-ai-{secrets.token_hex(8)}"
        metadata_bytes = json.dumps(metadata).encode("utf-8")
        content_bytes = content.encode("utf-8")
        body = b"".join(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                b"Content-Type: application/json; charset=UTF-8\r\n\r\n",
                metadata_bytes,
                b"\r\n",
                f"--{boundary}\r\n".encode("utf-8"),
                b"Content-Type: application/json; charset=UTF-8\r\n\r\n",
                content_bytes,
                b"\r\n",
                f"--{boundary}--\r\n".encode("utf-8"),
            ]
        )
        return body, boundary

    @staticmethod
    def _escape_drive_query(value: str) -> str:
        return value.replace("\\", "\\\\").replace("'", "\\'")

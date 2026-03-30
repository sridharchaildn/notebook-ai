from __future__ import annotations

import asyncio
import json
import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import httpx

from ..config import Settings
from ..models import FolderNode, NoteDocument, SyncStatus
from ..notes_store import NoteStore
from ..storage_profile_store import StorageProfileStore

log = logging.getLogger("notebook.local.drive_sync")

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
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.settings = settings
        self.note_store = note_store
        self.profile_store = profile_store
        self.transport = transport
        self._desktop_access_token: str | None = None
        self._sync_task: asyncio.Task[SyncStatus] | None = None
        self._lock = asyncio.Lock()

    def remember_desktop_session(self, access_token: str | None) -> None:
        if access_token:
            self._desktop_access_token = access_token
            self.schedule_if_needed()

    def get_status(self) -> SyncStatus:
        return self.profile_store.get_sync_status()

    def request_sync(self) -> SyncStatus:
        if not self.get_status().enabled:
            return self.get_status()
        self.profile_store.enqueue_sync_operation()
        self.schedule_if_needed()
        return self.get_status()

    def request_full_resync(self) -> SyncStatus:
        if not self.get_status().enabled:
            return self.get_status()
        self.profile_store.enqueue_sync_operation()
        self.schedule_if_needed()
        return self.get_status()

    def record_note_deletion(self, note_id: str) -> SyncStatus:
        if not self.get_status().enabled:
            return self.get_status()
        self.profile_store.record_note_deletion(note_id)
        self.schedule_if_needed()
        return self.get_status()

    def record_folder_deletion(self, folder_id: str) -> SyncStatus:
        if not self.get_status().enabled:
            return self.get_status()
        self.profile_store.record_folder_deletion(folder_id)
        self.schedule_if_needed()
        return self.get_status()

    def schedule_if_needed(self) -> None:
        status = self.get_status()
        if not status.enabled or not self._desktop_access_token:
            return
        if status.pending_ops <= 0 and not self.profile_store.deleted_note_ids() and not self.profile_store.deleted_folder_ids():
            return
        if self._sync_task and not self._sync_task.done():
            return
        self._sync_task = asyncio.create_task(self.run_sync())

    async def run_sync(self) -> SyncStatus:
        async with self._lock:
            return await self._run_sync_internal()

    async def run_sync_now(self) -> SyncStatus:
        task = self._sync_task
        if task and not task.done():
            return await task
        self._sync_task = asyncio.create_task(self.run_sync())
        return await self._sync_task

    async def _run_sync_internal(self) -> SyncStatus:
        status = self.get_status()
        if not status.enabled:
            return status
        initial_pending_ops = status.pending_ops

        desktop_access_token = self._desktop_access_token
        if not desktop_access_token:
            return self.profile_store.mark_sync_needs_setup("Sign in again to resume Google Drive sync.")

        try:
            drive_status = await self._fetch_drive_status(desktop_access_token)
        except Exception as exc:
            return self.profile_store.mark_sync_error(str(exc))

        if not drive_status.get("connected"):
            return self.profile_store.mark_sync_needs_setup(
                "Connect Google Drive to start mirroring your local workspace."
            )

        try:
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

            remote_files = await self._list_remote_files(str(drive_access["access_token"]), folder_id)
            remote_file_by_name = {item.name: item for item in remote_files}
            remote_notes = await self._load_remote_notes(str(drive_access["access_token"]), remote_file_by_name)
            remote_folders = await self._load_remote_folders(
                str(drive_access["access_token"]),
                remote_file_by_name.get(FOLDERS_FILENAME),
            )

            local_notes = {note.frontmatter.id: note for note in self.note_store.list_notes()}
            local_folders = self.note_store.list_folders()
            deleted_note_ids = self.profile_store.deleted_note_ids()
            deleted_folder_ids = self.profile_store.deleted_folder_ids()

            total_items = 1 + len(set(local_notes).union(remote_notes)) + len(deleted_note_ids)
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

            self.profile_store.mark_sync_progress(
                phase="merging",
                completed_items=completed_items,
                total_items=max(total_items, 1),
                current_item="Folders",
            )
            if self._canonical_json(local_folders_payload) != self._canonical_json(merged_folders_payload):
                self.note_store.replace_folders(merged_folders)

            if (
                remote_file_by_name.get(FOLDERS_FILENAME) is None
                or self._canonical_json(remote_folders_payload) != self._canonical_json(merged_folders_payload)
            ):
                await self._upload_json_file(
                    drive_access_token=str(drive_access["access_token"]),
                    folder_id=folder_id,
                    remote_file=remote_file_by_name.get(FOLDERS_FILENAME),
                    name=FOLDERS_FILENAME,
                    content=merged_folders_payload,
                )

            for deleted_folder_id in list(deleted_folder_ids):
                if all(folder.id != deleted_folder_id for folder in merged_folders):
                    self.profile_store.clear_deleted_folder(deleted_folder_id)

            completed_items += 1
            note_ids = sorted(set(local_notes).union(remote_notes).union(deleted_note_ids))

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
                        await self._delete_remote_file(str(drive_access["access_token"]), remote_note.file_id)
                    if not local_note:
                        self.profile_store.clear_deleted_note(note_id)
                    completed_items += 1
                    continue

                display_name = local_note.frontmatter.title if local_note else remote_note.document.frontmatter.title

                if local_note and not remote_note:
                    self.profile_store.mark_sync_progress(
                        phase="pushing",
                        completed_items=completed_items,
                        total_items=max(total_items, 1),
                        current_item=display_name,
                    )
                    await self._upload_note(
                        drive_access_token=str(drive_access["access_token"]),
                        folder_id=folder_id,
                        remote_file=None,
                        note=local_note,
                    )
                elif remote_note and not local_note:
                    self.profile_store.mark_sync_progress(
                        phase="pulling",
                        completed_items=completed_items,
                        total_items=max(total_items, 1),
                        current_item=display_name,
                    )
                    self.note_store.save_note_document(remote_note.document)
                elif local_note and remote_note:
                    resolution = self._resolve_note_conflict(local_note, remote_note.document)
                    if resolution == "remote":
                        self.profile_store.mark_sync_progress(
                            phase="pulling",
                            completed_items=completed_items,
                            total_items=max(total_items, 1),
                            current_item=display_name,
                        )
                        self.note_store.save_note_document(remote_note.document)
                    elif resolution == "local":
                        self.profile_store.mark_sync_progress(
                            phase="pushing",
                            completed_items=completed_items,
                            total_items=max(total_items, 1),
                            current_item=display_name,
                        )
                        await self._upload_note(
                            drive_access_token=str(drive_access["access_token"]),
                            folder_id=folder_id,
                            remote_file=RemoteFile(id=remote_note.file_id, name=self._note_filename(note_id)),
                            note=local_note,
                        )
                    else:
                        self.profile_store.mark_sync_progress(
                            phase="merging",
                            completed_items=completed_items,
                            total_items=max(total_items, 1),
                            current_item=display_name,
                        )
                else:
                    self.profile_store.mark_sync_progress(
                        phase="merging",
                        completed_items=completed_items,
                        total_items=max(total_items, 1),
                        current_item=display_name,
                    )

                completed_items += 1

            self.profile_store.mark_sync_progress(
                phase="finalizing",
                completed_items=completed_items,
                total_items=max(total_items, 1),
                current_item="Finalizing mirror state",
            )
            final_status = self.profile_store.mark_sync_run(consumed_ops=initial_pending_ops)
            if final_status.pending_ops > 0:
                self.schedule_if_needed()
            return final_status
        except Exception as exc:
            log.exception("Drive sync failed")
            return self.profile_store.mark_sync_error(str(exc))

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
            if await self._drive_file_exists(drive_access_token, folder_id):
                return folder_id

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

    async def _drive_file_exists(self, drive_access_token: str, file_id: str) -> bool:
        try:
            await self._drive_request(
                "GET",
                f"{DRIVE_API_BASE}/files/{file_id}",
                drive_access_token=drive_access_token,
                params={"fields": "id"},
            )
            return True
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                return False
            raise

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

    async def _load_remote_notes(
        self,
        drive_access_token: str,
        remote_file_by_name: dict[str, RemoteFile],
    ) -> dict[str, RemoteNote]:
        remote_notes: dict[str, RemoteNote] = {}
        for name, remote in remote_file_by_name.items():
            if not name.endswith(NOTE_FILENAME_SUFFIX):
                continue
            response = await self._drive_request(
                "GET",
                f"{DRIVE_API_BASE}/files/{remote.id}",
                drive_access_token=drive_access_token,
                params={"alt": "media"},
            )
            try:
                payload = json.loads(response.text)
                document = NoteDocument.model_validate(payload)
            except Exception:
                log.warning("Skipping invalid remote note payload name=%s", name)
                continue
            remote_notes[document.frontmatter.id] = RemoteNote(file_id=remote.id, document=document)
        return remote_notes

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

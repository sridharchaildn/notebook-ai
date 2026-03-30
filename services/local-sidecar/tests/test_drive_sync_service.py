from __future__ import annotations

import json

import httpx
import pytest

from app.config import Settings
from app.models import NoteCreateRequest
from app.notes_store import NoteStore
from app.storage_profile_store import StorageProfileStore
from app.services.drive_sync_service import DriveSyncService


def _build_sync_service(tmp_path, handler):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        storage_profile_path=tmp_path / "storage_profile.json",
        sync_profile_path=tmp_path / "sync_profile.json",
        cloud_api_url="http://cloud.test",
    )
    note_store = NoteStore(settings.notes_dir)
    profile_store = StorageProfileStore(settings.storage_profile_path, settings.sync_profile_path)
    profile_store.set_sync_enabled(True)
    service = DriveSyncService(
        settings,
        note_store,
        profile_store,
        transport=httpx.MockTransport(handler),
    )
    service.remember_desktop_session("desktop-access-token")
    return service, note_store, profile_store


@pytest.mark.asyncio
async def test_drive_sync_uploads_local_workspace(tmp_path):
    uploads: list[tuple[str, bytes]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "cloud.test":
            if request.url.path == "/integrations/google-drive/status":
                return httpx.Response(200, json={"connected": True, "folder_name": "Notebook AI", "folder_id": "folder-1"})
            if request.url.path == "/integrations/google-drive/access-token":
                return httpx.Response(
                    200,
                    json={
                        "access_token": "drive-access-token",
                        "token_type": "Bearer",
                        "folder_id": "folder-1",
                        "folder_name": "Notebook AI",
                    },
                )
            if request.url.path == "/integrations/google-drive/folder":
                return httpx.Response(200, json={"connected": True, "folder_name": "Notebook AI", "folder_id": "folder-1"})

        if request.url.host == "www.googleapis.com":
            if request.url.path == "/drive/v3/files/folder-1":
                return httpx.Response(200, json={"id": "folder-1"})
            if request.url.path == "/drive/v3/files":
                return httpx.Response(200, json={"files": []})
            if request.url.path == "/upload/drive/v3/files":
                uploads.append((str(request.url), bytes(request.content)))
                upload_id = f"upload-{len(uploads)}"
                return httpx.Response(200, json={"id": upload_id, "name": upload_id})

        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    service, note_store, _profile_store = _build_sync_service(tmp_path, handler)
    note_store.create_note(NoteCreateRequest(title="Sync me", content="hello", tags=[]))
    service.request_full_resync()

    status = await service.run_sync_now()

    assert status.state == "idle"
    assert status.pending_ops == 0
    assert status.last_synced_at is not None
    assert len(uploads) == 2
    assert any(b".folders.json" in body for _url, body in uploads)
    assert any(b"Sync me" in body for _url, body in uploads)


@pytest.mark.asyncio
async def test_drive_sync_imports_remote_note_when_local_missing(tmp_path):
    remote_note_id = "remote-note-1"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "cloud.test":
            if request.url.path == "/integrations/google-drive/status":
                return httpx.Response(200, json={"connected": True, "folder_name": "Notebook AI", "folder_id": "folder-1"})
            if request.url.path == "/integrations/google-drive/access-token":
                return httpx.Response(
                    200,
                    json={
                        "access_token": "drive-access-token",
                        "token_type": "Bearer",
                        "folder_id": "folder-1",
                        "folder_name": "Notebook AI",
                    },
                )
            if request.url.path == "/integrations/google-drive/folder":
                return httpx.Response(200, json={"connected": True, "folder_name": "Notebook AI", "folder_id": "folder-1"})

        if request.url.host == "www.googleapis.com":
            if request.url.path == "/drive/v3/files/folder-1":
                return httpx.Response(200, json={"id": "folder-1"})
            if request.url.path == "/drive/v3/files":
                return httpx.Response(
                    200,
                    json={"files": [{"id": "remote-file-1", "name": f"{remote_note_id}.note.json", "mimeType": "application/json"}]},
                )
            if request.url.path == "/drive/v3/files/remote-file-1":
                return httpx.Response(
                    200,
                    text=json.dumps(
                        {
                            "frontmatter": {
                                "id": remote_note_id,
                                "title": "Remote only",
                                "created_at": "2026-03-27T12:00:00+00:00",
                                "updated_at": "2026-03-27T12:05:00+00:00",
                                "tags": ["remote"],
                                "provider": None,
                                "model": None,
                                "folder_id": None,
                            },
                            "kind": "note",
                            "content_format": "plain_text",
                            "content": "from drive",
                            "session": None,
                        }
                    ),
                )
            if request.url.path == "/upload/drive/v3/files":
                return httpx.Response(200, json={"id": "upload-1", "name": "upload-1"})

        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    service, note_store, _profile_store = _build_sync_service(tmp_path, handler)
    service.request_full_resync()

    status = await service.run_sync_now()
    notes = note_store.list_notes()

    assert status.state == "idle"
    assert len(notes) == 1
    assert notes[0].frontmatter.id == remote_note_id
    assert notes[0].content == "from drive"


@pytest.mark.asyncio
async def test_drive_sync_prefers_remote_note_when_remote_is_newer(tmp_path):
    uploads: list[bytes] = []
    note_id_holder: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        remote_note_id = note_id_holder["note_id"]
        if request.url.host == "cloud.test":
            if request.url.path == "/integrations/google-drive/status":
                return httpx.Response(200, json={"connected": True, "folder_name": "Notebook AI", "folder_id": "folder-1"})
            if request.url.path == "/integrations/google-drive/access-token":
                return httpx.Response(
                    200,
                    json={
                        "access_token": "drive-access-token",
                        "token_type": "Bearer",
                        "folder_id": "folder-1",
                        "folder_name": "Notebook AI",
                    },
                )
            if request.url.path == "/integrations/google-drive/folder":
                return httpx.Response(200, json={"connected": True, "folder_name": "Notebook AI", "folder_id": "folder-1"})

        if request.url.host == "www.googleapis.com":
            if request.url.path == "/drive/v3/files/folder-1":
                return httpx.Response(200, json={"id": "folder-1"})
            if request.url.path == "/drive/v3/files":
                return httpx.Response(
                    200,
                    json={"files": [{"id": "remote-file-1", "name": f"{remote_note_id}.note.json", "mimeType": "application/json"}]},
                )
            if request.url.path == "/drive/v3/files/remote-file-1":
                return httpx.Response(
                    200,
                    text=json.dumps(
                        {
                            "frontmatter": {
                                "id": remote_note_id,
                                "title": "Conflict",
                                "created_at": "2026-03-27T12:00:00+00:00",
                                "updated_at": "2030-03-27T12:05:00+00:00",
                                "tags": [],
                                "provider": None,
                                "model": None,
                                "folder_id": None,
                            },
                            "kind": "note",
                            "content_format": "plain_text",
                            "content": "remote copy",
                            "session": None,
                        }
                    ),
                )
            if request.url.path == "/upload/drive/v3/files":
                uploads.append(bytes(request.content))
                return httpx.Response(200, json={"id": "upload-1", "name": "upload-1"})

        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    service, note_store, _profile_store = _build_sync_service(tmp_path, handler)
    local_note = note_store.create_note(NoteCreateRequest(title="Conflict", content="local copy", tags=[]))
    note_id_holder["note_id"] = local_note.frontmatter.id
    service.request_full_resync()

    status = await service.run_sync_now()
    synced_note = note_store.list_notes()[0]

    assert status.state == "idle"
    assert synced_note.frontmatter.id == local_note.frontmatter.id
    assert synced_note.content == "remote copy"
    assert not any(b"remote copy" in body for body in uploads)


@pytest.mark.asyncio
async def test_drive_sync_deletes_remote_note_after_local_delete(tmp_path):
    deleted_files: list[str] = []
    note_id_holder: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        remote_note_id = note_id_holder["note_id"]
        if request.url.host == "cloud.test":
            if request.url.path == "/integrations/google-drive/status":
                return httpx.Response(200, json={"connected": True, "folder_name": "Notebook AI", "folder_id": "folder-1"})
            if request.url.path == "/integrations/google-drive/access-token":
                return httpx.Response(
                    200,
                    json={
                        "access_token": "drive-access-token",
                        "token_type": "Bearer",
                        "folder_id": "folder-1",
                        "folder_name": "Notebook AI",
                    },
                )
            if request.url.path == "/integrations/google-drive/folder":
                return httpx.Response(200, json={"connected": True, "folder_name": "Notebook AI", "folder_id": "folder-1"})

        if request.url.host == "www.googleapis.com":
            if request.url.path == "/drive/v3/files/folder-1":
                return httpx.Response(200, json={"id": "folder-1"})
            if request.url.path == "/drive/v3/files":
                return httpx.Response(
                    200,
                    json={"files": [{"id": "remote-file-1", "name": f"{remote_note_id}.note.json", "mimeType": "application/json"}]},
                )
            if request.url.path == "/drive/v3/files/remote-file-1" and request.method == "GET":
                return httpx.Response(
                    200,
                    text=json.dumps(
                        {
                            "frontmatter": {
                                "id": remote_note_id,
                                "title": "Delete me",
                                "created_at": "2026-03-27T12:00:00+00:00",
                                "updated_at": "2026-03-27T12:05:00+00:00",
                                "tags": [],
                                "provider": None,
                                "model": None,
                                "folder_id": None,
                            },
                            "kind": "note",
                            "content_format": "plain_text",
                            "content": "remote copy",
                            "session": None,
                        }
                    ),
                )
            if request.url.path == "/drive/v3/files/remote-file-1" and request.method == "DELETE":
                deleted_files.append("remote-file-1")
                return httpx.Response(204)
            if request.url.path == "/upload/drive/v3/files":
                return httpx.Response(200, json={"id": "upload-1", "name": "upload-1"})

        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    service, note_store, profile_store = _build_sync_service(tmp_path, handler)
    local_note = note_store.create_note(NoteCreateRequest(title="Delete me", content="temp", tags=[]))
    note_id_holder["note_id"] = local_note.frontmatter.id
    note_store.delete_note(local_note.frontmatter.id)
    service.record_note_deletion(local_note.frontmatter.id)

    status = await service.run_sync_now()

    assert status.state == "idle"
    assert deleted_files == ["remote-file-1"]
    assert profile_store.deleted_note_ids() == set()

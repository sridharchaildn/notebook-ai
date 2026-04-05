from __future__ import annotations

import json

import httpx
import pytest

from app.config import Settings
from app.models import NoteCreateRequest
from app.notes_store import NoteStore
from app.storage_profile_store import StorageProfileStore
from app.services.drive_sync_service import DriveSyncService, FOLDERS_FILENAME
from app.sync_state_store import SyncStateStore


def _build_sync_service(tmp_path, handler):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        storage_profile_path=tmp_path / "storage_profile.json",
        sync_profile_path=tmp_path / "sync_profile.json",
        sync_state_path=tmp_path / "sync_state.json",
        cloud_api_url="http://cloud.test",
    )
    note_store = NoteStore(settings.notes_dir)
    profile_store = StorageProfileStore(settings.storage_profile_path, settings.sync_profile_path)
    sync_state_store = SyncStateStore(settings.sync_state_path)
    profile_store.set_sync_enabled(True)
    service = DriveSyncService(
        settings,
        note_store,
        profile_store,
        sync_state_store,
        transport=httpx.MockTransport(handler),
    )
    service.remember_desktop_session("desktop-access-token")
    return service, note_store, profile_store, sync_state_store


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

    service, note_store, _profile_store, sync_state_store = _build_sync_service(tmp_path, handler)
    note_store.create_note(NoteCreateRequest(title="Sync me", content="hello", tags=[]))
    service.request_full_resync()

    status = await service.run_sync_now()

    assert status.state == "idle"
    assert status.pending_ops == 0
    assert status.last_synced_at is not None
    assert len(uploads) == 2
    assert any(b".folders.json" in body for _url, body in uploads)
    assert any(b"Sync me" in body for _url, body in uploads)
    sync_state = sync_state_store.get_state()
    assert sync_state.pending_ops() == 0
    assert sync_state.folders.remote_file_id == "upload-1"
    assert len(sync_state.notes) == 1


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

    service, note_store, _profile_store, sync_state_store = _build_sync_service(tmp_path, handler)
    service.request_full_resync()

    status = await service.run_sync_now()
    notes = note_store.list_notes()

    assert status.state == "idle"
    assert len(notes) == 1
    assert notes[0].frontmatter.id == remote_note_id
    assert notes[0].content == "from drive"
    assert sync_state_store.get_state().notes[remote_note_id].remote_file_id == "remote-file-1"


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

    service, note_store, _profile_store, _sync_state_store = _build_sync_service(tmp_path, handler)
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
            if (
                request.url.path == "/drive/v3/files/remote-file-1"
                and request.method == "GET"
                and request.url.params.get("alt") == "media"
            ):
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
            if request.url.path == "/drive/v3/files/remote-file-1" and request.method == "GET":
                return httpx.Response(200, json={"id": "remote-file-1", "name": f"{remote_note_id}.note.json"})
            if request.url.path == "/drive/v3/files/remote-file-1" and request.method == "DELETE":
                deleted_files.append("remote-file-1")
                return httpx.Response(204)
            if request.url.path == "/upload/drive/v3/files":
                return httpx.Response(200, json={"id": "upload-1", "name": "upload-1"})

        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    service, note_store, profile_store, sync_state_store = _build_sync_service(tmp_path, handler)
    local_note = note_store.create_note(NoteCreateRequest(title="Delete me", content="temp", tags=[]))
    note_id_holder["note_id"] = local_note.frontmatter.id
    sync_state_store.upsert_note_remote_state(
        local_note.frontmatter.id,
        remote_file_id="remote-file-1",
        last_synced_hash="seed",
        last_synced_updated_at=local_note.frontmatter.updated_at.isoformat(),
    )
    note_store.delete_note(local_note.frontmatter.id)
    service.record_note_deletion(local_note.frontmatter.id)

    status = await service.run_sync_now()

    assert status.state == "idle"
    assert deleted_files == ["remote-file-1"]
    assert profile_store.deleted_note_ids() == set()
    assert sync_state_store.get_state().notes == {}


@pytest.mark.asyncio
async def test_incremental_note_upsert_avoids_full_drive_listing(tmp_path):
    uploads: list[bytes] = []
    queries: list[str] = []

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
                return httpx.Response(200, json={"id": "folder-1", "name": "Notebook AI"})
            if request.url.path == "/drive/v3/files":
                query = request.url.params.get("q", "")
                queries.append(query)
                assert "name =" in query
                assert "in parents and trashed = false" in query
                assert ".note.json" in query
                return httpx.Response(200, json={"files": []})
            if request.url.path == "/upload/drive/v3/files":
                uploads.append(bytes(request.content))
                return httpx.Response(200, json={"id": "remote-note-1", "name": "remote-note-1"})

        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    service, note_store, _profile_store, sync_state_store = _build_sync_service(tmp_path, handler)
    created = note_store.create_note(NoteCreateRequest(title="Only me", content="hello", tags=[]))
    service.request_note_upsert(created.frontmatter.id)

    status = await service.run_sync_now()

    assert status.state == "idle"
    assert status.pending_ops == 0
    assert len(uploads) == 1
    assert b".folders.json" not in uploads[0]
    assert len(queries) == 1
    assert sync_state_store.get_state().notes[created.frontmatter.id].remote_file_id == "remote-note-1"


@pytest.mark.asyncio
async def test_incremental_folder_sync_uses_only_folders_manifest(tmp_path):
    uploads: list[bytes] = []
    file_queries: list[str] = []

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
                return httpx.Response(200, json={"id": "folder-1", "name": "Notebook AI"})
            if request.url.path == "/drive/v3/files":
                query = request.url.params.get("q", "")
                file_queries.append(query)
                assert FOLDERS_FILENAME in query
                return httpx.Response(
                    200,
                    json={"files": [{"id": "folders-remote-1", "name": ".folders.json", "mimeType": "application/json"}]},
                )
            if request.url.path == "/drive/v3/files/folders-remote-1":
                return httpx.Response(200, text="[]")
            if request.url.path == "/upload/drive/v3/files/folders-remote-1":
                uploads.append(bytes(request.content))
                return httpx.Response(200, json={"id": "folders-remote-1", "name": ".folders.json"})

        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    service, note_store, _profile_store, sync_state_store = _build_sync_service(tmp_path, handler)
    note_store.create_folder("Meetings")
    service.request_folder_sync()

    status = await service.run_sync_now()

    assert status.state == "idle"
    assert status.pending_ops == 0
    assert len(file_queries) == 1
    assert len(uploads) == 1
    assert b".folders.json" in uploads[0]
    assert sync_state_store.get_state().folders.remote_file_id == "folders-remote-1"


@pytest.mark.asyncio
async def test_incremental_queue_and_remote_index_persist_across_restart(tmp_path):
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
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    service, note_store, _profile_store, sync_state_store = _build_sync_service(tmp_path, handler)
    created = note_store.create_note(NoteCreateRequest(title="Queued", content="draft", tags=[]))
    service.request_note_upsert(created.frontmatter.id)
    sync_state_store.upsert_note_remote_state(
        created.frontmatter.id,
        remote_file_id="remote-file-9",
        last_synced_hash="seed",
        last_synced_updated_at=created.frontmatter.updated_at.isoformat(),
    )

    restarted_service, _note_store, _profile_store, restarted_sync_state_store = _build_sync_service(tmp_path, handler)
    restarted_state = restarted_sync_state_store.get_state()

    assert restarted_service.get_status().pending_ops == 1
    assert created.frontmatter.id in restarted_state.queue.note_upserts
    assert restarted_state.notes[created.frontmatter.id].remote_file_id == "remote-file-9"


@pytest.mark.asyncio
async def test_drive_sync_reports_failing_host_for_request_errors(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "cloud.test" and request.url.path == "/integrations/google-drive/status":
            raise httpx.ConnectError("[Errno 8] nodename nor servname provided, or not known", request=request)
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    service, _note_store, profile_store, _sync_state_store = _build_sync_service(tmp_path, handler)

    status = await service.run_sync_now()

    assert status.state == "error"
    assert status.last_error == (
        "Unable to reach cloud API (cloud.test): [Errno 8] nodename nor servname provided, or not known"
    )
    assert profile_store.get_sync_status().last_error == status.last_error

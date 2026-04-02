from __future__ import annotations

import json

from app.config import Settings
from app.main import create_app
from app.services.transcription_service import TranscriptionResult, TranscriptionService
from fastapi.testclient import TestClient


def _build_test_client(settings: Settings) -> TestClient:
    settings.settings_profile_path = settings.notes_dir.parent / "user_settings.json"
    settings.sync_state_path = settings.notes_dir.parent / "sync_state.json"
    client = TestClient(create_app(settings))
    client.headers.update({"X-Notebook-Desktop-Token": settings.desktop_token})
    return client


def _read_sync_state(settings: Settings) -> dict[str, object]:
    if not settings.sync_state_path.exists():
        return {}
    return json.loads(settings.sync_state_path.read_text(encoding="utf-8"))


def _write_sync_state(settings: Settings, payload: dict[str, object]) -> None:
    settings.sync_state_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def test_notes_crud_and_provider_status(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        storage_profile_path=tmp_path / "storage_profile.json",
        sync_profile_path=tmp_path / "sync_profile.json",
        desktop_token="desktop-test-token",
    )
    client = _build_test_client(settings)

    created = client.post(
        "/notes",
        json={"title": "Design Ideas", "content": "Ship desktop MVP", "tags": ["design"]},
    )
    assert created.status_code == 201
    note_id = created.json()["frontmatter"]["id"]

    listed = client.get("/notes")
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    updated = client.put(
        f"/notes/{note_id}",
        json={
            "title": "Design Ideas v2",
            "content": "Ship quickly",
            "tags": ["mvp"],
            "context_preset": "custom",
            "context_text": "Launch workstream",
        },
    )
    assert updated.status_code == 200
    assert updated.json()["frontmatter"]["title"] == "Design Ideas v2"
    assert updated.json()["frontmatter"]["context_preset"] == "custom"

    saved = client.post(
        "/providers/byok",
        json={"provider": "openai", "api_key": "sk-local-openai"},
    )
    assert saved.status_code == 200
    openai_status = [item for item in saved.json() if item["provider"] == "openai"][0]
    assert openai_status["connected"] is True
    assert openai_status["via"] == "api_key"
    assert openai_status["scope"] == "desktop_local"


def test_provider_byok_persists_across_restarts(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        storage_profile_path=tmp_path / "storage_profile.json",
        sync_profile_path=tmp_path / "sync_profile.json",
        desktop_token="desktop-test-token",
    )
    first_client = _build_test_client(settings)

    saved = first_client.post(
        "/providers/byok",
        json={"provider": "openrouter", "api_key": "sk-or-local"},
    )
    assert saved.status_code == 200

    restarted_client = _build_test_client(settings)
    listed = restarted_client.get("/providers/status")
    assert listed.status_code == 200
    openrouter_status = [item for item in listed.json() if item["provider"] == "openrouter"][0]
    assert openrouter_status["connected"] is True
    assert openrouter_status["via"] == "api_key"
    assert openrouter_status["scope"] == "desktop_local"


def test_provider_delete_removes_local_credential(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        storage_profile_path=tmp_path / "storage_profile.json",
        sync_profile_path=tmp_path / "sync_profile.json",
        desktop_token="desktop-test-token",
    )
    client = _build_test_client(settings)

    saved = client.post(
        "/providers/byok",
        json={"provider": "openai", "api_key": "sk-local-openai"},
    )
    assert saved.status_code == 200

    deleted = client.delete("/providers/openai")
    assert deleted.status_code == 200
    assert deleted.json() == {"provider": "openai", "connected": False}

    listed = client.get("/providers/status")
    assert listed.status_code == 200
    openai_status = [item for item in listed.json() if item["provider"] == "openai"][0]
    assert openai_status["connected"] is False
    assert openai_status["via"] == "none"
    assert openai_status["scope"] == "none"


def test_notes_accept_legacy_body_payloads(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        storage_profile_path=tmp_path / "storage_profile.json",
        sync_profile_path=tmp_path / "sync_profile.json",
        desktop_token="desktop-test-token",
    )
    client = _build_test_client(settings)

    created = client.post(
        "/notes",
        json={"title": "Legacy Body Note", "body": "Saved via body", "tags": ["legacy"]},
    )
    assert created.status_code == 201
    payload = created.json()
    assert payload["content"] == "Saved via body"
    assert payload["content_format"] == "markdown"
    note_id = payload["frontmatter"]["id"]

    updated = client.put(
        f"/notes/{note_id}",
        json={"title": "Legacy Body Note v2", "body": "Updated via body", "tags": ["legacy"]},
    )
    assert updated.status_code == 200
    assert updated.json()["content"] == "Updated via body"


def test_stream_transform_sse(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        storage_profile_path=tmp_path / "storage_profile.json",
        sync_profile_path=tmp_path / "sync_profile.json",
        desktop_token="desktop-test-token",
    )
    client = _build_test_client(settings)

    response = client.post(
        "/ai/transform/stream",
        json={
            "content": "Task: finalize launch checklist",
            "transform": "extract_action_items",
            "provider": "openai",
        },
    )

    assert response.status_code == 200
    assert "data:" in response.text
    assert "token" in response.text
    assert "complete" in response.text


def test_copilot_chat_stream(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        storage_profile_path=tmp_path / "storage_profile.json",
        sync_profile_path=tmp_path / "sync_profile.json",
        desktop_token="desktop-test-token",
    )
    client = _build_test_client(settings)

    response = client.post(
        "/ai/copilot/chat/stream",
        json={
            "question": "What did I commit to?",
            "content": "Me: I can send the deck tomorrow.\nOther audio: Please share the revised plan.",
            "history": [],
            "note_context": {
                "title": "Customer meeting",
                "tags": ["meeting", "transcript"],
                "note_kind": "transcript",
                "context_preset": "meeting",
                "transcript_segments": [
                    {"id": "1", "text": "I can send the deck tomorrow.", "source_hint": "me"}
                ],
            },
            "provider": "openai",
        },
    )

    assert response.status_code == 200
    assert "token" in response.text
    assert "complete" in response.text


def test_interview_turns_and_coach_stream(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        storage_profile_path=tmp_path / "storage_profile.json",
        sync_profile_path=tmp_path / "sync_profile.json",
        desktop_token="desktop-test-token",
    )
    client = _build_test_client(settings)

    turns_res = client.post(
        "/ai/interview/turns",
        json={
            "transcript": "Interviewer: What is JavaScript? Interviewee: JavaScript is a scripting language.",
            "previous_turns": [],
            "provider": "openai",
        },
    )
    assert turns_res.status_code == 200
    turns_payload = turns_res.json()
    assert "turns" in turns_payload
    assert len(turns_payload["turns"]) >= 1
    assert "transcript_digest" in turns_payload

    interviewer_turn = next((t for t in turns_payload["turns"] if t["role"] == "interviewer"), None)
    assert interviewer_turn is not None

    coach_res = client.post(
        "/ai/interview/coach/stream",
        json={
            "latest_interviewer_turn": interviewer_turn,
            "brevity": "short",
            "provider": "openai",
        },
    )
    assert coach_res.status_code == 200
    assert "token" in coach_res.text
    assert "complete" in coach_res.text


def test_transcription_chunk_returns_structured_error_fields(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        openai_api_key=None,
        cloud_api_url="http://127.0.0.1:9",
        storage_profile_path=tmp_path / "storage_profile.json",
        sync_profile_path=tmp_path / "sync_profile.json",
        desktop_token="desktop-test-token",
    )
    client = _build_test_client(settings)

    response = client.post(
        "/transcription/chunk",
        data={
            "provider": "openai",
            "transcription_mode": "whisper",
            "segment_id": "7",
            "model": "whisper-1",
        },
        files={"file": ("chunk.webm", b"fake audio bytes", "audio/webm")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error_code"] in {
        "auth_or_quota",
        "provider_http_error",
        "network_error",
        "invalid_audio_format",
    }
    assert "recoverable" in payload
    assert payload["segment_id"] == 7
    assert payload["model"] == "whisper-1"


def test_storage_and_folder_endpoints(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        storage_profile_path=tmp_path / "storage_profile.json",
        sync_profile_path=tmp_path / "sync_profile.json",
        desktop_token="desktop-test-token",
    )
    client = _build_test_client(settings)

    root = client.get("/storage/local-root")
    assert root.status_code == 200
    assert "local_root" in root.json()

    folder = client.post("/folders", json={"name": "Meetings"})
    assert folder.status_code == 201
    folder_id = folder.json()["id"]

    note = client.post("/notes", json={"title": "N1", "content": "Hello", "tags": []})
    assert note.status_code == 201
    note_id = note.json()["frontmatter"]["id"]

    moved = client.patch(f"/notes/{note_id}/move", json={"folder_id": folder_id})
    assert moved.status_code == 200
    assert moved.json()["frontmatter"]["folder_id"] == folder_id

    pref = client.put("/storage/preference", json={"mode": "local_and_drive"})
    assert pref.status_code == 200
    assert pref.json()["mode"] == "local_and_drive"

    sync_status = client.get("/sync/status")
    assert sync_status.status_code == 200
    assert sync_status.json()["enabled"] is True


def test_local_settings_endpoints(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        storage_profile_path=tmp_path / "storage_profile.json",
        sync_profile_path=tmp_path / "sync_profile.json",
        settings_profile_path=tmp_path / "user_settings.json",
        desktop_token="desktop-test-token",
    )
    client = _build_test_client(settings)

    initial_transcription = client.get("/settings/transcription")
    assert initial_transcription.status_code == 200
    assert initial_transcription.json()["main_language"] == "auto"

    updated_transcription = client.put(
        "/settings/transcription",
        json={
            "main_language": "en",
            "spoken_languages": ["English", "Spanish"],
            "custom_vocabulary": ["Notebook AI", "OpenRouter"],
        },
    )
    assert updated_transcription.status_code == 200
    assert updated_transcription.json()["main_language"] == "en"
    assert updated_transcription.json()["spoken_languages"] == ["English", "Spanish"]

    initial_markdown = client.get("/settings/markdown")
    assert initial_markdown.status_code == 200
    assert initial_markdown.json()["editor_mode"] == "rich_text"

    updated_markdown = client.put(
        "/settings/markdown",
        json={"enable_import": True, "enable_export": False, "editor_mode": "preview"},
    )
    assert updated_markdown.status_code == 200
    assert updated_markdown.json()["enable_export"] is False
    assert updated_markdown.json()["editor_mode"] == "preview"



def test_noop_note_update_does_not_queue_sync(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        storage_profile_path=tmp_path / "storage_profile.json",
        sync_profile_path=tmp_path / "sync_profile.json",
        desktop_token="desktop-test-token",
    )
    client = _build_test_client(settings)

    pref = client.put("/storage/preference", json={"mode": "local_and_drive"})
    assert pref.status_code == 200

    created = client.post(
        "/notes",
        json={
            "title": "Stable note",
            "content": "Hello",
            "tags": ["sync"],
            "kind": "note",
            "content_format": "markdown",
            "context_preset": "custom",
            "context_text": "Workspace note",
        },
    )
    assert created.status_code == 201
    note = created.json()
    note_id = note["frontmatter"]["id"]

    status_after_create = client.get("/sync/status")
    assert status_after_create.status_code == 200
    pending_after_create = status_after_create.json()["pending_ops"]
    assert pending_after_create >= 1

    updated = client.put(
        f"/notes/{note_id}",
        json={
            "title": note["frontmatter"]["title"],
            "content": note["content"],
            "tags": note["frontmatter"]["tags"],
            "kind": note["kind"],
            "content_format": note["content_format"],
            "context_preset": note["frontmatter"]["context_preset"],
            "context_text": note["frontmatter"]["context_text"],
            "provider": note["frontmatter"]["provider"],
            "model": note["frontmatter"]["model"],
            "folder_id": note["frontmatter"]["folder_id"],
            "session": note["session"],
        },
    )
    assert updated.status_code == 200

    status_after_noop = client.get("/sync/status")
    assert status_after_noop.status_code == 200
    assert status_after_noop.json()["pending_ops"] == pending_after_create


def test_redundant_storage_preference_update_does_not_queue_extra_sync(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        storage_profile_path=tmp_path / "storage_profile.json",
        sync_profile_path=tmp_path / "sync_profile.json",
        desktop_token="desktop-test-token",
    )
    client = _build_test_client(settings)

    first = client.put("/storage/preference", json={"mode": "local_and_drive"})
    assert first.status_code == 200

    status_after_first = client.get("/sync/status")
    assert status_after_first.status_code == 200
    pending_after_first = status_after_first.json()["pending_ops"]
    assert pending_after_first == 1

    second = client.put("/storage/preference", json={"mode": "local_and_drive"})
    assert second.status_code == 200

    status_after_second = client.get("/sync/status")
    assert status_after_second.status_code == 200
    assert status_after_second.json()["pending_ops"] == pending_after_first


def test_repeated_note_updates_keep_single_note_upsert(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        storage_profile_path=tmp_path / "storage_profile.json",
        sync_profile_path=tmp_path / "sync_profile.json",
        desktop_token="desktop-test-token",
    )
    client = _build_test_client(settings)

    pref = client.put("/storage/preference", json={"mode": "local_and_drive"})
    assert pref.status_code == 200

    created = client.post("/notes", json={"title": "Draft", "content": "one", "tags": []})
    assert created.status_code == 201
    note_id = created.json()["frontmatter"]["id"]

    status_after_create = client.get("/sync/status")
    pending_after_create = status_after_create.json()["pending_ops"]

    updated = client.put(
        f"/notes/{note_id}",
        json={"title": "Draft", "content": "two", "tags": []},
    )
    assert updated.status_code == 200

    status_after_update = client.get("/sync/status")
    assert status_after_update.json()["pending_ops"] == pending_after_create
    sync_state = _read_sync_state(settings)
    assert sync_state["queue"]["note_upserts"] == [note_id]


def test_folder_create_and_rename_keep_single_folder_job(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        storage_profile_path=tmp_path / "storage_profile.json",
        sync_profile_path=tmp_path / "sync_profile.json",
        desktop_token="desktop-test-token",
    )
    client = _build_test_client(settings)

    pref = client.put("/storage/preference", json={"mode": "local_and_drive"})
    assert pref.status_code == 200

    created = client.post("/folders", json={"name": "Meetings"})
    assert created.status_code == 201
    folder_id = created.json()["id"]

    status_after_create = client.get("/sync/status")
    assert status_after_create.json()["pending_ops"] == 2

    renamed = client.patch(f"/folders/{folder_id}", json={"name": "Meeting Notes"})
    assert renamed.status_code == 200

    status_after_rename = client.get("/sync/status")
    assert status_after_rename.json()["pending_ops"] == 2
    sync_state = _read_sync_state(settings)
    assert sync_state["queue"]["folders_dirty"] is True
    assert sync_state["queue"]["note_upserts"] == []


def test_folder_delete_queues_folder_job_and_moved_note_upserts_without_full_reconcile(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        storage_profile_path=tmp_path / "storage_profile.json",
        sync_profile_path=tmp_path / "sync_profile.json",
        desktop_token="desktop-test-token",
    )
    client = _build_test_client(settings)

    pref = client.put("/storage/preference", json={"mode": "local_and_drive"})
    assert pref.status_code == 200

    folder = client.post("/folders", json={"name": "Meetings"})
    assert folder.status_code == 201
    folder_id = folder.json()["id"]

    note = client.post("/notes", json={"title": "N1", "content": "Hello", "tags": []})
    assert note.status_code == 201
    note_id = note.json()["frontmatter"]["id"]

    moved = client.patch(f"/notes/{note_id}/move", json={"folder_id": folder_id})
    assert moved.status_code == 200

    _write_sync_state(
        settings,
        {
            "version": 1,
            "queue": {
                "note_upserts": [],
                "note_deletes": [],
                "folders_dirty": False,
                "full_reconcile_reason": None,
            },
            "notes": {},
            "folders": {"remote_file_id": None, "last_synced_hash": None},
        },
    )

    deleted = client.delete(f"/folders/{folder_id}")
    assert deleted.status_code == 204

    sync_status = client.get("/sync/status")
    assert sync_status.status_code == 200
    assert sync_status.json()["pending_ops"] == 2
    sync_state = _read_sync_state(settings)
    assert sync_state["queue"]["folders_dirty"] is True
    assert sync_state["queue"]["note_upserts"] == [note_id]
    assert sync_state["queue"]["full_reconcile_reason"] is None


def test_manual_sync_run_marks_full_reconcile_queue(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        storage_profile_path=tmp_path / "storage_profile.json",
        sync_profile_path=tmp_path / "sync_profile.json",
        desktop_token="desktop-test-token",
    )
    client = _build_test_client(settings)

    pref = client.put("/storage/preference", json={"mode": "local_and_drive"})
    assert pref.status_code == 200

    _write_sync_state(
        settings,
        {
            "version": 1,
            "queue": {
                "note_upserts": [],
                "note_deletes": [],
                "folders_dirty": False,
                "full_reconcile_reason": None,
            },
            "notes": {},
            "folders": {"remote_file_id": None, "last_synced_hash": None},
        },
    )

    run = client.post("/sync/run")
    assert run.status_code == 200
    assert run.json()["state"] == "needs_setup"

    sync_state = _read_sync_state(settings)
    assert sync_state["queue"]["full_reconcile_reason"] == "Manual sync requested."


def test_capture_session_finalize_persists_note_and_cleans_up_chunks(tmp_path, monkeypatch):
    calls: list[tuple[int | None, str | None]] = []

    async def fake_transcribe_chunk(self, **kwargs):
        calls.append((kwargs.get("segment_id"), kwargs.get("source_hint")))
        return TranscriptionResult(
            text=f"mixed transcript {kwargs.get('segment_id')}",
            provider="openai",
            model="whisper-1",
        )

    monkeypatch.setattr(TranscriptionService, "transcribe_chunk", fake_transcribe_chunk)

    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        storage_profile_path=tmp_path / "storage_profile.json",
        sync_profile_path=tmp_path / "sync_profile.json",
        desktop_token="desktop-test-token",
    )
    client = _build_test_client(settings)

    created = client.post(
        "/notes",
        json={"title": "Transcript", "content": "", "tags": ["transcript"], "kind": "transcript", "content_format": "plain_text"},
    )
    assert created.status_code == 201
    note_id = created.json()["frontmatter"]["id"]

    started = client.post(
        "/capture-sessions/start",
        json={
            "note_id": note_id,
            "session_mode": "notes",
            "capture_mode": "mic",
            "provider": "openai",
            "transcription_mode": "whisper",
            "model": "whisper-1",
        },
    )
    assert started.status_code == 200
    session_id = started.json()["session_id"]

    append = client.post(
        f"/capture-sessions/{session_id}/chunks",
        data={
            "chunk_index": "0",
            "source_hint": "unknown",
            "started_at_ms": "0",
            "duration_ms": "8000",
        },
        files={"file": ("chunk.wav", b"audio bytes", "audio/wav")},
    )
    assert append.status_code == 200
    ack = append.json()
    assert ack["accepted_chunk_index"] == 0
    assert ack["accepted_chunk_started_at_ms"] == 0
    assert ack["accepted_chunk_duration_ms"] == 8000
    assert ack["transcript"] == "mixed transcript 0"

    duplicate = client.post(
        f"/capture-sessions/{session_id}/chunks",
        data={"chunk_index": "0", "source_hint": "unknown"},
        files={"file": ("chunk.wav", b"audio bytes", "audio/wav")},
    )
    assert duplicate.status_code == 200
    assert calls.count((0, "unknown")) == 1

    finalized = client.post(f"/capture-sessions/{session_id}/finalize")
    assert finalized.status_code == 200
    final_payload = finalized.json()
    assert final_payload["state"] == "completed"
    assert final_payload["transcript"] == "mixed transcript 0"

    listed = client.get("/notes")
    assert listed.status_code == 200
    updated = next(item for item in listed.json() if item["frontmatter"]["id"] == note_id)
    assert updated["content"] == "mixed transcript 0"
    assert updated["session"]["session_type"] == "transcript"
    assert updated["session"]["transcript"] == "mixed transcript 0"
    assert updated["session"]["segments"] == []

    assert not (settings.notes_dir / "capture-sessions" / session_id / "chunks").exists()


def test_capture_session_retry_recovery_retries_canonical_failures(tmp_path, monkeypatch):
    attempts: dict[tuple[int | None, str | None], int] = {}

    async def fake_transcribe_chunk(self, **kwargs):
        key = (kwargs.get("segment_id"), kwargs.get("source_hint"))
        attempts[key] = attempts.get(key, 0) + 1
        if key == (0, "unknown") and attempts[key] < 9:
            return TranscriptionResult(
                text="",
                provider="openai",
                model="whisper-1",
                detail="network timeout",
                ok=False,
                error_code="network_error",
                recoverable=True,
            )
        return TranscriptionResult(
            text="recovered transcript",
            provider="openai",
            model="whisper-1",
        )

    monkeypatch.setattr(TranscriptionService, "transcribe_chunk", fake_transcribe_chunk)

    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        storage_profile_path=tmp_path / "storage_profile.json",
        sync_profile_path=tmp_path / "sync_profile.json",
        desktop_token="desktop-test-token",
    )
    client = _build_test_client(settings)

    note = client.post(
        "/notes",
        json={"title": "Transcript", "content": "", "tags": ["transcript"], "kind": "transcript", "content_format": "plain_text"},
    )
    note_id = note.json()["frontmatter"]["id"]
    started = client.post(
        "/capture-sessions/start",
        json={
            "note_id": note_id,
            "session_mode": "notes",
            "capture_mode": "mic",
            "provider": "openai",
            "transcription_mode": "whisper",
        },
    )
    session_id = started.json()["session_id"]

    append = client.post(
        f"/capture-sessions/{session_id}/chunks",
        data={"chunk_index": "0", "source_hint": "unknown"},
        files={"file": ("chunk.wav", b"audio bytes", "audio/wav")},
    )
    assert append.status_code == 200
    assert append.json()["recoverable_error"] is True
    assert append.json()["pending_retry_count"] == 1

    finalized = client.post(f"/capture-sessions/{session_id}/finalize")
    assert finalized.status_code == 200
    assert finalized.json()["state"] == "retry_needed"
    assert (settings.notes_dir / "capture-sessions" / session_id / "chunks").exists()

    retried = client.post(f"/capture-sessions/{session_id}/retry-recovery")
    assert retried.status_code == 200
    retry_payload = retried.json()
    assert retry_payload["state"] == "completed"
    assert retry_payload["transcript"] == "recovered transcript"
    assert attempts[(0, "unknown")] == 9
    assert not (settings.notes_dir / "capture-sessions" / session_id / "chunks").exists()


def test_capture_session_recovery_on_restart_finalizes_unfinished_manifest(tmp_path, monkeypatch):
    async def fake_transcribe_chunk(self, **kwargs):
        return TranscriptionResult(
            text=f"startup transcript {kwargs.get('segment_id')}",
            provider="openai",
            model="whisper-1",
        )

    monkeypatch.setattr(TranscriptionService, "transcribe_chunk", fake_transcribe_chunk)

    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        storage_profile_path=tmp_path / "storage_profile.json",
        sync_profile_path=tmp_path / "sync_profile.json",
        desktop_token="desktop-test-token",
    )
    client = _build_test_client(settings)

    note = client.post(
        "/notes",
        json={"title": "Transcript", "content": "", "tags": ["transcript"], "kind": "transcript", "content_format": "plain_text"},
    )
    note_id = note.json()["frontmatter"]["id"]
    started = client.post(
        "/capture-sessions/start",
        json={
            "note_id": note_id,
            "session_mode": "notes",
            "capture_mode": "mic",
            "provider": "openai",
            "transcription_mode": "whisper",
        },
    )
    session_id = started.json()["session_id"]
    append = client.post(
        f"/capture-sessions/{session_id}/chunks",
        data={"chunk_index": "0", "source_hint": "unknown"},
        files={"file": ("chunk.wav", b"audio bytes", "audio/wav")},
    )
    assert append.status_code == 200
    client.close()

    with TestClient(create_app(settings)) as restarted:
        restarted.headers.update({"X-Notebook-Desktop-Token": settings.desktop_token})
        status = restarted.get(f"/capture-sessions/{session_id}")
        assert status.status_code == 200
        assert status.json()["state"] == "completed"
        assert status.json()["transcript"] == "startup transcript 0"

        listed = restarted.get("/notes")
        updated = next(item for item in listed.json() if item["frontmatter"]["id"] == note_id)
        assert updated["content"] == "startup transcript 0"


def test_capture_session_source_enrichment_does_not_block_canonical_completion(tmp_path, monkeypatch):
    async def fake_transcribe_chunk(self, **kwargs):
        source_hint = kwargs.get("source_hint")
        if source_hint == "unknown":
            return TranscriptionResult(
                text="canonical mixed transcript",
                provider="openai",
                model="whisper-1",
            )
        if source_hint == "other_audio":
            return TranscriptionResult(
                text="remote speaker",
                provider="openai",
                model="whisper-1",
            )
        return TranscriptionResult(
            text="",
            provider="openai",
            model="whisper-1",
            detail="temporary source split failure",
            ok=False,
            error_code="network_error",
            recoverable=True,
        )

    monkeypatch.setattr(TranscriptionService, "transcribe_chunk", fake_transcribe_chunk)

    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        storage_profile_path=tmp_path / "storage_profile.json",
        sync_profile_path=tmp_path / "sync_profile.json",
        desktop_token="desktop-test-token",
    )
    client = _build_test_client(settings)

    note = client.post(
        "/notes",
        json={"title": "Transcript", "content": "", "tags": ["transcript"], "kind": "transcript", "content_format": "plain_text"},
    )
    note_id = note.json()["frontmatter"]["id"]
    started = client.post(
        "/capture-sessions/start",
        json={
            "note_id": note_id,
            "session_mode": "notes",
            "capture_mode": "system_audio_plus_mic",
            "provider": "openai",
            "transcription_mode": "whisper",
        },
    )
    session_id = started.json()["session_id"]

    for source_hint in ("unknown", "other_audio", "me"):
        appended = client.post(
            f"/capture-sessions/{session_id}/chunks",
            data={"chunk_index": "0", "source_hint": source_hint},
            files={"file": ("chunk.wav", b"audio bytes", "audio/wav")},
        )
        assert appended.status_code == 200

    finalized = client.post(f"/capture-sessions/{session_id}/finalize")
    assert finalized.status_code == 200
    payload = finalized.json()
    assert payload["state"] == "completed"
    assert payload["transcript"] == "canonical mixed transcript"
    assert payload["segments"] == [
        {
            "id": "segment-other_audio-0",
            "text": "remote speaker",
            "source_hint": "other_audio",
            "chunk_index": 0,
            "started_at_ms": None,
            "duration_ms": None,
        }
    ]

    listed = client.get("/notes")
    updated = next(item for item in listed.json() if item["frontmatter"]["id"] == note_id)
    assert updated["content"] == "canonical mixed transcript"

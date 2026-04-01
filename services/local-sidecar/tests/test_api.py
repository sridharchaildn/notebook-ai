from __future__ import annotations

from app.config import Settings
from app.main import create_app
from fastapi.testclient import TestClient


def _build_test_client(settings: Settings) -> TestClient:
    settings.settings_profile_path = settings.notes_dir.parent / "user_settings.json"
    client = TestClient(create_app(settings))
    client.headers.update({"X-Notebook-Desktop-Token": settings.desktop_token})
    return client


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

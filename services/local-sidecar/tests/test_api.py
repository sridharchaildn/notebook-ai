from __future__ import annotations

from app.config import Settings
from app.main import create_app
from fastapi.testclient import TestClient


def test_notes_crud_and_provider_status(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
    )
    client = TestClient(create_app(settings))

    created = client.post(
        "/notes",
        json={"title": "Design Ideas", "body": "Ship desktop MVP", "tags": ["design"]},
    )
    assert created.status_code == 201
    note_id = created.json()["frontmatter"]["id"]

    listed = client.get("/notes")
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    updated = client.put(
        f"/notes/{note_id}",
        json={"title": "Design Ideas v2", "body": "Ship quickly", "tags": ["mvp"]},
    )
    assert updated.status_code == 200
    assert updated.json()["frontmatter"]["title"] == "Design Ideas v2"

    cached = client.post(
        "/providers/status/cache",
        json={"provider": "openai", "via": "oauth", "connected": True},
    )
    assert cached.status_code == 200
    openai_status = [item for item in cached.json() if item["provider"] == "openai"][0]
    assert openai_status["connected"] is True


def test_stream_transform_sse(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
    )
    client = TestClient(create_app(settings))

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

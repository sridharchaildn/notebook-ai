from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import httpx
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.models import AuthenticatedUser, SupabaseSessionPayload
from app.security import MemoryAuthGateway, decrypt_secret
from app.storage import MemoryStore


def _build_test_app(
    provider_transport: httpx.AsyncBaseTransport | None = None,
) -> tuple[TestClient, MemoryStore, MemoryAuthGateway, SupabaseSessionPayload]:
    settings = Settings(
        credential_secret="vault-secret",
        openai_oauth_client_id="client-test",
        openai_oauth_client_secret="openai-secret-test",
        openai_oauth_token_url="https://auth.openai.com/oauth/token",
        google_drive_oauth_token_url="https://oauth2.googleapis.com/token",
        google_drive_client_id="drive-client-test",
        google_drive_client_secret="drive-secret-test",
    )
    store = MemoryStore()
    user = AuthenticatedUser(id="user-a", email="user@example.com")
    session = SupabaseSessionPayload(
        access_token="access-user-a",
        refresh_token="refresh-user-a",
        expires_at=1_800_000_000,
        expires_in=3600,
        token_type="bearer",
        user=user,
    )
    auth = MemoryAuthGateway(
        users_by_access_token={session.access_token: user},
        sessions_by_refresh_token={session.refresh_token: session},
    )
    client = TestClient(
        create_app(
            settings,
            store=store,
            auth_gateway=auth,
            provider_transport=provider_transport,
        )
    )
    return client, store, auth, session


def _auth_headers(session: SupabaseSessionPayload) -> dict[str, str]:
    return {"Authorization": f"Bearer {session.access_token}"}


def test_byok_store_status_and_delete():
    client, _store, _auth, session = _build_test_app()

    saved = client.post(
        "/providers/byok",
        headers=_auth_headers(session),
        json={"provider": "openai", "api_key": "sk-test-123"},
    )
    assert saved.status_code == 200
    statuses = saved.json()
    openai = [item for item in statuses if item["provider"] == "openai"][0]
    assert openai["connected"] is True
    assert openai["via"] == "api_key"
    assert openai["scope"] == "account_vault"

    listed = client.get("/providers/status", headers=_auth_headers(session))
    assert listed.status_code == 200
    assert any(
        item["provider"] == "openai"
        and item["connected"]
        and item["scope"] == "account_vault"
        for item in listed.json()
    )

    credential = client.get(
        "/providers/credential",
        headers=_auth_headers(session),
        params={"provider": "openai"},
    )
    assert credential.status_code == 200
    assert credential.json()["secret"] == "sk-test-123"

    deleted = client.delete("/providers/openai", headers=_auth_headers(session))
    assert deleted.status_code == 200
    assert deleted.json()["connected"] is False


def test_oauth_start_and_callback_flow():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == httpx.URL("https://auth.openai.com/oauth/token")
        return httpx.Response(
            200,
            json={"access_token": "oauth-access-token", "refresh_token": "oauth-refresh-token"},
        )

    client, store, _auth, session = _build_test_app(provider_transport=httpx.MockTransport(handler))

    redirect = client.post(
        "/providers/openai/oauth/start",
        headers=_auth_headers(session),
    )
    assert redirect.status_code == 200
    location = redirect.json()["url"]

    parsed = urlparse(location)
    query = parse_qs(parsed.query)
    state = query["state"][0]

    callback = client.get(
        "/providers/openai/oauth/callback",
        params={"state": state, "code": "code-abc"},
    )
    assert callback.status_code == 200
    assert "OpenAI Connected" in callback.text

    record = store.credentials.get(("user-a", "openai"))
    assert record is not None
    assert record.connection_type == "oauth"
    decrypted = decrypt_secret(record.encrypted_value, "vault-secret")
    assert "oauth-access-token" in decrypted


def test_auth_refresh_and_logout():
    client, _store, _auth, session = _build_test_app()

    refreshed = client.post(
        "/auth/session/refresh",
        json={"refresh_token": session.refresh_token},
    )
    assert refreshed.status_code == 200
    assert refreshed.json()["session"]["access_token"] == session.access_token

    logout = client.post("/auth/logout", headers=_auth_headers(session))
    assert logout.status_code == 200
    assert logout.json()["ok"] is True

    after = client.get("/providers/status", headers=_auth_headers(session))
    assert after.status_code == 401


def test_storage_and_drive_status():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == httpx.URL("https://oauth2.googleapis.com/token")
        return httpx.Response(
            200,
            json={"access_token": "drive-access-token", "refresh_token": "drive-refresh-token"},
        )

    client, _store, _auth, session = _build_test_app(provider_transport=httpx.MockTransport(handler))

    pref = client.put(
        "/settings/storage",
        headers=_auth_headers(session),
        json={"mode": "local_and_drive", "local_root": "/tmp/notebook"},
    )
    assert pref.status_code == 200
    assert pref.json()["mode"] == "local_and_drive"

    drive = client.post(
        "/integrations/google-drive/byok",
        headers=_auth_headers(session),
        json={"refresh_token": "refresh-123", "folder_id": "folder-1"},
    )
    assert drive.status_code == 200
    assert drive.json()["connected"] is True

    drive_status = client.get("/integrations/google-drive/status", headers=_auth_headers(session))
    assert drive_status.status_code == 200
    assert drive_status.json()["connected"] is True

    updated_folder = client.put(
        "/integrations/google-drive/folder",
        headers=_auth_headers(session),
        json={"folder_id": "folder-2", "folder_name": "Notebook Mirror"},
    )
    assert updated_folder.status_code == 200
    assert updated_folder.json()["folder_id"] == "folder-2"
    assert updated_folder.json()["folder_name"] == "Notebook Mirror"

    drive_token = client.post("/integrations/google-drive/access-token", headers=_auth_headers(session))
    assert drive_token.status_code == 200
    assert drive_token.json()["access_token"] == "drive-access-token"
    assert drive_token.json()["folder_id"] == "folder-2"
    assert drive_token.json()["folder_name"] == "Notebook Mirror"

    workspace = client.get("/workspaces/current", headers=_auth_headers(session))
    assert workspace.status_code == 200
    assert workspace.json()["kind"] == "drive_shared"
    assert workspace.json()["storage_mode"] == "local_and_drive"
    assert workspace.json()["drive_folder_id"] == "folder-2"

    disconnected = client.post("/integrations/google-drive/disconnect", headers=_auth_headers(session))
    assert disconnected.status_code == 200
    assert disconnected.json()["connected"] is False
    assert disconnected.json()["folder_id"] is None

    drive_status_after = client.get("/integrations/google-drive/status", headers=_auth_headers(session))
    assert drive_status_after.status_code == 200
    assert drive_status_after.json()["connected"] is False

    disconnected_again = client.delete("/integrations/google-drive", headers=_auth_headers(session))
    assert disconnected_again.status_code == 200
    assert disconnected_again.json()["connected"] is False


def test_openai_provider_models_filters_copilot_models():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == httpx.URL("https://api.openai.com/v1/models")
        return httpx.Response(
            200,
            json={
                "data": [
                    {"id": "gpt-4o-mini", "owned_by": "openai"},
                    {"id": "gpt-4o-mini-transcribe", "owned_by": "openai"},
                    {"id": "text-embedding-3-small", "owned_by": "openai"},
                ]
            },
        )

    transport = httpx.MockTransport(handler)
    client, _store, _auth, session = _build_test_app(provider_transport=transport)
    saved = client.post(
        "/providers/byok",
        headers=_auth_headers(session),
        json={"provider": "openai", "api_key": "sk-test-123"},
    )
    assert saved.status_code == 200

    response = client.get(
        "/providers/models",
        headers=_auth_headers(session),
        params={"provider": "openai", "use_case": "copilot"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert [item["id"] for item in payload] == ["gpt-4o-mini"]


def test_openrouter_provider_models_filter_transcription_capable_models():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == httpx.URL("https://openrouter.ai/api/v1/models")
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "openai/gpt-4o-audio-preview",
                        "name": "GPT-4o Audio",
                        "top_provider": "openai",
                        "context_length": 128000,
                        "architecture": {"input_modalities": ["text", "audio"]},
                    },
                    {
                        "id": "openai/gpt-4.1-mini",
                        "name": "GPT-4.1 mini",
                        "top_provider": "openai",
                        "context_length": 128000,
                        "architecture": {"input_modalities": ["text"]},
                    },
                ]
            },
        )

    transport = httpx.MockTransport(handler)
    client, _store, _auth, session = _build_test_app(provider_transport=transport)
    saved = client.post(
        "/providers/byok",
        headers=_auth_headers(session),
        json={"provider": "openrouter", "api_key": "sk-or-test-123"},
    )
    assert saved.status_code == 200

    response = client.get(
        "/providers/models",
        headers=_auth_headers(session),
        params={"provider": "openrouter", "use_case": "transcription"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert [item["id"] for item in payload] == ["openai/gpt-4o-audio-preview"]
    assert payload[0]["supports_audio_input"] is True

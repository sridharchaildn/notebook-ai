from __future__ import annotations

from urllib.parse import parse_qs, urlparse

from app.config import Settings
from app.main import create_app
from app.security import decrypt_secret
from app.storage import CredentialVault
from fastapi.testclient import TestClient


def test_byok_store_status_and_delete(tmp_path):
    settings = Settings(
        database_path=tmp_path / "cloud.db",
        credential_secret="vault-secret",
    )
    client = TestClient(create_app(settings))

    saved = client.post(
        "/providers/byok",
        json={"provider": "openai", "api_key": "sk-test-123", "user_id": "user-a"},
    )
    assert saved.status_code == 200
    statuses = saved.json()
    openai = [item for item in statuses if item["provider"] == "openai"][0]
    assert openai["connected"] is True
    assert openai["via"] == "api_key"

    listed = client.get("/providers/status", params={"user_id": "user-a"})
    assert listed.status_code == 200
    assert any(item["provider"] == "openai" and item["connected"] for item in listed.json())

    credential = client.get(
        "/providers/credential",
        params={"provider": "openai", "user_id": "user-a"},
    )
    assert credential.status_code == 200
    assert credential.json()["secret"] == "sk-test-123"

    deleted = client.delete("/providers/openai", params={"user_id": "user-a"})
    assert deleted.status_code == 200
    assert deleted.json()["connected"] is False


def test_oauth_start_and_callback_flow(tmp_path):
    settings = Settings(
        database_path=tmp_path / "cloud.db",
        credential_secret="vault-secret",
        openai_oauth_client_id="client-test",
    )
    client = TestClient(create_app(settings))

    redirect = client.get(
        "/providers/openai/oauth/start",
        params={"user_id": "oauth-user"},
        follow_redirects=False,
    )
    assert redirect.status_code in {302, 307}
    location = redirect.headers["location"]

    parsed = urlparse(location)
    query = parse_qs(parsed.query)
    state = query["state"][0]

    callback = client.get(
        "/providers/openai/oauth/callback",
        params={"state": state, "code": "code-abc"},
    )
    assert callback.status_code == 200
    assert "OpenAI Connected" in callback.text

    vault = CredentialVault(settings.database_path)
    record = vault.get_credential("oauth-user", "openai")
    assert record is not None
    assert record.connection_type == "oauth"
    decrypted = decrypt_secret(record.encrypted_value, settings.credential_secret)
    assert "code-abc" in decrypted


def test_auth_session_exchange_dev_fallback(tmp_path):
    settings = Settings(
        database_path=tmp_path / "cloud.db",
        app_jwt_secret="dev-secret",
        dev_user_id="dev-user",
    )
    client = TestClient(create_app(settings))

    response = client.post("/auth/session/exchange", json={})
    assert response.status_code == 200
    payload = response.json()
    assert payload["user_id"] == "dev-user"
    assert isinstance(payload["session_token"], str) and payload["session_token"]

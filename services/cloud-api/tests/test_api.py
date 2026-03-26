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


def test_desktop_auth_exchange_round_trip(tmp_path):
    settings = Settings(
        database_path=tmp_path / "cloud.db",
        app_jwt_secret="desktop-secret",
        web_app_url="http://127.0.0.1:3000",
        desktop_auth_path="/desktop/auth",
        desktop_callback_scheme="notebook-ai://auth/callback",
    )
    client = TestClient(create_app(settings))

    init_res = client.post("/auth/desktop/exchange/init", json={"device_label": "MacBook"})
    assert init_res.status_code == 200
    state = init_res.json()["state"]
    assert state
    assert "http://127.0.0.1:3000/desktop/auth" in init_res.json()["auth_url"]

    docs_res = client.get("/legal/current")
    assert docs_res.status_code == 200
    docs = docs_res.json()["documents"]
    accept_res = client.post(
        "/legal/accept",
        json={
            "user_id": "desktop-user",
            "acceptances": [
                {"type": "privacy_policy", "version": docs[0]["version"]},
                {"type": "user_agreement", "version": docs[1]["version"]},
            ],
        },
    )
    assert accept_res.status_code == 200

    complete_web_res = client.post(
        "/auth/desktop/exchange/complete",
        json={"state": state, "user_id": "desktop-user"},
    )
    assert complete_web_res.status_code == 200
    code = complete_web_res.json()["code"]
    assert code
    assert complete_web_res.json()["deep_link_url"].startswith("notebook-ai://auth/callback?code=")

    complete_desktop_res = client.post(
        "/auth/desktop/exchange/complete",
        json={"code": code},
    )
    assert complete_desktop_res.status_code == 200
    assert complete_desktop_res.json()["user_id"] == "desktop-user"
    assert complete_desktop_res.json()["onboarding_complete"] is True
    assert isinstance(complete_desktop_res.json()["session_token"], str)


def test_desktop_auth_exchange_poll_round_trip(tmp_path):
    settings = Settings(
        database_path=tmp_path / "cloud.db",
        app_jwt_secret="desktop-secret",
        web_app_url="http://127.0.0.1:3000",
        desktop_auth_path="/desktop/auth",
        desktop_callback_scheme="notebook-ai://auth/callback",
    )
    client = TestClient(create_app(settings))

    init_res = client.post("/auth/desktop/exchange/init", json={"device_label": "MacBook"})
    assert init_res.status_code == 200
    state = init_res.json()["state"]

    docs_res = client.get("/legal/current")
    docs = docs_res.json()["documents"]
    accept_res = client.post(
        "/legal/accept",
        json={
            "user_id": "desktop-user",
            "acceptances": [
                {"type": "privacy_policy", "version": docs[0]["version"]},
                {"type": "user_agreement", "version": docs[1]["version"]},
            ],
        },
    )
    assert accept_res.status_code == 200

    pre_poll = client.get("/auth/desktop/exchange/poll", params={"state": state})
    assert pre_poll.status_code == 200
    assert pre_poll.json()["ready"] is False

    complete_web_res = client.post(
        "/auth/desktop/exchange/complete",
        json={"state": state, "user_id": "desktop-user"},
    )
    assert complete_web_res.status_code == 200

    poll_res = client.get("/auth/desktop/exchange/poll", params={"state": state})
    assert poll_res.status_code == 200
    assert poll_res.json()["ready"] is True
    assert poll_res.json()["user_id"] == "desktop-user"
    assert isinstance(poll_res.json()["session_token"], str)


def test_legal_storage_and_drive_status(tmp_path):
    settings = Settings(
        database_path=tmp_path / "cloud.db",
        credential_secret="vault-secret",
        app_jwt_secret="legal-secret",
    )
    client = TestClient(create_app(settings))

    legal_current = client.get("/legal/current")
    assert legal_current.status_code == 200
    docs = legal_current.json()["documents"]
    assert len(docs) == 2

    accepted = client.post(
        "/legal/accept",
        json={
            "user_id": "user-a",
            "acceptances": [
                {"type": "privacy_policy", "version": docs[0]["version"]},
                {"type": "user_agreement", "version": docs[1]["version"]},
            ],
        },
    )
    assert accepted.status_code == 200
    assert len(accepted.json()) == 2

    pref = client.put(
        "/settings/storage",
        json={"user_id": "user-a", "mode": "local_and_drive", "local_root": "/tmp/notebook"},
    )
    assert pref.status_code == 200
    assert pref.json()["mode"] == "local_and_drive"

    drive = client.post(
        "/integrations/google-drive/byok",
        json={"user_id": "user-a", "refresh_token": "refresh-123", "folder_id": "folder-1"},
    )
    assert drive.status_code == 200
    assert drive.json()["connected"] is True

    drive_status = client.get("/integrations/google-drive/status", params={"user_id": "user-a"})
    assert drive_status.status_code == 200
    assert drive_status.json()["connected"] is True

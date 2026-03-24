from __future__ import annotations

from app.config import Settings
from app.security import (
    create_app_session_token,
    decrypt_secret,
    encrypt_secret,
    parse_app_session_token,
)


def test_encrypt_decrypt_roundtrip():
    secret = "top-secret-key"
    encrypted = encrypt_secret("sk-test-value", secret)
    decrypted = decrypt_secret(encrypted, secret)
    assert decrypted == "sk-test-value"


def test_app_session_token_roundtrip(tmp_path):
    settings = Settings(
        database_path=tmp_path / "db.sqlite3",
        app_jwt_secret="unit-test-secret",
    )

    token, _ = create_app_session_token("user-123", settings)
    payload = parse_app_session_token(token, settings)

    assert payload["sub"] == "user-123"

from __future__ import annotations

from app.config import Settings


def test_settings_accepts_comma_separated_allowed_origins_env(monkeypatch):
    monkeypatch.setenv(
        "NOTEBOOK_CLOUD_ALLOWED_ORIGINS",
        "http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:5173,http://localhost:5173,null",
    )

    settings = Settings()

    assert settings.allowed_origins == (
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "null",
    )

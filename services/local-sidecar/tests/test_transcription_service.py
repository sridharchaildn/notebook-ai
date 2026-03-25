from __future__ import annotations

from app.services.transcription_service import _classify_whisper_http_error


def test_classify_invalid_audio_format_is_recoverable():
    code, recoverable = _classify_whisper_http_error(
        400,
        "Audio file might be corrupted or unsupported",
    )
    assert code == "invalid_audio_format"
    assert recoverable is True


def test_classify_auth_or_quota_not_recoverable():
    code, recoverable = _classify_whisper_http_error(
        401,
        "Incorrect API key provided.",
    )
    assert code == "auth_or_quota"
    assert recoverable is False


def test_classify_provider_http_error_recoverable_for_5xx():
    code, recoverable = _classify_whisper_http_error(
        503,
        "Service unavailable",
    )
    assert code == "provider_http_error"
    assert recoverable is True

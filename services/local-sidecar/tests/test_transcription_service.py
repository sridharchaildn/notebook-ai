from __future__ import annotations

from app.services.transcription_service import (
    _classify_whisper_http_error,
    _prepare_llm_audio_for_openai_input,
)


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


def test_prepare_llm_audio_accepts_normalized_live_capture_wav():
    prepared = _prepare_llm_audio_for_openai_input(
        b"fake wav bytes",
        "chunk.wav",
        "audio/wav",
        audio_origin="desktop_live_capture",
    )

    assert prepared.error is None
    assert prepared.api_format == "wav"
    assert prepared.data == b"fake wav bytes"


def test_prepare_llm_audio_rejects_non_normalized_live_capture_without_ffmpeg():
    prepared = _prepare_llm_audio_for_openai_input(
        b"fake webm bytes",
        "chunk.webm",
        "audio/webm",
        audio_origin="desktop_live_capture",
        ffmpeg_path=None,
    )

    assert prepared.error == (
        "Desktop live capture must send normalized WAV audio. "
        "Restart the recording and try again."
    )

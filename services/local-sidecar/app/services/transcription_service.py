from __future__ import annotations

import base64
import json
import logging
import shutil
import subprocess
from dataclasses import dataclass
from typing import Any

import httpx

from ..config import Settings
from ..provider_status_store import ProviderStatusStore

OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions"
OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"

log = logging.getLogger("notebook.sidecar.transcription")

TRANSCRIBE_LLM_PROMPT = (
    "Transcribe the spoken words in this audio verbatim. "
    "Reply with only the transcript text, no quotes or preamble."
)


def _build_llm_transcription_prompt(
    *,
    context_preset: str | None,
    context_text: str | None,
    source_hint: str | None,
    main_language: str | None = None,
    spoken_languages: list[str] | None = None,
    custom_vocabulary: list[str] | None = None,
) -> str:
    extra = _build_transcription_context_lines(
        context_preset=context_preset,
        context_text=context_text,
        source_hint=source_hint,
        main_language=main_language,
        spoken_languages=spoken_languages,
        custom_vocabulary=custom_vocabulary,
    )
    if not extra:
        return TRANSCRIBE_LLM_PROMPT
    return f"{TRANSCRIBE_LLM_PROMPT}\n{extra}"


def _build_whisper_prompt(
    *,
    context_preset: str | None,
    context_text: str | None,
    source_hint: str | None,
    main_language: str | None = None,
    spoken_languages: list[str] | None = None,
    custom_vocabulary: list[str] | None = None,
) -> str:
    extra = _build_transcription_context_lines(
        context_preset=context_preset,
        context_text=context_text,
        source_hint=source_hint,
        main_language=main_language,
        spoken_languages=spoken_languages,
        custom_vocabulary=custom_vocabulary,
    )
    if not extra:
        return ""
    return f"Context: {extra}"


def _build_transcription_context_lines(
    *,
    context_preset: str | None,
    context_text: str | None,
    source_hint: str | None,
    main_language: str | None = None,
    spoken_languages: list[str] | None = None,
    custom_vocabulary: list[str] | None = None,
) -> str:
    lines: list[str] = []
    normalized_preset = (context_preset or "").strip().lower()
    normalized_source = (source_hint or "").strip().lower()
    if normalized_preset == "meeting":
        lines.append("This audio is from a meeting or call.")
    elif normalized_preset == "podcast":
        lines.append("This audio is from a podcast episode.")
    elif normalized_preset == "youtube":
        lines.append("This audio is from a YouTube video.")
    elif normalized_preset == "custom":
        lines.append("Use the user-provided context to improve wording and punctuation only.")

    if normalized_source == "me":
        lines.append("This audio source is the local user's microphone.")
    elif normalized_source == "other_audio":
        lines.append("This audio source is the remote or system-audio side.")

    if context_text and context_text.strip():
        lines.append(f"User context: {context_text.strip()}")

    normalized_main_language = (main_language or "").strip()
    if normalized_main_language and normalized_main_language.lower() != "auto":
        lines.append(f"Primary spoken language: {normalized_main_language}")

    if spoken_languages:
        normalized_spoken_languages = [item.strip() for item in spoken_languages if item.strip()]
        if normalized_spoken_languages:
            lines.append(
                "Expected spoken languages: " + ", ".join(normalized_spoken_languages[:6])
            )

    if custom_vocabulary:
        normalized_vocabulary = [item.strip() for item in custom_vocabulary if item.strip()]
        if normalized_vocabulary:
            lines.append(
                "Prefer these exact terms if heard: " + ", ".join(normalized_vocabulary[:24])
            )

    return " ".join(lines).strip()


@dataclass
class TranscriptionResult:
    text: str
    provider: str
    model: str
    detail: str | None = None
    ok: bool = True
    error_code: str = "none"
    recoverable: bool = False
    segment_id: int | None = None


@dataclass(slots=True)
class _LLMAudioPrepared:
    data: bytes
    api_format: str  # "wav" or "mp3" only (OpenAI input_audio)
    error: str | None = None


class TranscriptionService:
    def __init__(self, settings: Settings, provider_store: ProviderStatusStore):
        self.settings = settings
        self.provider_store = provider_store

    async def transcribe_chunk(
        self,
        *,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
        audio_origin: str = "file_upload",
        provider: str = "openai",
        transcription_mode: str = "whisper",
        segment_id: int | None = None,
        model: str | None = None,
        context_preset: str | None = None,
        context_text: str | None = None,
        source_hint: str | None = None,
        main_language: str | None = None,
        spoken_languages: list[str] | None = None,
        custom_vocabulary: list[str] | None = None,
        access_token: str | None = None,
    ) -> TranscriptionResult:
        log.debug(
            "transcribe_chunk: bytes=%s filename=%s content_type=%s provider=%s mode=%s",
            len(audio_bytes),
            filename,
            content_type,
            provider,
            transcription_mode,
        )

        if transcription_mode == "llm":
            result = await self._transcribe_via_llm_chat(
                audio_bytes=audio_bytes,
                filename=filename,
                content_type=content_type,
                audio_origin=audio_origin,
                provider=provider,
                model=model,
                context_preset=context_preset,
                context_text=context_text,
                source_hint=source_hint,
                main_language=main_language,
                spoken_languages=spoken_languages,
                custom_vocabulary=custom_vocabulary,
                access_token=access_token,
            )
            result.segment_id = segment_id
            return result

        result = await self._transcribe_whisper_api(
            audio_bytes=audio_bytes,
            filename=filename,
            content_type=content_type,
            provider=provider,
            model=model,
            context_preset=context_preset,
            context_text=context_text,
            source_hint=source_hint,
            main_language=main_language,
            spoken_languages=spoken_languages,
            custom_vocabulary=custom_vocabulary,
            access_token=access_token,
        )
        result.segment_id = segment_id
        return result

    async def _transcribe_via_llm_chat(
        self,
        *,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
        audio_origin: str = "file_upload",
        provider: str,
        model: str | None = None,
        context_preset: str | None = None,
        context_text: str | None = None,
        source_hint: str | None = None,
        main_language: str | None = None,
        spoken_languages: list[str] | None = None,
        custom_vocabulary: list[str] | None = None,
        access_token: str | None = None,
    ) -> TranscriptionResult:
        or_key = await self._resolve_openrouter_api_key(access_token=access_token)
        oa_key = await self._resolve_openai_api_key(access_token=access_token)

        if provider == "openrouter" and or_key:
            url = f"{self.settings.openrouter_base_url.rstrip('/')}/chat/completions"
            selected_model = model or self.settings.transcription_llm_openrouter_model
            api_key = or_key
            used_provider = "openrouter"
            extra_headers = {
                "HTTP-Referer": "https://notebook-ai.local",
                "X-Title": "Notebook AI",
            }
        elif provider == "openrouter":
            msg = (
                "OpenRouter transcription needs an OpenRouter API key. "
                "Save one in Settings or switch the transcription provider."
            )
            return TranscriptionResult(
                text="",
                provider="openrouter",
                model=model or self.settings.transcription_llm_openrouter_model,
                detail=msg,
                ok=False,
                error_code="auth_or_quota",
                recoverable=False,
            )
        elif oa_key:
            url = OPENAI_CHAT_URL
            selected_model = model or self.settings.transcription_llm_openai_model
            api_key = oa_key
            used_provider = "openai"
            extra_headers = {}
        else:
            msg = (
                "LLM transcription needs an API key: set NOTEBOOK_LOCAL_OPENROUTER_API_KEY and/or "
                "NOTEBOOK_LOCAL_OPENAI_API_KEY, or save a provider key in desktop Settings."
            )
            log.warning("transcribe_llm: no openrouter or openai key")
            return TranscriptionResult(
                text="",
                provider=provider if provider in {"openai", "openrouter"} else "openai",
                model=(
                    model
                    or (
                        self.settings.transcription_llm_openrouter_model
                        if provider == "openrouter"
                        else self.settings.transcription_llm_openai_model
                    )
                ),
                detail=msg,
                ok=False,
                error_code="auth_or_quota",
                recoverable=False,
            )

        prepared = _prepare_llm_audio_for_openai_input(
            audio_bytes,
            filename,
            content_type,
            audio_origin=audio_origin,
            ffmpeg_path=str(self.settings.ffmpeg_path) if self.settings.ffmpeg_path else None,
        )
        if prepared.error:
            return TranscriptionResult(
                text="",
                provider=used_provider,
                model=selected_model,
                detail=prepared.error,
                ok=False,
                error_code="invalid_audio_format",
                recoverable=True,
            )

        b64 = base64.standard_b64encode(prepared.data).decode("ascii")
        audio_format = prepared.api_format

        payload: dict[str, Any] = {
            "model": selected_model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": _build_llm_transcription_prompt(
                                context_preset=context_preset,
                                context_text=context_text,
                                source_hint=source_hint,
                                main_language=main_language,
                                spoken_languages=spoken_languages,
                                custom_vocabulary=custom_vocabulary,
                            ),
                        },
                        {
                            "type": "input_audio",
                            "input_audio": {
                                "data": b64,
                                "format": audio_format,
                            },
                        },
                    ],
                }
            ],
            "max_tokens": 4096,
            "temperature": 0,
        }

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            **extra_headers,
        }

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                log.info(
                    "transcribe_llm: POST chat/completions provider=%s model=%s format=%s payload_bytes=%s",
                    used_provider,
                    selected_model,
                    audio_format,
                    len(prepared.data),
                )
                response = await client.post(url, headers=headers, json=payload)
        except httpx.HTTPError as exc:
            log.warning("transcribe_llm: httpx_error=%s", exc)
            return TranscriptionResult(
                text="",
                provider=used_provider,
                model=selected_model,
                detail=f"LLM transcription request failed: {exc}",
                ok=False,
                error_code="network_error",
                recoverable=True,
            )

        if response.status_code >= 400:
            preview = (response.text or "")[:500]
            log.warning(
                "transcribe_llm: status=%s body_preview=%s",
                response.status_code,
                preview.replace("\n", " "),
            )
            detail = f"LLM transcription HTTP {response.status_code}: {preview}"
            extra = _llm_transcription_error_hint(response.status_code, preview, selected_model)
            if extra:
                detail = f"{detail}\n{extra}"
            return TranscriptionResult(
                text="",
                provider=used_provider,
                model=selected_model,
                detail=detail,
                ok=False,
                error_code="provider_http_error",
                recoverable=response.status_code >= 500 or response.status_code == 429,
            )

        try:
            body = response.json()
        except json.JSONDecodeError:
            return TranscriptionResult(
                text="",
                provider=used_provider,
                model=selected_model,
                detail="LLM transcription: invalid JSON response.",
                ok=False,
                error_code="provider_http_error",
                recoverable=True,
            )

        choices = body.get("choices")
        if not isinstance(choices, list) or not choices:
            return TranscriptionResult(
                text="",
                provider=used_provider,
                model=selected_model,
                detail="LLM transcription: empty choices in response.",
                ok=False,
                error_code="provider_http_error",
                recoverable=True,
            )

        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        if not isinstance(message, dict):
            return TranscriptionResult(
                text="",
                provider=used_provider,
                model=selected_model,
                detail="LLM transcription: missing message in response.",
                ok=False,
                error_code="provider_http_error",
                recoverable=True,
            )

        text = _extract_chat_message_text(message).strip()
        log.info("transcribe_llm: ok text_len=%s", len(text))
        return TranscriptionResult(
            text=text,
            provider=used_provider,
            model=selected_model,
            detail=None if text else "LLM returned empty transcript (model may not support this audio format).",
            ok=True,
            error_code="none",
            recoverable=False,
        )

    async def _transcribe_whisper_api(
        self,
        *,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
        provider: str,
        model: str | None = None,
        context_preset: str | None = None,
        context_text: str | None = None,
        source_hint: str | None = None,
        main_language: str | None = None,
        spoken_languages: list[str] | None = None,
        custom_vocabulary: list[str] | None = None,
        access_token: str | None = None,
    ) -> TranscriptionResult:
        if provider != "openai":
            msg = (
                "Whisper mode uses OpenAI speech-to-text only. Switch to LLM mode for OpenRouter multimodal, "
                "or set NOTEBOOK_LOCAL_OPENAI_API_KEY / OpenAI BYOK."
            )
            log.info("transcribe_whisper: rejected provider=%s", provider)
            return TranscriptionResult(
                text="",
                provider=provider,
                model=model or self.settings.openai_transcription_model,
                detail=msg,
                ok=False,
                error_code="provider_http_error",
                recoverable=False,
            )

        api_key = await self._resolve_openai_api_key(access_token=access_token)
        if not api_key:
            msg = (
                "No OpenAI API key: set NOTEBOOK_LOCAL_OPENAI_API_KEY in the sidecar .env or "
                "save an OpenAI key in desktop Settings. Desktop BYOK is stored locally on this device."
            )
            log.warning("transcribe_whisper: missing OpenAI API key after local lookup")
            return TranscriptionResult(
                text="",
                provider="openai",
                model=model or self.settings.openai_transcription_model,
                detail=msg,
                ok=False,
                error_code="auth_or_quota",
                recoverable=False,
            )

        models_to_try: list[str] = []
        for candidate in [
            model,
            self.settings.openai_transcription_model,
            "gpt-4o-mini-transcribe",
            "whisper-1",
        ]:
            if not candidate:
                continue
            if candidate not in models_to_try:
                models_to_try.append(candidate)

        last_error: str | None = None
        last_error_code = "provider_http_error"
        last_recoverable = False
        prompt = _build_whisper_prompt(
            context_preset=context_preset,
            context_text=context_text,
            source_hint=source_hint,
            main_language=main_language,
            spoken_languages=spoken_languages,
            custom_vocabulary=custom_vocabulary,
        )
        whisper_language = (main_language or "").strip()
        whisper_language = "" if whisper_language.lower() == "auto" else whisper_language
        async with httpx.AsyncClient(timeout=30.0) as client:
            for model in models_to_try:
                try:
                    log.debug("transcribe_whisper: trying model=%s", model)
                    response = await client.post(
                        OPENAI_TRANSCRIPTION_URL,
                        headers={"Authorization": f"Bearer {api_key}"},
                        data={
                            "model": model,
                            **({"prompt": prompt} if prompt else {}),
                            **({"language": whisper_language} if whisper_language else {}),
                        },
                        files={"file": (filename, audio_bytes, content_type)},
                    )

                    if response.status_code >= 400:
                        body_preview = (response.text or "")[:300]
                        last_error = f"HTTP {response.status_code}: {body_preview}"
                        last_error_code, last_recoverable = _classify_whisper_http_error(
                            response.status_code,
                            body_preview,
                        )
                        log.warning(
                            "transcribe_whisper: model=%s status=%s body_preview=%s",
                            model,
                            response.status_code,
                            body_preview.replace("\n", " "),
                        )
                        continue

                    resp_payload = response.json()
                    text = str(resp_payload.get("text") or "").strip()
                    log.info(
                        "transcribe_whisper: ok model=%s text_len=%s",
                        model,
                        len(text),
                    )
                    return TranscriptionResult(
                        text=text,
                        provider="openai",
                        model=model,
                        detail=None if text else "OpenAI returned empty text for this audio chunk.",
                        ok=True,
                        error_code="none",
                        recoverable=False,
                    )
                except httpx.HTTPError as exc:
                    last_error = str(exc)
                    last_error_code = "network_error"
                    last_recoverable = True
                    log.warning("transcribe_whisper: model=%s httpx_error=%s", model, exc)

        detail = "OpenAI transcription failed for all models."
        if last_error:
            detail = f"{detail} Last error: {last_error[:400]}"
        log.error("transcribe_whisper: all models failed last_error=%s", last_error)
        return TranscriptionResult(
            text="",
            provider="openai",
            model=model or self.settings.openai_transcription_model,
            detail=detail,
            ok=False,
            error_code=last_error_code,
            recoverable=last_recoverable,
        )

    async def _resolve_openai_api_key(self, access_token: str | None = None) -> str | None:
        _ = access_token
        local = self.provider_store.get_api_key(
            "openai",
            self.settings.openai_api_key,
            self.settings.openrouter_api_key,
        )
        if local:
            log.debug("OpenAI key source=local_env")
            return local
        return None

    async def _resolve_openrouter_api_key(self, access_token: str | None = None) -> str | None:
        _ = access_token
        local = self.provider_store.get_api_key(
            "openrouter",
            self.settings.openai_api_key,
            self.settings.openrouter_api_key,
        )
        if local:
            log.debug("OpenRouter key source=local_env")
            return local
        return None


def _prepare_llm_audio_for_openai_input(
    audio_bytes: bytes,
    filename: str,
    content_type: str,
    audio_origin: str = "file_upload",
    ffmpeg_path: str | None = None,
) -> _LLMAudioPrepared:
    """OpenAI input_audio only allows format wav or mp3."""
    fmt = _guess_audio_format(filename, content_type)
    if fmt in {"wav", "mp3"}:
        return _LLMAudioPrepared(data=audio_bytes, api_format=fmt)

    if audio_origin == "desktop_live_capture":
        return _LLMAudioPrepared(
            data=b"",
            api_format="wav",
            error=(
                "Desktop live capture must send normalized WAV audio. "
                "Restart the recording and try again."
            ),
        )

    wav = _ffmpeg_transcode_to_wav(audio_bytes, ffmpeg_path=ffmpeg_path)
    if wav is not None:
        log.info(
            "LLM audio: transcoded %s -> wav via ffmpeg (in=%s out=%s)",
            fmt,
            len(audio_bytes),
            len(wav),
        )
        return _LLMAudioPrepared(data=wav, api_format="wav")

    return _LLMAudioPrepared(
        data=b"",
        api_format="wav",
        error=(
            "LLM mode needs WAV or MP3 for OpenAI. Re-export this audio as WAV/MP3, "
            "or install `ffmpeg` on the host running the sidecar so unsupported files can be transcoded."
        ),
    )


def _ffmpeg_transcode_to_wav(audio_bytes: bytes, ffmpeg_path: str | None = None) -> bytes | None:
    ffmpeg_binary = ffmpeg_path or shutil.which("ffmpeg")
    if not ffmpeg_binary:
        log.warning("ffmpeg not found on PATH; cannot transcode WebM for LLM transcription")
        return None
    return _ffmpeg_transcode_to_wav_with_binary(audio_bytes, ffmpeg_binary)


def _ffmpeg_transcode_to_wav_with_binary(audio_bytes: bytes, ffmpeg_binary: str) -> bytes | None:
    try:
        result = subprocess.run(
            [
                ffmpeg_binary,
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                "pipe:0",
                "-f",
                "wav",
                "-acodec",
                "pcm_s16le",
                "-ac",
                "1",
                "-ar",
                "16000",
                "pipe:1",
            ],
            input=audio_bytes,
            capture_output=True,
            timeout=90,
            check=False,
        )
        if result.returncode != 0:
            log.warning(
                "ffmpeg failed rc=%s stderr=%s",
                result.returncode,
                (result.stderr or b"")[:500].decode(errors="replace"),
            )
            return None
        if not result.stdout:
            return None
        return result.stdout
    except (subprocess.TimeoutExpired, OSError) as exc:
        log.warning("ffmpeg subprocess error: %s", exc)
        return None


def _llm_transcription_error_hint(status: int, body_preview: str, model: str) -> str:
    low = body_preview.lower()
    if status == 404 and "input audio" in low:
        return (
            f"Hint: `{model}` does not accept audio on this gateway. "
            "In .env set NOTEBOOK_LOCAL_TRANSCRIPTION_LLM_OPENROUTER_MODEL=openai/gpt-4o-audio-preview "
            "(or another model with audio input on openrouter.ai/models). "
            "Restart the sidecar after changing .env."
        )
    if status == 400 and "webm" in low and "supported values" in low:
        return (
            "Hint: OpenAI only allows input_audio.format wav or mp3. "
            "If this came from an imported WebM file, install ffmpeg on the sidecar host or re-export the file as WAV/MP3."
        )
    return ""


def _classify_whisper_http_error(status: int, body_preview: str) -> tuple[str, bool]:
    low = body_preview.lower()

    if status in {401, 403, 402, 429}:
        return "auth_or_quota", False

    if (
        "invalid file format" in low
        or "audio file might be corrupted or unsupported" in low
        or ("param\": \"file\"" in low and "invalid_value" in low)
    ):
        return "invalid_audio_format", True

    if status >= 500:
        return "provider_http_error", True

    return "provider_http_error", False


def _guess_audio_format(filename: str, content_type: str) -> str:
    lower = filename.lower()
    if lower.endswith(".webm"):
        return "webm"
    if lower.endswith(".mp4") or lower.endswith(".m4a"):
        return "mp4"
    if lower.endswith(".wav"):
        return "wav"
    if lower.endswith(".mp3"):
        return "mp3"
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct == "audio/webm":
        return "webm"
    if ct in {"audio/mp4", "audio/m4a"}:
        return "mp4"
    if ct == "audio/wav" or ct == "audio/x-wav":
        return "wav"
    if ct == "audio/mpeg":
        return "mp3"
    return "webm"


def _extract_chat_message_text(message: dict[str, Any]) -> str:
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                t = block.get("text")
                if isinstance(t, str):
                    parts.append(t)
        return "".join(parts)
    return ""

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

OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions"
OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"

log = logging.getLogger("notebook.sidecar.transcription")

TRANSCRIBE_LLM_PROMPT = (
    "Transcribe the spoken words in this audio verbatim. "
    "Reply with only the transcript text, no quotes or preamble."
)


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
    def __init__(self, settings: Settings):
        self.settings = settings

    async def transcribe_chunk(
        self,
        *,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
        provider: str = "openai",
        transcription_mode: str = "whisper",
        segment_id: int | None = None,
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
                access_token=access_token,
            )
            result.segment_id = segment_id
            return result

        result = await self._transcribe_whisper_api(
            audio_bytes=audio_bytes,
            filename=filename,
            content_type=content_type,
            provider=provider,
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
        access_token: str | None = None,
    ) -> TranscriptionResult:
        or_key = await self._resolve_openrouter_api_key(access_token=access_token)
        oa_key = await self._resolve_openai_api_key(access_token=access_token)

        if or_key:
            url = f"{self.settings.openrouter_base_url.rstrip('/')}/chat/completions"
            model = self.settings.transcription_llm_openrouter_model
            api_key = or_key
            used_provider = "openrouter"
            extra_headers = {
                "HTTP-Referer": "https://notebook-ai.local",
                "X-Title": "Notebook AI",
            }
        elif oa_key:
            url = OPENAI_CHAT_URL
            model = self.settings.transcription_llm_openai_model
            api_key = oa_key
            used_provider = "openai"
            extra_headers = {}
        else:
            msg = (
                "LLM transcription needs an API key: set NOTEBOOK_LOCAL_OPENROUTER_API_KEY and/or "
                "NOTEBOOK_LOCAL_OPENAI_API_KEY, or store credentials via the desktop (BYOK) with cloud API running."
            )
            log.warning("transcribe_llm: no openrouter or openai key")
            return TranscriptionResult(
                text="",
                provider="openrouter",
                model=self.settings.transcription_llm_openrouter_model,
                detail=msg,
                ok=False,
                error_code="auth_or_quota",
                recoverable=False,
            )

        prepared = _prepare_llm_audio_for_openai_input(audio_bytes, filename, content_type)
        if prepared.error:
            return TranscriptionResult(
                text="",
                provider=used_provider,
                model=model,
                detail=prepared.error,
                ok=False,
                error_code="invalid_audio_format",
                recoverable=True,
            )

        b64 = base64.standard_b64encode(prepared.data).decode("ascii")
        audio_format = prepared.api_format

        payload: dict[str, Any] = {
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": TRANSCRIBE_LLM_PROMPT},
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
                    model,
                    audio_format,
                    len(prepared.data),
                )
                response = await client.post(url, headers=headers, json=payload)
        except httpx.HTTPError as exc:
            log.warning("transcribe_llm: httpx_error=%s", exc)
            return TranscriptionResult(
                text="",
                provider=used_provider,
                model=model,
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
            extra = _llm_transcription_error_hint(response.status_code, preview, model)
            if extra:
                detail = f"{detail}\n{extra}"
            return TranscriptionResult(
                text="",
                provider=used_provider,
                model=model,
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
                model=model,
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
                model=model,
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
                model=model,
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
            model=model,
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
                model=self.settings.openai_transcription_model,
                detail=msg,
                ok=False,
                error_code="provider_http_error",
                recoverable=False,
            )

        api_key = await self._resolve_openai_api_key(access_token=access_token)
        if not api_key:
            msg = (
                "No OpenAI API key: set NOTEBOOK_LOCAL_OPENAI_API_KEY in the sidecar .env or "
                "save an OpenAI key / complete OpenAI OAuth in the desktop (cloud API must be running)."
            )
            log.warning("transcribe_whisper: missing OpenAI API key after local + cloud lookup")
            return TranscriptionResult(
                text="",
                provider="openai",
                model=self.settings.openai_transcription_model,
                detail=msg,
                ok=False,
                error_code="auth_or_quota",
                recoverable=False,
            )

        models_to_try = [
            self.settings.openai_transcription_model,
            "gpt-4o-mini-transcribe",
            "whisper-1",
        ]

        last_error: str | None = None
        last_error_code = "provider_http_error"
        last_recoverable = False
        async with httpx.AsyncClient(timeout=30.0) as client:
            for model in models_to_try:
                try:
                    log.debug("transcribe_whisper: trying model=%s", model)
                    response = await client.post(
                        OPENAI_TRANSCRIPTION_URL,
                        headers={"Authorization": f"Bearer {api_key}"},
                        data={"model": model},
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
            model=self.settings.openai_transcription_model,
            detail=detail,
            ok=False,
            error_code=last_error_code,
            recoverable=last_recoverable,
        )

    async def _resolve_openai_api_key(self, access_token: str | None = None) -> str | None:
        local = (self.settings.openai_api_key or "").strip()
        if local:
            log.debug("OpenAI key source=local_env")
            return local

        if not access_token:
            return None

        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.get(
                    f"{self.settings.cloud_api_url}/providers/credential",
                    params={"provider": "openai"},
                    headers={"Authorization": f"Bearer {access_token}"},
                )
        except httpx.HTTPError as exc:
            log.debug("cloud openai credential fetch failed: %s", exc)
            return None

        if response.status_code != 200:
            log.debug("cloud openai credential: status=%s", response.status_code)
            return None

        payload = response.json()
        secret = str(payload.get("secret") or "").strip()
        if not secret:
            return None

        connection_type = str(payload.get("connection_type") or "")
        if connection_type == "oauth":
            try:
                parsed = json.loads(secret)
                if isinstance(parsed, dict):
                    candidate = str(parsed.get("access_token") or "").strip()
                    if candidate:
                        log.debug("OpenAI key source=cloud_oauth")
                    return candidate or None
            except json.JSONDecodeError:
                return None

        log.debug("OpenAI key source=cloud_api_key")
        return secret

    async def _resolve_openrouter_api_key(self, access_token: str | None = None) -> str | None:
        local = (self.settings.openrouter_api_key or "").strip()
        if local:
            log.debug("OpenRouter key source=local_env")
            return local

        if not access_token:
            return None

        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.get(
                    f"{self.settings.cloud_api_url}/providers/credential",
                    params={"provider": "openrouter"},
                    headers={"Authorization": f"Bearer {access_token}"},
                )
        except httpx.HTTPError as exc:
            log.debug("cloud openrouter credential fetch failed: %s", exc)
            return None

        if response.status_code != 200:
            return None

        payload = response.json()
        secret = str(payload.get("secret") or "").strip()
        if not secret:
            return None

        connection_type = str(payload.get("connection_type") or "")
        if connection_type == "oauth":
            try:
                parsed = json.loads(secret)
                if isinstance(parsed, dict):
                    candidate = str(parsed.get("access_token") or "").strip()
                    return candidate or None
            except json.JSONDecodeError:
                return None

        log.debug("OpenRouter key source=cloud_api_key")
        return secret


def _prepare_llm_audio_for_openai_input(
    audio_bytes: bytes,
    filename: str,
    content_type: str,
) -> _LLMAudioPrepared:
    """OpenAI input_audio only allows format wav or mp3; browsers usually emit WebM."""
    fmt = _guess_audio_format(filename, content_type)
    if fmt in {"wav", "mp3"}:
        return _LLMAudioPrepared(data=audio_bytes, api_format=fmt)

    wav = _ffmpeg_transcode_to_wav(audio_bytes)
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
            "LLM mode needs WAV or MP3 for OpenAI; the recorder sent WebM/Opus. "
            "Install `ffmpeg` on the host running the sidecar (PATH), or use Whisper API mode."
        ),
    )


def _ffmpeg_transcode_to_wav(audio_bytes: bytes) -> bytes | None:
    if not shutil.which("ffmpeg"):
        log.warning("ffmpeg not found on PATH; cannot transcode WebM for LLM transcription")
        return None
    try:
        result = subprocess.run(
            [
                "ffmpeg",
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
            "Install ffmpeg on the sidecar host so WebM is transcoded automatically, or use Whisper API mode."
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

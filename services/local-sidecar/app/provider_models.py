from __future__ import annotations

import httpx
from fastapi import HTTPException

from .models import ProviderModel


async def fetch_provider_models(
    *,
    provider: str,
    api_key: str,
    use_case: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[ProviderModel]:
    if provider == "openai":
        return await _fetch_openai_models(token=api_key, use_case=use_case, transport=transport)
    if provider == "openrouter":
        return await _fetch_openrouter_models(token=api_key, use_case=use_case, transport=transport)
    raise HTTPException(status_code=404, detail="Unsupported provider")


async def _fetch_openai_models(
    *,
    token: str,
    use_case: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[ProviderModel]:
    async with httpx.AsyncClient(timeout=20.0, transport=transport) as client:
        response = await client.get(
            "https://api.openai.com/v1/models",
            headers={"Authorization": f"Bearer {token}"},
        )
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI model list failed: {exc.response.text[:300]}") from exc

    payload = response.json()
    data = payload.get("data")
    if not isinstance(data, list):
        data = []

    models: list[ProviderModel] = []
    for raw in data:
        if not isinstance(raw, dict):
            continue
        model_id = str(raw.get("id") or "").strip()
        if not model_id:
            continue
        if use_case == "copilot":
            if not _openai_supports_copilot(model_id):
                continue
            models.append(
                ProviderModel(
                    id=model_id,
                    label=model_id,
                    provider="openai",
                    owned_by=str(raw.get("owned_by") or "") or None,
                )
            )
            continue

        if _openai_supports_transcription(model_id):
            models.append(
                ProviderModel(
                    id=model_id,
                    label=model_id,
                    provider="openai",
                    owned_by=str(raw.get("owned_by") or "") or None,
                    supports_audio_input=True,
                )
            )

    if use_case == "transcription":
        for fallback_id in ("gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"):
            if all(item.id != fallback_id for item in models):
                models.append(
                    ProviderModel(
                        id=fallback_id,
                        label=fallback_id,
                        provider="openai",
                        owned_by="openai",
                        supports_audio_input=True,
                    )
                )

    return sorted(models, key=lambda item: _provider_model_sort_key(item.id))


async def _fetch_openrouter_models(
    *,
    token: str,
    use_case: str,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[ProviderModel]:
    headers = {
        "Authorization": f"Bearer {token}",
        "HTTP-Referer": "https://notebook-ai.local",
        "X-Title": "Notebook AI",
    }
    async with httpx.AsyncClient(timeout=20.0, transport=transport) as client:
        response = await client.get("https://openrouter.ai/api/v1/models", headers=headers)
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"OpenRouter model list failed: {exc.response.text[:300]}") from exc

    payload = response.json()
    data = payload.get("data")
    if not isinstance(data, list):
        data = []

    models: list[ProviderModel] = []
    for raw in data:
        if not isinstance(raw, dict):
            continue
        model_id = str(raw.get("id") or "").strip()
        if not model_id:
            continue

        architecture = raw.get("architecture") if isinstance(raw.get("architecture"), dict) else {}
        input_modalities = architecture.get("input_modalities") if isinstance(architecture, dict) else None
        supports_audio = isinstance(input_modalities, list) and "audio" in {
            str(item).lower() for item in input_modalities
        }

        if use_case == "transcription" and not supports_audio:
            continue

        models.append(
            ProviderModel(
                id=model_id,
                label=str(raw.get("name") or model_id),
                provider="openrouter",
                owned_by=str(raw.get("top_provider") or "") or None,
                context_length=int(raw.get("context_length")) if isinstance(raw.get("context_length"), int) else None,
                supports_audio_input=supports_audio,
            )
        )

    return sorted(models, key=lambda item: _provider_model_sort_key(item.id))


def _openai_supports_copilot(model_id: str) -> bool:
    blocked_fragments = ("embedding", "moderation", "transcribe", "whisper", "tts", "realtime")
    if any(fragment in model_id for fragment in blocked_fragments):
        return False
    return model_id.startswith(("gpt-", "chatgpt-", "o1", "o3", "o4"))


def _openai_supports_transcription(model_id: str) -> bool:
    lowered = model_id.lower()
    return "transcribe" in lowered or lowered == "whisper-1" or "audio" in lowered


def _provider_model_sort_key(model_id: str) -> tuple[int, str]:
    preferred = {
        "gpt-4o-mini": 0,
        "gpt-4.1-mini": 1,
        "gpt-4.1": 2,
        "gpt-4o": 3,
        "o4-mini": 4,
        "o3-mini": 5,
        "openai/gpt-4o-mini": 6,
        "openai/gpt-4.1-mini": 7,
        "openai/gpt-4.1": 8,
        "openai/gpt-4o": 9,
        "openai/gpt-4o-audio-preview": 10,
        "gpt-4o-mini-transcribe": 11,
        "gpt-4o-transcribe": 12,
        "whisper-1": 13,
    }
    return preferred.get(model_id, 1000), model_id

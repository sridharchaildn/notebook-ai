from __future__ import annotations

import asyncio
import json
import re
from collections.abc import AsyncIterator

import httpx

from ..config import Settings
from ..models import AITransformRequest
from ..providers import OpenAIAdapter, OpenRouterAdapter


class AIService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._adapter_cache: dict[str, OpenAIAdapter | OpenRouterAdapter | None] = {}

        self._openai = (
            OpenAIAdapter(
                api_key=settings.openai_api_key,
                default_model=settings.openai_model,
            )
            if settings.openai_api_key
            else None
        )

        self._openrouter = (
            OpenRouterAdapter(
                api_key=settings.openrouter_api_key,
                default_model=settings.openrouter_model,
                base_url=settings.openrouter_base_url,
            )
            if settings.openrouter_api_key
            else None
        )

    async def stream_transform(self, payload: AITransformRequest) -> AsyncIterator[str]:
        provider = payload.provider or self.settings.default_provider
        system_prompt, user_prompt = _build_prompts(payload)

        adapter = await self._resolve_adapter(provider)
        if adapter is None:
            async for token in _stream_local_fallback(payload):
                yield token
            return

        async for token in adapter.stream_completion(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            model=payload.model,
        ):
            yield token

    async def _resolve_adapter(self, provider: str):
        if provider == "openrouter" and self._openrouter:
            return self._openrouter
        if provider == "openai" and self._openai:
            return self._openai

        if provider in self._adapter_cache:
            return self._adapter_cache[provider]

        resolved = await self._load_adapter_from_cloud(provider)
        self._adapter_cache[provider] = resolved
        return resolved

    async def _load_adapter_from_cloud(self, provider: str):
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.get(
                    f"{self.settings.cloud_api_url}/providers/credential",
                    params={
                        "provider": provider,
                        "user_id": self.settings.cloud_user_id,
                    },
                )
        except httpx.HTTPError:
            return None

        if response.status_code != 200:
            return None

        payload = response.json()
        secret = str(payload.get("secret", "")).strip()
        connection_type = str(payload.get("connection_type", ""))

        if not secret:
            return None

        if connection_type == "oauth":
            try:
                parsed = json.loads(secret)
                if isinstance(parsed, dict):
                    secret = str(parsed.get("access_token") or parsed.get("authorization_code") or "")
            except json.JSONDecodeError:
                pass

        if not secret:
            return None

        if provider == "openrouter":
            return OpenRouterAdapter(
                api_key=secret,
                default_model=self.settings.openrouter_model,
                base_url=self.settings.openrouter_base_url,
            )

        return OpenAIAdapter(
            api_key=secret,
            default_model=self.settings.openai_model,
        )


def _build_prompts(payload: AITransformRequest) -> tuple[str, str]:
    if payload.transform == "summarize":
        system = (
            "You are a precise note assistant. Produce concise, high-signal summaries "
            "with clear bullet points and no fluff."
        )
        user = f"Summarize this note in 5-8 bullets:\n\n{payload.content}"
        return system, user

    if payload.transform == "rewrite":
        system = (
            "You rewrite notes to improve clarity while preserving meaning. "
            "Keep structure readable and avoid adding unsupported details."
        )
        user = (
            f"Rewrite this note in a {payload.tone} tone. "
            "Keep all key facts and improve clarity:\n\n"
            f"{payload.content}"
        )
        return system, user

    system = (
        "Extract actionable tasks from notes. Return concise markdown checkboxes with "
        "specific outcomes."
    )
    user = f"Extract action items from this note:\n\n{payload.content}"
    return system, user


async def _stream_local_fallback(payload: AITransformRequest) -> AsyncIterator[str]:
    transformed = _deterministic_transform(payload)
    for piece in re.findall(r"\S+\s*", transformed):
        yield piece
        await asyncio.sleep(0)


def _deterministic_transform(payload: AITransformRequest) -> str:
    text = payload.content.strip()
    if not text:
        return "No note content provided."

    if payload.transform == "summarize":
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        top = lines[:7]
        bullets = "\n".join(f"- {line[:180]}" for line in top)
        return f"Summary (local fallback):\n{bullets}" if bullets else "Summary unavailable."

    if payload.transform == "rewrite":
        return (
            f"Rewritten ({payload.tone}) (local fallback):\n\n"
            f"{text.replace('  ', ' ').strip()}"
        )

    tasks: list[str] = []
    for raw in text.splitlines():
        line = raw.strip("- *\t ")
        if not line:
            continue
        if any(line.lower().startswith(prefix) for prefix in ("todo", "task", "action", "next")):
            tasks.append(line)
            continue
        if len(line.split()) <= 10:
            tasks.append(line)

    if not tasks:
        tasks = ["Review note and define next concrete action."]

    return "\n".join(f"- [ ] {task}" for task in tasks[:8])

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from .base import ProviderAdapter


class OpenAIAdapter(ProviderAdapter):
    def __init__(
        self,
        *,
        api_key: str,
        default_model: str,
        base_url: str | None = None,
        extra_headers: dict[str, str] | None = None,
    ):
        self.api_key = api_key
        self.default_model = default_model
        self.base_url = base_url
        self.extra_headers = extra_headers or {}

    async def stream_completion(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        model: str | None = None,
    ) -> AsyncIterator[str]:
        client = ChatOpenAI(
            api_key=self.api_key,
            model=model or self.default_model,
            base_url=self.base_url,
            default_headers=self.extra_headers,
            temperature=0.2,
        )
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ]

        async for chunk in client.astream(messages):
            text = _extract_chunk_text(chunk.content)
            if text:
                yield text


def _extract_chunk_text(content: Any) -> str:
    if isinstance(content, str):
        return content

    if isinstance(content, list):
        fragments: list[str] = []
        for item in content:
            if isinstance(item, str):
                fragments.append(item)
            elif isinstance(item, dict) and isinstance(item.get("text"), str):
                fragments.append(item["text"])
            elif hasattr(item, "text") and isinstance(item.text, str):
                fragments.append(item.text)
        return "".join(fragments)

    if hasattr(content, "text") and isinstance(content.text, str):
        return content.text

    return ""

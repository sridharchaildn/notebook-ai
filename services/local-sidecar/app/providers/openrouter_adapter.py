from __future__ import annotations

from .openai_adapter import OpenAIAdapter


class OpenRouterAdapter(OpenAIAdapter):
    def __init__(self, *, api_key: str, default_model: str, base_url: str):
        super().__init__(
            api_key=api_key,
            default_model=default_model,
            base_url=base_url,
            extra_headers={
                "HTTP-Referer": "https://notebook-ai.local",
                "X-Title": "Notebook AI",
            },
        )

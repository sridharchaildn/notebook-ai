from __future__ import annotations

from app.config import Settings
from app.models import AITransformRequest
from app.services.ai_service import AIService


async def collect_tokens(service: AIService, payload: AITransformRequest) -> str:
    chunks: list[str] = []
    async for token in service.stream_transform(payload):
        chunks.append(token)
    return "".join(chunks)


async def test_local_fallback_summary_without_api_keys(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        openai_api_key=None,
        openrouter_api_key=None,
    )
    service = AIService(settings)

    output = await collect_tokens(
        service,
        AITransformRequest(
            content="Heading\nDetail one\nDetail two",
            transform="summarize",
            provider="openai",
        ),
    )

    assert "Summary" in output
    assert "Heading" in output


async def test_local_fallback_action_items(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        openai_api_key=None,
        openrouter_api_key=None,
    )
    service = AIService(settings)

    output = await collect_tokens(
        service,
        AITransformRequest(
            content="TODO finalize specs\nShare update with design",
            transform="extract_action_items",
            provider="openai",
        ),
    )

    assert "- [ ]" in output

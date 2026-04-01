from __future__ import annotations

from app.config import Settings
from app.models import AITransformRequest, CopilotChatRequest, InterviewCoachRequest, InterviewTurn, InterviewTurnsRequest, NoteAIContext
from app.provider_status_store import ProviderStatusStore
from app.services.ai_service import AIService, _build_note_context_block


async def collect_tokens(service: AIService, payload: AITransformRequest) -> str:
    chunks: list[str] = []
    async for token in service.stream_transform(payload):
        chunks.append(token)
    return "".join(chunks)


def _build_service(settings: Settings) -> AIService:
    provider_store = ProviderStatusStore(settings.profile_path)
    return AIService(settings, provider_store)


async def test_local_fallback_summary_without_api_keys(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        openai_api_key=None,
        openrouter_api_key=None,
    )
    service = _build_service(settings)

    output = await collect_tokens(
        service,
        AITransformRequest(
            content="Heading\nDetail one\nDetail two",
            transform="summarize",
            provider="openai",
            note_context={
                "title": "Weekly meeting",
                "tags": ["meeting"],
                "note_kind": "transcript",
                "context_preset": "meeting",
            },
        ),
    )

    assert output.strip()
    assert "Heading" in output


def test_note_context_block_includes_source_hints():
    block = _build_note_context_block(
        NoteAIContext(
            title="Customer call",
            tags=["meeting"],
            note_kind="transcript",
            context_preset="meeting",
            context_text="Budget review",
            transcript_segments=[
                {"id": "1", "text": "I will send the deck.", "source_hint": "me"},
                {"id": "2", "text": "We need pricing by Friday.", "source_hint": "other_audio"},
            ],
        )
    )

    assert "Customer call" in block
    assert "Me" in block
    assert "Other audio" in block


async def test_local_fallback_action_items(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        openai_api_key=None,
        openrouter_api_key=None,
    )
    service = _build_service(settings)

    output = await collect_tokens(
        service,
        AITransformRequest(
            content="TODO finalize specs\nShare update with design",
            transform="extract_action_items",
            provider="openai",
        ),
    )

    assert "- [ ]" in output


async def test_interview_turns_dedup_on_same_transcript(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        openai_api_key=None,
        openrouter_api_key=None,
    )
    service = _build_service(settings)

    first = await service.extract_interview_turns(
        InterviewTurnsRequest(
            transcript="Interviewer: What is JavaScript? Interviewee: JavaScript is a programming language.",
            previous_turns=[],
            provider="openai",
        ),
    )
    second = await service.extract_interview_turns(
        InterviewTurnsRequest(
            transcript="Interviewer: What is JavaScript? Interviewee: JavaScript is a programming language.",
            previous_turns=first.turns,
            provider="openai",
        ),
    )

    assert len(first.turns) >= 1
    assert second.transcript_digest == first.transcript_digest
    assert len(second.turns) == len(first.turns)


async def test_interview_turns_append_new_question_once(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        openai_api_key=None,
        openrouter_api_key=None,
    )
    service = _build_service(settings)

    first = await service.extract_interview_turns(
        InterviewTurnsRequest(
            transcript=(
                "Interviewer: Tell me about Kafka. "
                "Interviewee: Kafka handles event streaming for distributed systems."
            ),
            previous_turns=[],
            provider="openai",
        ),
    )
    second = await service.extract_interview_turns(
        InterviewTurnsRequest(
            transcript=(
                "Interviewer: Tell me about Kafka. "
                "Interviewee: Kafka handles event streaming for distributed systems. "
                "Interviewer: How is Kafka different from SQS?"
            ),
            previous_turns=first.turns,
            provider="openai",
        ),
    )
    third = await service.extract_interview_turns(
        InterviewTurnsRequest(
            transcript=(
                "Interviewer: Tell me about Kafka. "
                "Interviewee: Kafka handles event streaming for distributed systems. "
                "Interviewer: How is Kafka different from SQS?"
            ),
            previous_turns=second.turns,
            provider="openai",
        ),
    )

    assert len(second.turns) > len(first.turns)
    assert len(third.turns) >= len(second.turns)
    latest_interviewer = next(
        (turn for turn in reversed(third.turns) if turn.role == "interviewer"),
        None,
    )
    assert latest_interviewer is not None
    assert "sqs" in latest_interviewer.text.lower()
    sqs_questions = [
        turn for turn in third.turns if turn.role == "interviewer" and "sqs" in turn.text.lower()
    ]
    assert len(sqs_questions) == 1


async def test_interview_coach_fallback_is_short_plain_text(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        openai_api_key=None,
        openrouter_api_key=None,
    )
    service = _build_service(settings)

    payload = InterviewCoachRequest(
        latest_interviewer_turn=InterviewTurn(
            id="interviewer-1",
            role="interviewer",
            text="What is JavaScript?",
        ),
        latest_interviewee_turn=InterviewTurn(
            id="interviewee-1",
            role="interviewee",
            text="It is a language.",
        ),
        brevity="short",
        provider="openai",
    )

    chunks: list[str] = []
    async for token in service.stream_interview_coach(payload):
        chunks.append(token)
    output = "".join(chunks).strip()

    assert output
    assert "###" not in output
    assert len([line for line in output.splitlines() if line.strip()]) <= 3


async def test_copilot_chat_fallback_uses_note_content(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        openai_api_key=None,
        openrouter_api_key=None,
    )
    service = _build_service(settings)

    payload = CopilotChatRequest(
        question="What did I commit to?",
        content="Me: I can send the revised deck tomorrow.\nOther audio: Please include pricing.",
        history=[],
        note_context={
            "title": "Customer meeting",
            "tags": ["meeting"],
            "note_kind": "transcript",
            "context_preset": "meeting",
        },
        provider="openai",
    )

    chunks: list[str] = []
    async for token in service.stream_copilot_chat(payload):
        chunks.append(token)
    output = "".join(chunks).strip()

    assert output
    assert "deck" in output.lower() or "relevant excerpt" in output.lower()

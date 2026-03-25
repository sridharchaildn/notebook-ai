from __future__ import annotations

from app.config import Settings
from app.models import AITransformRequest, InterviewCoachRequest, InterviewTurn, InterviewTurnsRequest
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

    assert output.strip()
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


async def test_interview_turns_dedup_on_same_transcript(tmp_path):
    settings = Settings(
        notes_dir=tmp_path / "notes",
        profile_path=tmp_path / "provider_status.json",
        openai_api_key=None,
        openrouter_api_key=None,
    )
    service = AIService(settings)

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
    service = AIService(settings)

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
    service = AIService(settings)

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

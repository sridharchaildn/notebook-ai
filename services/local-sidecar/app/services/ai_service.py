from __future__ import annotations

import asyncio
import hashlib
import json
import re
from collections.abc import AsyncIterator

import httpx

from ..config import Settings
from ..models import (
    AITransformRequest,
    CopilotChatRequest,
    InterviewAssistRequest,
    InterviewCoachRequest,
    InterviewTurn,
    InterviewTurnsRequest,
    InterviewTurnsResponse,
    NoteAIContext,
)
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

    async def stream_transform(
        self,
        payload: AITransformRequest,
        access_token: str | None = None,
    ) -> AsyncIterator[str]:
        provider = payload.provider or self.settings.default_provider
        system_prompt, user_prompt = _build_prompts(payload)

        adapter = await self._resolve_adapter(provider, access_token)
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

    async def extract_interview_turns(
        self,
        payload: InterviewTurnsRequest,
        access_token: str | None = None,
    ) -> InterviewTurnsResponse:
        transcript = payload.transcript.strip()
        digest = _transcript_digest(transcript)
        if not transcript:
            return InterviewTurnsResponse(
                turns=payload.previous_turns,
                latest_interviewer_turn_id=_latest_turn_id(payload.previous_turns, "interviewer"),
                transcript_digest=digest,
            )

        provider = payload.provider or self.settings.default_provider
        adapter = await self._resolve_adapter(provider, access_token)

        if adapter is None:
            parsed_turns = _heuristic_turns_from_transcript(transcript)
        else:
            system_prompt, user_prompt = _build_interview_turn_extraction_prompts(
                transcript,
                payload.previous_turns,
            )
            completion = await _collect_completion(
                adapter=adapter,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                model=payload.model,
            )
            parsed_turns = _parse_turns_completion(completion)
            if not parsed_turns:
                parsed_turns = _heuristic_turns_from_transcript(transcript)

        merged = _merge_turns(payload.previous_turns, parsed_turns)
        return InterviewTurnsResponse(
            turns=merged,
            latest_interviewer_turn_id=_latest_turn_id(merged, "interviewer"),
            transcript_digest=digest,
        )

    async def stream_interview_coach(
        self,
        payload: InterviewCoachRequest,
        access_token: str | None = None,
    ) -> AsyncIterator[str]:
        provider = payload.provider or self.settings.default_provider
        adapter = await self._resolve_adapter(provider, access_token)

        if adapter is None:
            async for token in _stream_local_coach_fallback(payload):
                yield token
            return

        system_prompt, user_prompt = _build_interview_coach_prompts(payload)
        async for token in adapter.stream_completion(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            model=payload.model,
        ):
            yield token

    async def stream_copilot_chat(
        self,
        payload: CopilotChatRequest,
        access_token: str | None = None,
    ) -> AsyncIterator[str]:
        provider = payload.provider or self.settings.default_provider
        adapter = await self._resolve_adapter(provider, access_token)

        if adapter is None:
            async for token in _stream_local_chat_fallback(payload):
                yield token
            return

        system_prompt, user_prompt = _build_copilot_chat_prompts(payload)
        async for token in adapter.stream_completion(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            model=payload.model,
        ):
            yield token

    async def stream_interview_assist(
        self,
        payload: InterviewAssistRequest,
        access_token: str | None = None,
    ) -> AsyncIterator[str]:
        """
        Deprecated compatibility path; new clients should use:
        1) POST /ai/interview/turns
        2) POST /ai/interview/coach/stream
        """
        turns_payload = InterviewTurnsRequest(
            transcript=payload.transcript,
            previous_turns=[],
            provider=payload.provider,
            model=payload.model,
        )
        turns_response = await self.extract_interview_turns(turns_payload, access_token=access_token)
        interviewer_turn = _latest_turn(turns_response.turns, "interviewer")
        if interviewer_turn is None:
            yield "Listening for the next interviewer question."
            return

        interviewee_turn = _latest_turn(turns_response.turns, "interviewee")
        coach_payload = InterviewCoachRequest(
            latest_interviewer_turn=interviewer_turn,
            latest_interviewee_turn=interviewee_turn,
            brevity="short",
            provider=payload.provider,
            model=payload.model,
        )
        async for token in self.stream_interview_coach(coach_payload, access_token=access_token):
            yield token

    async def _resolve_adapter(self, provider: str, access_token: str | None = None):
        if provider == "openrouter" and self._openrouter:
            return self._openrouter
        if provider == "openai" and self._openai:
            return self._openai

        cache_key = f"{provider}:{hash(access_token or '')}"
        if cache_key in self._adapter_cache:
            return self._adapter_cache[cache_key]

        resolved = await self._load_adapter_from_cloud(provider, access_token)
        self._adapter_cache[cache_key] = resolved
        return resolved

    async def _load_adapter_from_cloud(self, provider: str, access_token: str | None = None):
        if not access_token:
            return None
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.get(
                    f"{self.settings.cloud_api_url}/providers/credential",
                    params={"provider": provider},
                    headers={"Authorization": f"Bearer {access_token}"},
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


async def _collect_completion(
    *,
    adapter: OpenAIAdapter | OpenRouterAdapter,
    system_prompt: str,
    user_prompt: str,
    model: str | None,
) -> str:
    chunks: list[str] = []
    async for token in adapter.stream_completion(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        model=model,
    ):
        chunks.append(token)
    return "".join(chunks).strip()


def _build_prompts(payload: AITransformRequest) -> tuple[str, str]:
    context_block = _build_note_context_block(payload.note_context)
    if payload.transform == "summarize":
        system = (
            "You are a precise note assistant. Produce concise, high-signal summaries "
            "with clear bullet points and no fluff. When source hints are available, "
            "preserve who said what."
        )
        user = (
            "Summarize this note in 5-8 bullets.\n\n"
            f"{context_block}"
            f"Note content:\n{payload.content}"
        )
        return system, user

    if payload.transform == "rewrite":
        system = (
            "You rewrite notes to improve clarity while preserving meaning. "
            "Keep structure readable and avoid adding unsupported details. "
            "Do not erase source attribution when the note provides it."
        )
        user = (
            f"Rewrite this note in a {payload.tone} tone. "
            "Keep all key facts and improve clarity:\n\n"
            f"{context_block}"
            f"Note content:\n{payload.content}"
        )
        return system, user

    system = (
        "Extract actionable tasks from notes. Return concise markdown checkboxes with "
        "specific outcomes. For meetings, distinguish my commitments from other participants "
        "when source hints are available."
    )
    user = (
        "Extract action items from this note:\n\n"
        f"{context_block}"
        f"Note content:\n{payload.content}"
    )
    return system, user


def _build_interview_turn_extraction_prompts(
    transcript: str,
    previous_turns: list[InterviewTurn],
) -> tuple[str, str]:
    prior_context = json.dumps(
        [{"role": turn.role, "text": turn.text} for turn in previous_turns[-10:]],
        ensure_ascii=False,
    )
    system = (
        "You are a transcript turn extractor for interview conversations.\n"
        "Output ONLY strict JSON array (no markdown, no explanation).\n"
        "Each item must be {\"role\":\"interviewer|interviewee\",\"text\":\"...\"}.\n"
        "Keep turns concise and in chronological order.\n"
        "Focus on the most recent turns from the transcript.\n"
        "Avoid filler-only utterances unless they clearly change intent.\n"
        "Do not fabricate content."
    )
    user = (
        "Conversation transcript:\n"
        f"{transcript}\n\n"
        "Recent already-known turns:\n"
        f"{prior_context}\n\n"
        "Return latest turns as JSON array."
    )
    return system, user


def _build_interview_coach_prompts(payload: InterviewCoachRequest) -> tuple[str, str]:
    one_liner = payload.brevity == "one_liner"
    length_rule = (
        "Return exactly one sentence under 120 characters."
        if one_liner
        else "Return 2-3 short lines under 260 characters total."
    )
    system = (
        "You are a live interview coach. Give immediately speakable first-person candidate answers.\n"
        "No markdown. No headings. No bullets. No analysis text.\n"
        f"{length_rule}\n"
        "Be direct and natural."
    )
    interviewee_context = payload.latest_interviewee_turn.text if payload.latest_interviewee_turn else ""
    user = (
        "Interviewer asked:\n"
        f"{payload.latest_interviewer_turn.text}\n\n"
        "Candidate most recent answer (if any):\n"
        f"{interviewee_context}\n\n"
        "Provide the next best answer now."
    )
    return system, user


def _build_copilot_chat_prompts(payload: CopilotChatRequest) -> tuple[str, str]:
    context_block = _build_note_context_block(payload.note_context)
    history_lines = [
        f"{message.role.title()}: {message.content.strip()}"
        for message in payload.history[-6:]
        if message.content.strip()
    ]
    history_block = "\n".join(history_lines).strip()
    recent_chat_block = f"Recent chat:\n{history_block}\n\n" if history_block else ""
    system = (
        "You are Notebook AI Copilot.\n"
        "Answer using only the transcript/note content and metadata provided.\n"
        "Return plain text only. Be concise, accurate, and directly useful.\n"
        "If the answer is not supported by the note, say that clearly.\n"
        "When source hints are present, distinguish what the user said from the other audio."
    )
    user = (
        f"{context_block}"
        f"Transcript or note content:\n{payload.content.strip()}\n\n"
        f"{recent_chat_block}"
        f"Question:\n{payload.question.strip()}"
    )
    return system, user


def _build_note_context_block(note_context: NoteAIContext | None) -> str:
    if note_context is None:
        return ""

    parts: list[str] = []
    if note_context.title.strip():
        parts.append(f"Title: {note_context.title.strip()}")
    if note_context.note_kind:
        parts.append(f"Note type: {note_context.note_kind}")
    if note_context.tags:
        parts.append(f"Tags: {', '.join(tag for tag in note_context.tags if tag.strip())}")
    if note_context.context_preset:
        parts.append(f"Context preset: {note_context.context_preset}")
    if note_context.context_text and note_context.context_text.strip():
        parts.append(f"User context: {note_context.context_text.strip()}")
    if note_context.transcript_segments:
        parts.append("Source-aware transcript segments:")
        for segment in note_context.transcript_segments[:24]:
            text = segment.text.strip()
            if not text:
                continue
            parts.append(f"- {_source_hint_label(segment.source_hint)}: {text}")

    if not parts:
        return ""

    return "Note metadata:\n" + "\n".join(parts) + "\n\n"


def _source_hint_label(source_hint: str | None) -> str:
    if source_hint == "me":
        return "Me"
    if source_hint == "other_audio":
        return "Other audio"
    return "Unknown source"


def _parse_turns_completion(raw: str) -> list[InterviewTurn]:
    raw = raw.strip()
    if not raw:
        return []

    start = raw.find("[")
    end = raw.rfind("]")
    if start < 0 or end <= start:
        return []

    payload = raw[start : end + 1]
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError:
        return []

    if not isinstance(parsed, list):
        return []

    turns: list[InterviewTurn] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        text = _clean_turn_text(str(item.get("text") or ""))
        if not text:
            continue
        if role not in {"interviewer", "interviewee"}:
            role = "interviewer" if text.endswith("?") else "interviewee"
        turns.append(InterviewTurn(id="", role=role, text=text))
    return turns


def _heuristic_turns_from_transcript(transcript: str) -> list[InterviewTurn]:
    raw_segments = [
        segment.strip()
        for line in transcript.splitlines()
        for segment in re.split(r"(?<=[.?!])\s+", line)
        if segment.strip()
    ]
    turns: list[InterviewTurn] = []
    last_role = "interviewee"
    for segment in raw_segments:
        lowered = segment.lower()
        role = (
            "interviewer"
            if _looks_like_question(segment)
            else ("interviewee" if last_role == "interviewer" else "interviewer")
        )
        if lowered.startswith("interviewer:"):
            role = "interviewer"
            segment = segment.split(":", 1)[1].strip()
        elif lowered.startswith("interviewee:") or lowered.startswith("candidate:"):
            role = "interviewee"
            segment = segment.split(":", 1)[1].strip()
        segment = _clean_turn_text(segment)
        if not segment:
            continue
        last_role = role
        turns.append(InterviewTurn(id="", role=role, text=segment))
    return turns[-24:]


def _merge_turns(previous: list[InterviewTurn], new_turns: list[InterviewTurn]) -> list[InterviewTurn]:
    normalized_previous = _normalize_turns(previous)
    normalized_new = _normalize_turns(new_turns)
    if not normalized_new:
        return normalized_previous[-40:]

    if not normalized_previous:
        return _append_turns([], normalized_new)[-40:]

    previous_keys = [_turn_key(turn) for turn in normalized_previous]
    new_keys = [_turn_key(turn) for turn in normalized_new]
    overlap = _longest_suffix_prefix_overlap(previous_keys, new_keys)

    if overlap == 0:
        recent_previous = set(previous_keys[-24:])
        if new_keys and all(key in recent_previous for key in new_keys):
            return normalized_previous[-40:]

    merged = _append_turns(normalized_previous, normalized_new[overlap:])
    return merged[-40:]


def _latest_turn_id(turns: list[InterviewTurn], role: str) -> str | None:
    for turn in reversed(turns):
        if turn.role == role:
            return turn.id
    return None


def _latest_turn(turns: list[InterviewTurn], role: str) -> InterviewTurn | None:
    for turn in reversed(turns):
        if turn.role == role:
            return turn
    return None


def _transcript_digest(transcript: str) -> str:
    normalized = re.sub(r"\s+", " ", transcript.strip().lower())
    return hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:20]


def _looks_like_question(segment: str) -> bool:
    lowered = segment.strip().lower()
    if not lowered:
        return False
    if "?" in lowered:
        return True
    interviewer_cues = (
        "can you",
        "could you",
        "would you",
        "tell me",
        "walk me through",
        "why",
        "how",
        "what",
        "when",
        "where",
        "which",
    )
    return lowered.startswith(interviewer_cues)


def _clean_turn_text(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", text.strip())
    return cleaned[:320]


def _normalize_turns(turns: list[InterviewTurn]) -> list[InterviewTurn]:
    normalized: list[InterviewTurn] = []
    for turn in turns:
        text = _clean_turn_text(turn.text)
        if not text:
            continue
        role = turn.role if turn.role in {"interviewer", "interviewee"} else "interviewee"
        normalized.append(
            InterviewTurn(
                id=turn.id or "",
                role=role,
                text=text,
            )
        )
    return normalized


def _turn_key(turn: InterviewTurn) -> str:
    normalized = re.sub(r"\s+", " ", turn.text.strip().lower())
    return f"{turn.role}:{normalized}"


def _longest_suffix_prefix_overlap(previous_keys: list[str], new_keys: list[str]) -> int:
    max_size = min(len(previous_keys), len(new_keys), 16)
    for size in range(max_size, 0, -1):
        if previous_keys[-size:] == new_keys[:size]:
            return size
    return 0


def _append_turns(base: list[InterviewTurn], additions: list[InterviewTurn]) -> list[InterviewTurn]:
    merged = list(base)
    for turn in additions:
        if not turn.text.strip():
            continue
        if merged and _turn_key(merged[-1]) == _turn_key(turn):
            continue
        merged.append(
            InterviewTurn(
                id=_stable_turn_sequence_id(len(merged) + 1, turn.role, turn.text),
                role=turn.role,
                text=turn.text,
            )
        )
    return merged


def _stable_turn_sequence_id(index: int, role: str, text: str) -> str:
    normalized = re.sub(r"\s+", " ", text.strip().lower())
    digest = hashlib.sha1(f"{role}:{normalized}".encode("utf-8")).hexdigest()[:8]
    return f"turn-{index:04d}-{digest}"


async def _stream_local_fallback(payload: AITransformRequest) -> AsyncIterator[str]:
    transformed = _deterministic_transform(payload)
    for piece in re.findall(r"\S+\s*", transformed):
        yield piece
        await asyncio.sleep(0)


async def _stream_local_coach_fallback(payload: InterviewCoachRequest) -> AsyncIterator[str]:
    transformed = _deterministic_coach_fallback(payload)
    for piece in re.findall(r"\S+\s*", transformed):
        yield piece
        await asyncio.sleep(0)


async def _stream_local_chat_fallback(payload: CopilotChatRequest) -> AsyncIterator[str]:
    transformed = _deterministic_chat_fallback(payload)
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


def _deterministic_coach_fallback(payload: InterviewCoachRequest) -> str:
    question = payload.latest_interviewer_turn.text.strip()
    prior = payload.latest_interviewee_turn.text.strip() if payload.latest_interviewee_turn else ""
    if payload.brevity == "one_liner":
        return (
            f"I'd define it clearly first, then add one concrete example related to '{question[:42]}'."
        )
    if prior:
        return (
            f"I'd answer '{question[:80]}' directly first.\n"
            "Then add one concrete example from my experience.\n"
            "End with measurable impact."
        )
    return (
        f"I'd start with a clear definition for '{question[:80]}'.\n"
        "Then share one concrete example from my work.\n"
        "Close with the business impact."
    )


def _deterministic_chat_fallback(payload: CopilotChatRequest) -> str:
    question = payload.question.strip()
    lowered_question = question.lower()
    haystacks: list[str] = [payload.content]
    if payload.note_context is not None:
        haystacks.append(payload.note_context.context_text or "")
        haystacks.extend(segment.text for segment in payload.note_context.transcript_segments)

    combined = "\n".join(part for part in haystacks if part.strip())
    if any(
        phrase in lowered_question
        for phrase in (
            "what did i commit",
            "what did i say",
            "what did i promise",
            "my action item",
            "my commitment",
        )
    ):
        my_lines: list[str] = []
        if payload.note_context is not None:
            my_lines.extend(
                segment.text.strip()
                for segment in payload.note_context.transcript_segments
                if segment.source_hint == "me" and segment.text.strip()
            )
        if not my_lines:
            my_lines.extend(
                line.split(":", 1)[1].strip()
                for line in payload.content.splitlines()
                if ":" in line
                and line.split(":", 1)[0].strip().lower() in {"me", "user", "candidate"}
                and line.split(":", 1)[1].strip()
            )
        if my_lines:
            return f"Based on this note, you said: {' '.join(my_lines[:3])}"

    tokens = [token for token in re.findall(r"[a-z0-9]{4,}", question.lower())][:6]
    matching_lines = [
        line.strip()
        for line in combined.splitlines()
        if line.strip() and (not tokens or any(token in line.lower() for token in tokens))
    ]
    if matching_lines:
        excerpt = " ".join(matching_lines[:3])
        return f"Based on this note, the closest relevant excerpt is: {excerpt}"

    if payload.note_context and payload.note_context.context_preset:
        return (
            f"I couldn't find a direct answer in this {payload.note_context.context_preset} note. "
            "Ask about something stated in the transcript or summary."
        )

    return "I couldn't find a direct answer in this note. Ask about something stated in the transcript or note."

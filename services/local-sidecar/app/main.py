from __future__ import annotations

import json
from collections.abc import AsyncIterator

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .config import Settings
from .logging_setup import configure_sidecar_logging
from .models import (
    AITransformRequest,
    HealthResponse,
    NoteCreateRequest,
    NoteDocument,
    NoteUpdateRequest,
    ProviderConnection,
    ProviderStatusUpdateRequest,
    TranscriptionChunkResponse,
)
from .notes_store import NoteStore
from .provider_status_store import ProviderStatusStore
from .services.ai_service import AIService
from .services.transcription_service import TranscriptionService


def create_app(settings: Settings | None = None) -> FastAPI:
    current_settings = settings or Settings()
    log = configure_sidecar_logging(current_settings.debug)
    log.info("Local sidecar starting (debug=%s)", current_settings.debug)

    note_store = NoteStore(current_settings.notes_dir)
    provider_status_store = ProviderStatusStore(current_settings.profile_path)
    ai_service = AIService(current_settings)
    transcription_service = TranscriptionService(current_settings)

    app = FastAPI(title="Notebook AI Local Sidecar", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(status="ok")

    @app.get("/notes", response_model=list[NoteDocument])
    async def list_notes(query: str = "") -> list[NoteDocument]:
        return note_store.list_notes(query=query)

    @app.post("/notes", response_model=NoteDocument, status_code=status.HTTP_201_CREATED)
    async def create_note(payload: NoteCreateRequest) -> NoteDocument:
        return note_store.create_note(payload)

    @app.put("/notes/{note_id}", response_model=NoteDocument)
    async def update_note(note_id: str, payload: NoteUpdateRequest) -> NoteDocument:
        try:
            return note_store.update_note(note_id=note_id, payload=payload)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/ai/transform/stream")
    async def stream_transform(payload: AITransformRequest) -> StreamingResponse:
        async def stream() -> AsyncIterator[str]:
            try:
                async for token in ai_service.stream_transform(payload):
                    yield _sse_event("token", token)
                yield _sse_event("complete", "done")
            except Exception as exc:  # pragma: no cover - defensive path
                yield _sse_event("error", str(exc))

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )

    @app.post("/transcription/chunk", response_model=TranscriptionChunkResponse)
    async def transcribe_chunk(
        file: UploadFile = File(...),
        provider: str = Form(default="openai"),
        transcription_mode: str = Form(default="whisper"),
    ) -> TranscriptionChunkResponse:
        audio_bytes = await file.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Audio chunk is empty")

        mode = transcription_mode if transcription_mode in {"whisper", "llm"} else "whisper"

        log.info(
            "POST /transcription/chunk bytes=%s filename=%s provider=%s mode=%s",
            len(audio_bytes),
            file.filename,
            provider,
            mode,
        )

        result = await transcription_service.transcribe_chunk(
            audio_bytes=audio_bytes,
            filename=file.filename or "chunk.webm",
            content_type=file.content_type or "audio/webm",
            provider=provider,
            transcription_mode=mode,
        )

        d = result.detail
        detail_preview = (d[:80] + "…") if d and len(d) > 80 else d
        log.debug(
            "POST /transcription/chunk done text_len=%s detail=%s",
            len(result.text),
            detail_preview,
        )

        out_provider = result.provider if result.provider in {"openai", "openrouter"} else "openai"
        return TranscriptionChunkResponse(
            text=result.text,
            provider=out_provider,
            model=result.model,
            detail=result.detail,
        )

    @app.get("/providers/status", response_model=list[ProviderConnection])
    async def provider_status() -> list[ProviderConnection]:
        return provider_status_store.get_statuses(
            openai_key=current_settings.openai_api_key,
            openrouter_key=current_settings.openrouter_api_key,
        )

    @app.post("/providers/status/cache", response_model=list[ProviderConnection])
    async def cache_provider_status(payload: ProviderStatusUpdateRequest) -> list[ProviderConnection]:
        provider_status_store.cache_status(
            provider=payload.provider,
            via=payload.via,
            connected=payload.connected,
        )
        return provider_status_store.get_statuses(
            openai_key=current_settings.openai_api_key,
            openrouter_key=current_settings.openrouter_api_key,
        )

    return app


app = create_app()


def _sse_event(event: str, data: str) -> str:
    payload = json.dumps({"event": event, "data": data})
    return f"data: {payload}\n\n"

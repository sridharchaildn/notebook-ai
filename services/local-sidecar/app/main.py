from __future__ import annotations

import json
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .config import Settings
from .logging_setup import configure_sidecar_logging
from .models import (
    AITransformRequest,
    FolderCreateRequest,
    FolderNode,
    FolderUpdateRequest,
    HealthResponse,
    InterviewAssistRequest,
    InterviewCoachRequest,
    InterviewTurnsRequest,
    InterviewTurnsResponse,
    LocalRootResponse,
    LocalRootUpdateRequest,
    MoveNoteRequest,
    NoteCreateRequest,
    NoteDocument,
    NoteUpdateRequest,
    ProviderConnection,
    ProviderStatusUpdateRequest,
    StoragePreference,
    StoragePreferenceUpdateRequest,
    SyncStatus,
    TranscriptionChunkResponse,
)
from .notes_store import NoteStore
from .provider_status_store import ProviderStatusStore
from .services.drive_sync_service import DriveSyncService
from .storage_profile_store import StorageProfileStore
from .services.ai_service import AIService
from .services.transcription_service import TranscriptionService


def create_app(
    settings: Settings | None = None,
    *,
    sync_transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    current_settings = settings or Settings()
    log = configure_sidecar_logging(current_settings.debug)
    log.info("Local sidecar starting (debug=%s)", current_settings.debug)

    note_store = NoteStore(current_settings.notes_dir)
    provider_status_store = ProviderStatusStore(current_settings.profile_path)
    storage_store = StorageProfileStore(
        current_settings.storage_profile_path,
        current_settings.sync_profile_path,
    )
    startup_pref = storage_store.get_preference(note_store.get_local_root())
    if startup_pref.local_root:
        note_store.set_notes_dir(Path(startup_pref.local_root))
    storage_store.set_sync_enabled(startup_pref.mode == "local_and_drive")
    ai_service = AIService(current_settings)
    transcription_service = TranscriptionService(current_settings)
    drive_sync_service = DriveSyncService(
        current_settings,
        note_store,
        storage_store,
        transport=sync_transport,
    )

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
    async def list_notes(query: str = "", authorization: str | None = Header(default=None)) -> list[NoteDocument]:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        return note_store.list_notes(query=query)

    @app.post("/notes", response_model=NoteDocument, status_code=status.HTTP_201_CREATED)
    async def create_note(
        payload: NoteCreateRequest,
        authorization: str | None = Header(default=None),
    ) -> NoteDocument:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        created = note_store.create_note(payload)
        drive_sync_service.request_sync()
        return created

    @app.put("/notes/{note_id}", response_model=NoteDocument)
    async def update_note(
        note_id: str,
        payload: NoteUpdateRequest,
        authorization: str | None = Header(default=None),
    ) -> NoteDocument:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        try:
            updated = note_store.update_note(note_id=note_id, payload=payload)
            drive_sync_service.request_sync()
            return updated
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.patch("/notes/{note_id}/move", response_model=NoteDocument)
    async def move_note(
        note_id: str,
        payload: MoveNoteRequest,
        authorization: str | None = Header(default=None),
    ) -> NoteDocument:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        try:
            moved = note_store.move_note(note_id=note_id, folder_id=payload.folder_id)
            drive_sync_service.request_sync()
            return moved
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.delete("/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_note(note_id: str, authorization: str | None = Header(default=None)) -> None:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        if not note_store.delete_note(note_id):
            raise HTTPException(status_code=404, detail=f"Note {note_id} not found")
        drive_sync_service.record_note_deletion(note_id)

    @app.get("/folders", response_model=list[FolderNode])
    async def list_folders(authorization: str | None = Header(default=None)) -> list[FolderNode]:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        return note_store.list_folders()

    @app.post("/folders", response_model=FolderNode, status_code=status.HTTP_201_CREATED)
    async def create_folder(
        payload: FolderCreateRequest,
        authorization: str | None = Header(default=None),
    ) -> FolderNode:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        try:
            folder = note_store.create_folder(payload.name)
            drive_sync_service.request_sync()
            return folder
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.patch("/folders/{folder_id}", response_model=FolderNode)
    async def update_folder(
        folder_id: str,
        payload: FolderUpdateRequest,
        authorization: str | None = Header(default=None),
    ) -> FolderNode:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        try:
            folder = note_store.update_folder(folder_id, payload.name)
            drive_sync_service.request_sync()
            return folder
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_folder(folder_id: str, authorization: str | None = Header(default=None)) -> None:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        if not note_store.delete_folder(folder_id):
            raise HTTPException(status_code=404, detail=f"Folder {folder_id} not found")
        drive_sync_service.record_folder_deletion(folder_id)
        drive_sync_service.request_full_resync()

    @app.get("/storage/local-root", response_model=LocalRootResponse)
    async def get_local_root(authorization: str | None = Header(default=None)) -> LocalRootResponse:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        return LocalRootResponse(local_root=note_store.get_local_root())

    @app.put("/storage/local-root", response_model=LocalRootResponse)
    async def set_local_root(
        payload: LocalRootUpdateRequest,
        authorization: str | None = Header(default=None),
    ) -> LocalRootResponse:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        note_store.set_notes_dir(Path(payload.local_root))
        pref = storage_store.get_preference(note_store.get_local_root())
        storage_store.set_preference(mode=pref.mode, local_root=note_store.get_local_root())
        if pref.mode == "local_and_drive":
            drive_sync_service.request_full_resync()
        return LocalRootResponse(local_root=note_store.get_local_root())

    @app.get("/storage/preference", response_model=StoragePreference)
    async def get_storage_preference(
        authorization: str | None = Header(default=None),
    ) -> StoragePreference:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        return storage_store.get_preference(note_store.get_local_root())

    @app.put("/storage/preference", response_model=StoragePreference)
    async def update_storage_preference(
        payload: StoragePreferenceUpdateRequest,
        authorization: str | None = Header(default=None),
    ) -> StoragePreference:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        if payload.local_root:
            note_store.set_notes_dir(Path(payload.local_root))
        enabled = payload.mode == "local_and_drive"
        storage_store.set_sync_enabled(enabled)
        if enabled:
            drive_sync_service.request_full_resync()
        return storage_store.set_preference(mode=payload.mode, local_root=note_store.get_local_root())

    @app.get("/sync/status", response_model=SyncStatus)
    async def get_sync_status(authorization: str | None = Header(default=None)) -> SyncStatus:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        return drive_sync_service.get_status()

    @app.post("/sync/run", response_model=SyncStatus)
    async def run_sync(authorization: str | None = Header(default=None)) -> SyncStatus:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        return await drive_sync_service.run_sync_now()

    @app.post("/ai/transform/stream")
    async def stream_transform(
        payload: AITransformRequest,
        authorization: str | None = Header(default=None),
    ) -> StreamingResponse:
        async def stream() -> AsyncIterator[str]:
            try:
                async for token in ai_service.stream_transform(
                    payload,
                    access_token=_bearer_token_from_header(authorization),
                ):
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

    @app.post("/ai/interview/turns", response_model=InterviewTurnsResponse)
    async def interview_turns(
        payload: InterviewTurnsRequest,
        authorization: str | None = Header(default=None),
    ) -> InterviewTurnsResponse:
        return await ai_service.extract_interview_turns(
            payload,
            access_token=_bearer_token_from_header(authorization),
        )

    @app.post("/ai/interview/coach/stream")
    async def stream_interview_coach(
        payload: InterviewCoachRequest,
        authorization: str | None = Header(default=None),
    ) -> StreamingResponse:
        async def stream() -> AsyncIterator[str]:
            try:
                async for token in ai_service.stream_interview_coach(
                    payload,
                    access_token=_bearer_token_from_header(authorization),
                ):
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

    # Deprecated: retained for compatibility while desktop migrates to /ai/interview/turns + /ai/interview/coach/stream.
    @app.post("/ai/interview/stream")
    async def stream_interview_assist(
        payload: InterviewAssistRequest,
        authorization: str | None = Header(default=None),
    ) -> StreamingResponse:
        async def stream() -> AsyncIterator[str]:
            try:
                async for token in ai_service.stream_interview_assist(
                    payload,
                    access_token=_bearer_token_from_header(authorization),
                ):
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
        segment_id: int | None = Form(default=None),
        authorization: str | None = Header(default=None),
    ) -> TranscriptionChunkResponse:
        audio_bytes = await file.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Audio chunk is empty")

        mode = transcription_mode if transcription_mode in {"whisper", "llm"} else "whisper"

        log.info(
            "POST /transcription/chunk bytes=%s filename=%s provider=%s mode=%s segment_id=%s",
            len(audio_bytes),
            file.filename,
            provider,
            mode,
            segment_id,
        )

        result = await transcription_service.transcribe_chunk(
            audio_bytes=audio_bytes,
            filename=file.filename or "chunk.webm",
            content_type=file.content_type or "audio/webm",
            provider=provider,
            transcription_mode=mode,
            segment_id=segment_id,
            access_token=_bearer_token_from_header(authorization),
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
            ok=result.ok,
            error_code=result.error_code,
            recoverable=result.recoverable,
            segment_id=result.segment_id,
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


def _bearer_token_from_header(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    return token or None

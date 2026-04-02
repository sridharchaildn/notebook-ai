from __future__ import annotations

import json
import secrets
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from .config import Settings
from .local_settings_store import LocalSettingsStore
from .logging_setup import configure_sidecar_logging
from .models import (
    AITransformRequest,
    CaptureSessionChunkAck,
    CaptureSessionStartRequest,
    CaptureSessionStatus,
    CopilotChatRequest,
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
    MarkdownSettings,
    MarkdownSettingsUpdateRequest,
    MoveNoteRequest,
    NoteCreateRequest,
    NoteDocument,
    NoteUpdateRequest,
    ProviderByokRequest,
    ProviderConnection,
    ProviderDeleteResponse,
    ProviderModel,
    StoragePreference,
    StoragePreferenceUpdateRequest,
    SyncStatus,
    TranscriptionPreferences,
    TranscriptionPreferencesUpdateRequest,
    TranscriptionChunkResponse,
)
from .notes_store import NoteStore
from .provider_models import fetch_provider_models
from .provider_status_store import ProviderStatusStore
from .services.drive_sync_service import DriveSyncService
from .storage_profile_store import StorageProfileStore
from .sync_state_store import SyncStateStore
from .services.ai_service import AIService
from .services.capture_session_service import CaptureSessionService
from .services.transcription_service import TranscriptionService


def create_app(
    settings: Settings | None = None,
    *,
    sync_transport: httpx.AsyncBaseTransport | None = None,
    provider_transport: httpx.AsyncBaseTransport | None = None,
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
    sync_state_store = SyncStateStore(current_settings.sync_state_path)
    local_settings_store = LocalSettingsStore(current_settings.settings_profile_path)
    startup_pref = storage_store.get_preference(note_store.get_local_root())
    if startup_pref.local_root:
        note_store.set_notes_dir(Path(startup_pref.local_root))
    storage_store.set_sync_enabled(startup_pref.mode == "local_and_drive")
    ai_service = AIService(current_settings, provider_status_store)
    transcription_service = TranscriptionService(current_settings, provider_status_store)
    drive_sync_service = DriveSyncService(
        current_settings,
        note_store,
        storage_store,
        sync_state_store,
        transport=sync_transport,
    )
    capture_session_service = CaptureSessionService(
        Path(note_store.get_local_root()),
        transcription_service,
        local_settings_store.get_transcription_preferences,
        note_store=note_store,
        note_upsert_callback=drive_sync_service.request_note_upsert,
    )

    app = FastAPI(title="Notebook AI Local Sidecar", version=current_settings.app_version)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(current_settings.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Notebook-Desktop-Token"],
    )

    @app.middleware("http")
    async def secure_desktop_surface(request, call_next):
        if request.method != "OPTIONS" and request.url.path != "/health":
            provided_token = request.headers.get("X-Notebook-Desktop-Token")
            if not provided_token or not secrets.compare_digest(
                provided_token,
                current_settings.desktop_token,
            ):
                return JSONResponse(status_code=401, content={"detail": "Missing or invalid desktop token"})

        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        return response

    @app.on_event("startup")
    async def recover_capture_sessions() -> None:
        await capture_session_service.recover_unfinished_sessions()

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            version=current_settings.app_version,
            build_version=current_settings.resolved_build_version,
        )

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
        drive_sync_service.request_note_upsert(created.frontmatter.id)
        return created

    @app.put("/notes/{note_id}", response_model=NoteDocument)
    async def update_note(
        note_id: str,
        payload: NoteUpdateRequest,
        authorization: str | None = Header(default=None),
    ) -> NoteDocument:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        try:
            updated, changed = note_store.update_note_with_change_flag(note_id=note_id, payload=payload)
            if changed:
                drive_sync_service.request_note_upsert(updated.frontmatter.id)
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
            moved, changed = note_store.move_note_with_change_flag(note_id=note_id, folder_id=payload.folder_id)
            if changed:
                drive_sync_service.request_note_upsert(moved.frontmatter.id)
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
            drive_sync_service.request_folder_sync()
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
            folder, changed = note_store.update_folder_with_change_flag(folder_id, payload.name)
            if changed:
                drive_sync_service.request_folder_sync()
            return folder
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_folder(folder_id: str, authorization: str | None = Header(default=None)) -> None:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        moved_note_ids = note_store.delete_folder(folder_id)
        if moved_note_ids is None:
            raise HTTPException(status_code=404, detail=f"Folder {folder_id} not found")
        drive_sync_service.record_folder_deletion(folder_id, moved_note_ids)

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
        current_root = note_store.get_local_root()
        next_root = str(Path(payload.local_root).expanduser().resolve())
        if current_root == next_root:
            return LocalRootResponse(local_root=current_root)
        note_store.set_notes_dir(Path(payload.local_root))
        capture_session_service.set_base_dir(Path(note_store.get_local_root()))
        pref = storage_store.get_preference(note_store.get_local_root())
        storage_store.set_preference(mode=pref.mode, local_root=note_store.get_local_root())
        if pref.mode == "local_and_drive":
            drive_sync_service.request_full_resync("Local root changed.")
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
        current_pref = storage_store.get_preference(note_store.get_local_root())
        local_root_changed = False
        if payload.local_root:
            requested_root = str(Path(payload.local_root).expanduser().resolve())
            if note_store.get_local_root() != requested_root:
                note_store.set_notes_dir(Path(payload.local_root))
                capture_session_service.set_base_dir(Path(note_store.get_local_root()))
                local_root_changed = True
        enabled = payload.mode == "local_and_drive"
        mode_changed = current_pref.mode != payload.mode
        storage_store.set_sync_enabled(enabled)
        if enabled and (mode_changed or local_root_changed):
            drive_sync_service.request_full_resync("Storage preference changed.")
        return storage_store.set_preference(mode=payload.mode, local_root=note_store.get_local_root())

    @app.get("/settings/transcription", response_model=TranscriptionPreferences)
    async def get_transcription_preferences(
        authorization: str | None = Header(default=None),
    ) -> TranscriptionPreferences:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        return local_settings_store.get_transcription_preferences()

    @app.put("/settings/transcription", response_model=TranscriptionPreferences)
    async def update_transcription_preferences(
        payload: TranscriptionPreferencesUpdateRequest,
        authorization: str | None = Header(default=None),
    ) -> TranscriptionPreferences:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        return local_settings_store.set_transcription_preferences(payload)

    @app.get("/settings/markdown", response_model=MarkdownSettings)
    async def get_markdown_settings(
        authorization: str | None = Header(default=None),
    ) -> MarkdownSettings:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        return local_settings_store.get_markdown_settings()

    @app.put("/settings/markdown", response_model=MarkdownSettings)
    async def update_markdown_settings(
        payload: MarkdownSettingsUpdateRequest,
        authorization: str | None = Header(default=None),
    ) -> MarkdownSettings:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        return local_settings_store.set_markdown_settings(payload)

    @app.get("/sync/status", response_model=SyncStatus)
    async def get_sync_status(authorization: str | None = Header(default=None)) -> SyncStatus:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        return drive_sync_service.get_status()

    @app.post("/sync/run", response_model=SyncStatus)
    async def run_sync(authorization: str | None = Header(default=None)) -> SyncStatus:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        drive_sync_service.request_full_resync("Manual sync requested.")
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

    @app.post("/ai/copilot/chat/stream")
    async def stream_copilot_chat(
        payload: CopilotChatRequest,
        authorization: str | None = Header(default=None),
    ) -> StreamingResponse:
        async def stream() -> AsyncIterator[str]:
            try:
                async for token in ai_service.stream_copilot_chat(
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
        model: str | None = Form(default=None),
        context_preset: str | None = Form(default=None),
        context_text: str | None = Form(default=None),
        source_hint: str | None = Form(default=None),
        authorization: str | None = Header(default=None),
    ) -> TranscriptionChunkResponse:
        audio_bytes = await file.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Audio chunk is empty")

        mode = transcription_mode if transcription_mode in {"whisper", "llm"} else "whisper"
        transcription_preferences = local_settings_store.get_transcription_preferences()

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
            model=model,
            context_preset=context_preset,
            context_text=context_text,
            source_hint=source_hint,
            main_language=transcription_preferences.main_language,
            spoken_languages=transcription_preferences.spoken_languages,
            custom_vocabulary=transcription_preferences.custom_vocabulary,
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

    @app.post("/capture-sessions/start", response_model=CaptureSessionStatus)
    async def start_capture_session(
        payload: CaptureSessionStartRequest,
        authorization: str | None = Header(default=None),
    ) -> CaptureSessionStatus:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        return await capture_session_service.start_session(payload)

    @app.post("/capture-sessions/{session_id}/chunks", response_model=CaptureSessionChunkAck)
    async def append_capture_session_chunk(
        session_id: str,
        file: UploadFile = File(...),
        chunk_index: int = Form(...),
        source_hint: str = Form(default="unknown"),
        started_at_ms: int | None = Form(default=None),
        duration_ms: int | None = Form(default=None),
        authorization: str | None = Header(default=None),
    ) -> CaptureSessionChunkAck:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        if source_hint not in {"me", "other_audio", "unknown"}:
            raise HTTPException(status_code=400, detail="Unsupported source_hint")
        audio_bytes = await file.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Audio chunk is empty")
        try:
            return await capture_session_service.append_chunk(
                session_id=session_id,
                chunk_index=chunk_index,
                source_hint=source_hint,
                audio_bytes=audio_bytes,
                filename=file.filename or f"{source_hint}-{chunk_index}.wav",
                content_type=file.content_type or "audio/wav",
                started_at_ms=started_at_ms,
                duration_ms=duration_ms,
                access_token=_bearer_token_from_header(authorization),
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/capture-sessions/{session_id}/finalize", response_model=CaptureSessionStatus)
    async def finalize_capture_session(
        session_id: str,
        authorization: str | None = Header(default=None),
    ) -> CaptureSessionStatus:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        try:
            return await capture_session_service.finalize_session(
                session_id,
                access_token=_bearer_token_from_header(authorization),
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/capture-sessions/{session_id}", response_model=CaptureSessionStatus)
    async def get_capture_session_status(
        session_id: str,
        authorization: str | None = Header(default=None),
    ) -> CaptureSessionStatus:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        try:
            return capture_session_service.get_status(session_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/capture-sessions/{session_id}/retry-recovery", response_model=CaptureSessionStatus)
    async def retry_capture_session_recovery(
        session_id: str,
        authorization: str | None = Header(default=None),
    ) -> CaptureSessionStatus:
        drive_sync_service.remember_desktop_session(_bearer_token_from_header(authorization))
        try:
            return await capture_session_service.retry_recovery(
                session_id,
                access_token=_bearer_token_from_header(authorization),
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/providers/status", response_model=list[ProviderConnection])
    async def provider_status() -> list[ProviderConnection]:
        return provider_status_store.get_statuses(
            openai_key=current_settings.openai_api_key,
            openrouter_key=current_settings.openrouter_api_key,
        )

    @app.post("/providers/byok", response_model=list[ProviderConnection])
    async def save_provider_byok(payload: ProviderByokRequest) -> list[ProviderConnection]:
        provider_status_store.save_api_key(payload.provider, payload.api_key.strip())
        return provider_status_store.get_statuses(
            openai_key=current_settings.openai_api_key,
            openrouter_key=current_settings.openrouter_api_key,
        )

    @app.get("/providers/models", response_model=list[ProviderModel])
    async def provider_models(provider: str, use_case: str = "copilot") -> list[ProviderModel]:
        if provider not in {"openai", "openrouter"}:
            raise HTTPException(status_code=404, detail="Unsupported provider")
        if use_case not in {"copilot", "transcription"}:
            raise HTTPException(status_code=400, detail="Unsupported use_case")

        api_key = provider_status_store.get_api_key(
            provider,
            current_settings.openai_api_key,
            current_settings.openrouter_api_key,
        )
        if not api_key:
            raise HTTPException(status_code=404, detail="Credential not found")

        return await fetch_provider_models(
            provider=provider,
            api_key=api_key,
            use_case=use_case,
            transport=provider_transport,
        )

    @app.delete("/providers/{provider}", response_model=ProviderDeleteResponse)
    async def delete_provider_connection(provider: str) -> ProviderDeleteResponse:
        if provider not in {"openai", "openrouter"}:
            raise HTTPException(status_code=404, detail="Unsupported provider")

        provider_status_store.delete_provider(provider)
        still_connected = bool(
            provider_status_store.get_api_key(
                provider,
                current_settings.openai_api_key,
                current_settings.openrouter_api_key,
            )
        )
        return ProviderDeleteResponse(provider=provider, connected=still_connected)

    @app.post("/providers/status/cache", response_model=list[ProviderConnection])
    async def cache_provider_status() -> list[ProviderConnection]:
        return provider_status_store.get_statuses(
            openai_key=current_settings.openai_api_key,
            openrouter_key=current_settings.openrouter_api_key,
        )

    return app


def _create_default_app() -> FastAPI:
    try:
        return create_app()
    except (OSError, PermissionError) as exc:
        fallback = FastAPI(title="Notebook AI Local Sidecar", version="0.1.0")

        @fallback.get("/health")
        async def health() -> JSONResponse:
            return JSONResponse(
                status_code=503,
                content={
                    "status": "misconfigured",
                    "service": "local-sidecar",
                    "detail": str(exc),
                },
            )

        return fallback


app = _create_default_app()


def _sse_event(event: str, data: str) -> str:
    payload = json.dumps({"event": event, "data": data})
    return f"data: {payload}\n\n"


def _bearer_token_from_header(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    return token or None

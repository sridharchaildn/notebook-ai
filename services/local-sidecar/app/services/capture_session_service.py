from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

from ..models import (
    CaptureSessionChunkAck,
    CaptureSessionStartRequest,
    CaptureSessionStatus,
    InterviewSessionData,
    NoteUpdateRequest,
    SourceHint,
    TranscriptSegment,
    TranscriptSessionData,
    TranscriptionPreferences,
)
from ..notes_store import NoteStore
from ..spec_loader import load_storage_model_spec
from .transcription_service import TranscriptionService

log = logging.getLogger("notebook.sidecar.capture")

STORAGE_MODEL_SPEC = load_storage_model_spec()
LOCAL_BUNDLE_LAYOUT = STORAGE_MODEL_SPEC.get("local_bundle_layout", {})
CAPTURE_SESSIONS_ROOT = str(LOCAL_BUNDLE_LAYOUT.get("capture_sessions_root") or "capture-sessions")
MANIFEST_FILENAME = "manifest.json"
CHUNKS_DIRNAME = "chunks"
MANIFEST_VERSION = 1
TRANSCRIBE_RETRY_DELAYS = (0.4, 1.0, 2.0)


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _iso_now() -> str:
    return _utcnow().isoformat()


def _json_default(value: object) -> str:
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    raise TypeError(f"Unsupported JSON value: {type(value)!r}")


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"{path.name}.tmp")
    with temp_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, default=_json_default)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp_path, path)
    _fsync_dir(path.parent)


def _write_bytes_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"{path.name}.tmp")
    with temp_path.open("wb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp_path, path)
    _fsync_dir(path.parent)


def _fsync_dir(path: Path) -> None:
    try:
        fd = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def _normalize_comparable_text(raw: str) -> str:
    lowered = raw.lower()
    cleaned = "".join(character if character.isalnum() or character.isspace() else " " for character in lowered)
    return " ".join(cleaned.split())


def _merge_transcript_text(previous: str, incoming: str) -> str:
    next_text = incoming.strip()
    if not next_text:
        return previous.strip()

    prior = previous.strip()
    if not prior:
        return next_text

    prior_words = [token for token in _normalize_comparable_text(prior).split(" ") if token]
    next_words = [token for token in _normalize_comparable_text(next_text).split(" ") if token]
    if not next_words:
        return prior
    if " ".join(next_words) in " ".join(prior_words):
        return prior

    max_overlap = min(len(prior_words), len(next_words), 80)
    overlap = 0
    for size in range(max_overlap, 5, -1):
        prior_tail = " ".join(prior_words[-size:])
        next_head = " ".join(next_words[:size])
        if prior_tail == next_head:
            overlap = size
            break

    if overlap == 0:
        recent_prior = " ".join(prior_words[-30:])
        recent_next = " ".join(next_words[-30:])
        if recent_prior and recent_prior == recent_next:
            return prior
        return f"{prior} {next_text}".strip()

    delta = " ".join(next_words[overlap:]).strip()
    if not delta:
        return prior
    return f"{prior} {delta}".strip()


class CaptureSessionService:
    def __init__(
        self,
        notes_dir: Path,
        transcription_service: TranscriptionService,
        preferences_loader: Callable[[], TranscriptionPreferences],
        note_store: NoteStore | None = None,
        note_upsert_callback: Callable[[str], None] | None = None,
    ):
        self.transcription_service = transcription_service
        self.preferences_loader = preferences_loader
        self.note_store = note_store
        self.note_upsert_callback = note_upsert_callback
        self._session_locks: dict[str, asyncio.Lock] = {}
        self.set_base_dir(notes_dir)

    def set_base_dir(self, notes_dir: Path) -> None:
        self.base_dir = notes_dir.expanduser().resolve()
        self.sessions_dir = self.base_dir / CAPTURE_SESSIONS_ROOT
        self.sessions_dir.mkdir(parents=True, exist_ok=True)

    async def start_session(self, payload: CaptureSessionStartRequest) -> CaptureSessionStatus:
        session_id = str(uuid4())
        session_dir = self._session_dir(session_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        (session_dir / CHUNKS_DIRNAME).mkdir(parents=True, exist_ok=True)

        now = _iso_now()
        manifest: dict[str, Any] = {
            "version": MANIFEST_VERSION,
            "session_id": session_id,
            "note_id": payload.note_id,
            "session_mode": payload.session_mode,
            "capture_mode": payload.capture_mode,
            "provider": payload.provider,
            "transcription_mode": payload.transcription_mode,
            "model": payload.model,
            "context_preset": payload.context_preset,
            "context_text": payload.context_text,
            "transcript_seed": (payload.initial_transcript or "").strip(),
            "state": "recording",
            "accepted_chunk_index": -1,
            "pending_retry_count": 0,
            "recoverable_error": False,
            "detail": None,
            "transcript": (payload.initial_transcript or "").strip(),
            "segments": [],
            "chunks": [],
            "started_at": now,
            "updated_at": now,
        }
        self._save_manifest(manifest)
        return self._status_from_manifest(manifest)

    async def append_chunk(
        self,
        *,
        session_id: str,
        chunk_index: int,
        source_hint: SourceHint,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
        started_at_ms: int | None = None,
        duration_ms: int | None = None,
        access_token: str | None = None,
    ) -> CaptureSessionChunkAck:
        async with self._session_lock(session_id):
            manifest = self._load_manifest(session_id)
            record = self._upsert_chunk_record(
                manifest,
                session_id=session_id,
                chunk_index=chunk_index,
                source_hint=source_hint,
                audio_bytes=audio_bytes,
                filename=filename,
                content_type=content_type,
                started_at_ms=started_at_ms,
                duration_ms=duration_ms,
            )

            if source_hint == "unknown" and record.get("transcript_text") is None:
                await self._transcribe_record(manifest, record, access_token=access_token)

            self._refresh_manifest_derived_fields(manifest)
            self._save_manifest(manifest)
            return self._chunk_ack_from_manifest(manifest, record)

    async def finalize_session(
        self,
        session_id: str,
        *,
        access_token: str | None = None,
    ) -> CaptureSessionStatus:
        async with self._session_lock(session_id):
            manifest = self._load_manifest(session_id)
            if manifest["state"] == "completed":
                return self._status_from_manifest(manifest)

            manifest["state"] = "stopping"
            manifest["updated_at"] = _iso_now()
            self._save_manifest(manifest)

            canonical_records = self._canonical_records(manifest)
            if not canonical_records:
                manifest["state"] = "failed"
                manifest["detail"] = "No audio captured."
                manifest["updated_at"] = _iso_now()
                self._save_manifest(manifest)
                return self._status_from_manifest(manifest)

            manifest["state"] = "finalizing"
            manifest["detail"] = "Transcribing captured audio..."
            manifest["updated_at"] = _iso_now()
            self._save_manifest(manifest)

            for record in canonical_records:
                if record.get("transcript_text") is not None and not record.get("recoverable_error", False):
                    continue
                await self._transcribe_record(manifest, record, access_token=access_token)

            segments = await self._build_source_segments(manifest, access_token=access_token)
            manifest["segments"] = [segment.model_dump() for segment in segments]
            self._refresh_manifest_derived_fields(manifest)

            has_nonrecoverable_canonical_failure = any(
                record.get("source_hint") == "unknown"
                and record.get("error_code") not in {None, "none"}
                and not record.get("recoverable_error", False)
                and not str(record.get("transcript_text") or "").strip()
                for record in manifest["chunks"]
            )
            has_recoverable_canonical_gap = any(
                record.get("source_hint") == "unknown"
                and record.get("recoverable_error", False)
                and not (record.get("transcript_text") or "").strip()
                for record in manifest["chunks"]
            )

            if has_nonrecoverable_canonical_failure:
                manifest["state"] = "failed"
                manifest["detail"] = manifest["detail"] or "Unable to transcribe one or more audio chunks."
            elif has_recoverable_canonical_gap:
                manifest["state"] = "retry_needed"
                manifest["detail"] = manifest["detail"] or "Retry needed for one or more audio chunks."
            elif not manifest["transcript"].strip():
                manifest["state"] = "failed"
                manifest["detail"] = manifest["detail"] or "No transcript text was produced for this recording."
            else:
                try:
                    self._persist_note_snapshot(manifest)
                except Exception as exc:
                    log.warning(
                        "Unable to persist capture session note session=%s note=%s: %s",
                        manifest["session_id"],
                        manifest.get("note_id"),
                        exc,
                    )
                    manifest["state"] = "retry_needed"
                    manifest["detail"] = "Transcript captured locally but could not be written to the note yet."
                else:
                    manifest["state"] = "completed"
                    manifest["detail"] = "Transcript ready."

            manifest["updated_at"] = _iso_now()
            self._save_manifest(manifest)
            if manifest["state"] == "completed":
                self._cleanup_audio_chunks(session_id)
            return self._status_from_manifest(manifest)

    async def retry_recovery(
        self,
        session_id: str,
        *,
        access_token: str | None = None,
    ) -> CaptureSessionStatus:
        return await self.finalize_session(session_id, access_token=access_token)

    async def recover_unfinished_sessions(self) -> None:
        if not self.sessions_dir.exists():
            return

        for manifest_path in sorted(self.sessions_dir.glob(f"*/{MANIFEST_FILENAME}")):
            session_id = manifest_path.parent.name
            try:
                manifest = self._load_manifest(session_id)
            except FileNotFoundError:
                continue

            if manifest["state"] in {"completed", "failed"}:
                continue

            try:
                log.info("Recovering unfinished capture session %s", session_id)
                await self.finalize_session(session_id)
            except Exception as exc:  # pragma: no cover - defensive path
                log.warning("Unable to recover capture session %s: %s", session_id, exc)

    def get_status(self, session_id: str) -> CaptureSessionStatus:
        return self._status_from_manifest(self._load_manifest(session_id))

    def _session_lock(self, session_id: str) -> asyncio.Lock:
        lock = self._session_locks.get(session_id)
        if lock is None:
            lock = asyncio.Lock()
            self._session_locks[session_id] = lock
        return lock

    def _session_dir(self, session_id: str) -> Path:
        return self.sessions_dir / session_id

    def _manifest_path(self, session_id: str) -> Path:
        return self._session_dir(session_id) / MANIFEST_FILENAME

    def _load_manifest(self, session_id: str) -> dict[str, Any]:
        manifest_path = self._manifest_path(session_id)
        if not manifest_path.exists():
            raise FileNotFoundError(f"Capture session {session_id} not found")
        return json.loads(manifest_path.read_text(encoding="utf-8"))

    def _save_manifest(self, manifest: dict[str, Any]) -> None:
        _write_json_atomic(self._manifest_path(str(manifest["session_id"])), manifest)

    def _chunk_path(self, session_id: str, chunk_index: int, source_hint: SourceHint, filename: str) -> Path:
        extension = Path(filename).suffix or ".wav"
        return self._session_dir(session_id) / CHUNKS_DIRNAME / f"{source_hint}-{chunk_index:06d}{extension}"

    def _upsert_chunk_record(
        self,
        manifest: dict[str, Any],
        *,
        session_id: str,
        chunk_index: int,
        source_hint: SourceHint,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
        started_at_ms: int | None,
        duration_ms: int | None,
    ) -> dict[str, Any]:
        existing = self._find_chunk_record(manifest, chunk_index=chunk_index, source_hint=source_hint)
        chunk_path = self._chunk_path(session_id, chunk_index, source_hint, filename)
        relative_chunk_path = str(chunk_path.relative_to(self._session_dir(session_id)))

        if existing is None:
            if not chunk_path.exists():
                _write_bytes_atomic(chunk_path, audio_bytes)
            record = {
                "chunk_index": chunk_index,
                "source_hint": source_hint,
                "filename": filename,
                "content_type": content_type,
                "file_path": relative_chunk_path,
                "size_bytes": len(audio_bytes),
                "started_at_ms": started_at_ms,
                "duration_ms": duration_ms,
                "transcript_text": None,
                "last_detail": None,
                "recoverable_error": False,
                "error_code": "none",
                "transcribed_at": None,
            }
            manifest["chunks"].append(record)
        else:
            record = existing
            if not chunk_path.exists():
                _write_bytes_atomic(chunk_path, audio_bytes)
            if started_at_ms is not None:
                record["started_at_ms"] = started_at_ms
            if duration_ms is not None:
                record["duration_ms"] = duration_ms
            record["size_bytes"] = record.get("size_bytes") or len(audio_bytes)
            record["file_path"] = record.get("file_path") or relative_chunk_path

        if source_hint == "unknown":
            manifest["accepted_chunk_index"] = max(int(manifest.get("accepted_chunk_index", -1)), chunk_index)
        manifest["updated_at"] = _iso_now()
        return record

    def _find_chunk_record(
        self,
        manifest: dict[str, Any],
        *,
        chunk_index: int,
        source_hint: SourceHint,
    ) -> dict[str, Any] | None:
        for record in manifest["chunks"]:
            if record.get("chunk_index") == chunk_index and record.get("source_hint") == source_hint:
                return record
        return None

    def _canonical_records(self, manifest: dict[str, Any]) -> list[dict[str, Any]]:
        return sorted(
            [record for record in manifest["chunks"] if record.get("source_hint") == "unknown"],
            key=lambda item: int(item.get("chunk_index", 0)),
        )

    def _source_records(self, manifest: dict[str, Any], source_hint: SourceHint) -> list[dict[str, Any]]:
        return sorted(
            [record for record in manifest["chunks"] if record.get("source_hint") == source_hint],
            key=lambda item: (
                int(item.get("started_at_ms") or 0),
                int(item.get("chunk_index", 0)),
            ),
        )

    async def _transcribe_record(
        self,
        manifest: dict[str, Any],
        record: dict[str, Any],
        *,
        access_token: str | None = None,
        strict: bool = True,
    ) -> None:
        file_path = self._session_dir(str(manifest["session_id"])) / str(record["file_path"])
        if not file_path.exists():
            record["recoverable_error"] = True
            record["error_code"] = "invalid_audio_format"
            record["last_detail"] = "Captured audio chunk is missing on disk."
            if strict:
                manifest["detail"] = record["last_detail"]
            return

        audio_bytes = file_path.read_bytes()
        preferences = self.preferences_loader()
        last_result = None
        retry_delays = (0.0, *TRANSCRIBE_RETRY_DELAYS)

        for attempt, delay in enumerate(retry_delays):
            if delay > 0:
                await asyncio.sleep(delay)
            content_type = str(record.get("content_type") or "audio/wav")
            filename = str(record.get("filename") or file_path.name)
            normalized_live_capture = content_type.startswith("audio/wav") or filename.lower().endswith(
                (".wav", ".mp3")
            )
            result = await self.transcription_service.transcribe_chunk(
                audio_bytes=audio_bytes,
                filename=filename,
                content_type=content_type,
                audio_origin="desktop_live_capture" if normalized_live_capture else "legacy_capture",
                provider=str(manifest["provider"]),
                transcription_mode=str(manifest["transcription_mode"]),
                segment_id=int(record["chunk_index"]),
                model=manifest.get("model"),
                context_preset=manifest.get("context_preset"),
                context_text=manifest.get("context_text"),
                source_hint=record.get("source_hint"),
                main_language=preferences.main_language,
                spoken_languages=preferences.spoken_languages,
                custom_vocabulary=preferences.custom_vocabulary,
                access_token=access_token,
            )
            last_result = result
            if result.ok or not result.recoverable:
                break
            log.info(
                "Retrying capture chunk transcription session=%s chunk=%s source=%s attempt=%s detail=%s",
                manifest["session_id"],
                record["chunk_index"],
                record["source_hint"],
                attempt + 1,
                result.detail,
            )

        if last_result is None:
            return

        record["transcript_text"] = last_result.text
        record["last_detail"] = last_result.detail
        record["recoverable_error"] = bool(last_result.recoverable and not last_result.ok)
        record["error_code"] = last_result.error_code
        record["transcribed_at"] = _iso_now()

        if not last_result.ok:
            if strict:
                manifest["detail"] = last_result.detail or "Unable to transcribe one or more chunks."
            if strict and not last_result.recoverable:
                manifest["state"] = "failed"
        elif record.get("source_hint") == "unknown":
            manifest["detail"] = None

    async def _build_source_segments(
        self,
        manifest: dict[str, Any],
        *,
        access_token: str | None = None,
    ) -> list[TranscriptSegment]:
        segments: list[TranscriptSegment] = []

        for source_hint in ("me", "other_audio"):
            for record in self._source_records(manifest, source_hint):
                if record.get("transcript_text") is None:
                    await self._transcribe_record(
                        manifest,
                        record,
                        access_token=access_token,
                        strict=False,
                    )
                text = str(record.get("transcript_text") or "").strip()
                if not text:
                    continue
                segments.append(
                    TranscriptSegment(
                        id=f"segment-{source_hint}-{record['chunk_index']}",
                        text=text,
                        source_hint=source_hint,
                        chunk_index=int(record["chunk_index"]),
                        started_at_ms=(
                            int(record["started_at_ms"])
                            if record.get("started_at_ms") is not None
                            else None
                        ),
                        duration_ms=(
                            int(record["duration_ms"])
                            if record.get("duration_ms") is not None
                            else None
                        ),
                    )
                )

        return sorted(
            segments,
            key=lambda item: (
                int(item.started_at_ms or 0),
                int(item.chunk_index or 0),
            ),
        )

    def _refresh_manifest_derived_fields(self, manifest: dict[str, Any]) -> None:
        transcript = str(manifest.get("transcript_seed") or "").strip()
        for record in self._canonical_records(manifest):
            transcript = _merge_transcript_text(transcript, str(record.get("transcript_text") or ""))
        manifest["transcript"] = transcript

        pending_retry_count = 0
        recoverable_error = False
        for record in manifest["chunks"]:
            if record.get("recoverable_error", False) and not str(record.get("transcript_text") or "").strip():
                pending_retry_count += 1
                recoverable_error = True
        manifest["pending_retry_count"] = pending_retry_count
        manifest["recoverable_error"] = recoverable_error
        if pending_retry_count == 0 and manifest.get("state") == "retry_needed":
            manifest["state"] = "completed" if transcript.strip() else "failed"

    def _persist_note_snapshot(self, manifest: dict[str, Any]) -> None:
        note_id = str(manifest.get("note_id") or "").strip()
        if not note_id or self.note_store is None:
            return

        existing = self.note_store.get_note(note_id)
        if existing is None:
            raise FileNotFoundError(f"Note {note_id} not found")

        segments = [TranscriptSegment.model_validate(item) for item in manifest.get("segments", [])]
        transcript = str(manifest.get("transcript") or "")
        session_mode = str(manifest.get("session_mode") or "notes")

        if session_mode == "interview_assist":
            existing_session = existing.session if isinstance(existing.session, InterviewSessionData) else None
            next_session = InterviewSessionData(
                transcript=transcript,
                guidance=existing_session.guidance if existing_session else "",
                turns=existing_session.turns if existing_session else [],
                summary=existing_session.summary if existing_session else None,
                last_coached_interviewer_turn_id=(
                    existing_session.last_coached_interviewer_turn_id if existing_session else None
                ),
                last_updated_at=_utcnow(),
            )
            next_kind = "interview_assist"
        else:
            existing_session = existing.session if isinstance(existing.session, TranscriptSessionData) else None
            next_session = TranscriptSessionData(
                transcript=transcript,
                segments=segments,
                summary=existing_session.summary if existing_session else None,
                last_updated_at=_utcnow(),
            )
            next_kind = "transcript"

        updated, changed = self.note_store.update_note_with_change_flag(
            note_id,
            NoteUpdateRequest(
                title=existing.frontmatter.title,
                content=transcript,
                tags=list(existing.frontmatter.tags),
                provider=existing.frontmatter.provider,
                model=existing.frontmatter.model,
                kind=next_kind,
                content_format=existing.content_format,
                context_preset=existing.frontmatter.context_preset,
                context_text=existing.frontmatter.context_text,
                session=next_session,
            ),
        )
        if changed and self.note_upsert_callback is not None:
            self.note_upsert_callback(updated.frontmatter.id)

    def _cleanup_audio_chunks(self, session_id: str) -> None:
        chunks_dir = self._session_dir(session_id) / CHUNKS_DIRNAME
        if not chunks_dir.exists():
            return
        for chunk_path in chunks_dir.iterdir():
            if chunk_path.is_file():
                chunk_path.unlink(missing_ok=True)
        try:
            chunks_dir.rmdir()
        except OSError:
            pass
        _fsync_dir(self._session_dir(session_id))

    def _status_from_manifest(self, manifest: dict[str, Any]) -> CaptureSessionStatus:
        started_at = datetime.fromisoformat(str(manifest["started_at"]))
        updated_at = datetime.fromisoformat(str(manifest["updated_at"]))
        segments = [TranscriptSegment.model_validate(item) for item in manifest.get("segments", [])]
        return CaptureSessionStatus(
            session_id=str(manifest["session_id"]),
            note_id=manifest.get("note_id"),
            session_mode=str(manifest["session_mode"]),
            capture_mode=str(manifest["capture_mode"]),
            provider=str(manifest["provider"]),
            transcription_mode=str(manifest["transcription_mode"]),
            model=manifest.get("model"),
            state=str(manifest["state"]),
            accepted_chunk_index=int(manifest.get("accepted_chunk_index", -1)),
            pending_retry_count=int(manifest.get("pending_retry_count", 0)),
            recoverable_error=bool(manifest.get("recoverable_error", False)),
            detail=manifest.get("detail"),
            transcript=str(manifest.get("transcript") or ""),
            segments=segments,
            started_at=started_at,
            updated_at=updated_at,
        )

    def _chunk_ack_from_manifest(
        self,
        manifest: dict[str, Any],
        record: dict[str, Any],
    ) -> CaptureSessionChunkAck:
        status = self._status_from_manifest(manifest)
        return CaptureSessionChunkAck(
            **status.model_dump(),
            source_hint=record.get("source_hint", "unknown"),
            accepted_chunk_started_at_ms=record.get("started_at_ms"),
            accepted_chunk_duration_ms=record.get("duration_ms"),
            last_chunk_text=record.get("transcript_text"),
        )

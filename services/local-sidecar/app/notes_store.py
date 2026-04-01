from __future__ import annotations

import json
import re
import shutil
from dataclasses import dataclass
from datetime import UTC, datetime, timezone
from pathlib import Path
from uuid import uuid4

import yaml
from pydantic import ValidationError

from .models import (
    FolderNode,
    InterviewSessionData,
    NoteCreateRequest,
    NoteDocument,
    NoteFrontmatter,
    NoteUpdateRequest,
    TranscriptSessionData,
)
from .spec_loader import load_storage_model_spec

FRONTMATTER_START = "---\n"
FRONTMATTER_END = "\n---\n"
LEGACY_FOLDERS_FILENAME = ".folders.json"
META_FILENAME = "_meta.json"
FOLDER_META_FILENAME = "_folder.json"
NOTE_BODY_FILENAME = "note.md"
TRANSCRIPT_BODY_FILENAME = "transcript.md"
SUMMARY_BODY_FILENAME = "summary.md"
GUIDANCE_BODY_FILENAME = "guidance.md"
UNFILED_DIRNAME = "unfiled"
FOLDERS_DIRNAME = "folders"
STORAGE_MODEL_SPEC = load_storage_model_spec()
LEGACY_NOTE_FILENAME_SUFFIX = str(STORAGE_MODEL_SPEC.get("default_note_extension") or ".note.json")


@dataclass(frozen=True)
class _FolderRecord:
    folder: FolderNode
    path: Path
    slug: str


class NoteStore:
    def __init__(self, notes_dir: Path):
        self.notes_dir: Path
        self._unfiled_dir: Path
        self._folders_dir: Path
        self._legacy_folders_path: Path
        self.set_notes_dir(notes_dir)

    def set_notes_dir(self, notes_dir: Path) -> None:
        self.notes_dir = notes_dir.expanduser().resolve()
        self.notes_dir.mkdir(parents=True, exist_ok=True)
        self._unfiled_dir = self.notes_dir / UNFILED_DIRNAME
        self._folders_dir = self.notes_dir / FOLDERS_DIRNAME
        self._legacy_folders_path = self.notes_dir / LEGACY_FOLDERS_FILENAME
        self._unfiled_dir.mkdir(parents=True, exist_ok=True)
        self._folders_dir.mkdir(parents=True, exist_ok=True)
        self._migrate_legacy_storage()

    def get_local_root(self) -> str:
        return str(self.notes_dir)

    def list_notes(self, query: str = "") -> list[NoteDocument]:
        notes: list[NoteDocument] = []
        normalized_query = query.strip().lower()
        folder_lookup = {folder.id: folder.name for folder in self.list_folders()}

        for bundle_dir in self._iter_note_bundle_dirs():
            note = self._load_note_bundle(bundle_dir)
            if not note:
                continue
            if normalized_query and normalized_query not in self._search_text_for(
                note,
                folder_lookup.get(note.frontmatter.folder_id or "", ""),
            ).lower():
                continue
            notes.append(note)

        return sorted(notes, key=lambda item: item.frontmatter.updated_at, reverse=True)

    def create_note(self, payload: NoteCreateRequest) -> NoteDocument:
        if payload.folder_id is not None and not self._folder_exists(payload.folder_id):
            raise FileNotFoundError(f"Folder {payload.folder_id} not found")

        now = datetime.now(timezone.utc)
        note_id = str(uuid4())
        frontmatter = NoteFrontmatter(
            id=note_id,
            title=payload.title.strip() or "Untitled note",
            created_at=now,
            updated_at=now,
            tags=payload.tags,
            provider=payload.provider,
            model=payload.model,
            folder_id=payload.folder_id,
            context_preset=payload.context_preset,
            context_text=payload.context_text,
        )
        document = self._normalize_document(
            NoteDocument(
                frontmatter=frontmatter,
                kind=payload.kind,
                content_format=payload.content_format,
                content=payload.content,
                session=payload.session,
            ),
        )
        self._save_note(document)
        return document

    def update_note(self, note_id: str, payload: NoteUpdateRequest) -> NoteDocument:
        existing = self._load_existing_note(note_id)
        if not existing:
            raise FileNotFoundError(f"Note {note_id} not found")

        fields = payload.model_fields_set
        next_kind = payload.kind if "kind" in fields else existing.kind
        next_content_format = (
            payload.content_format if "content_format" in fields else existing.content_format
        )
        next_content = (
            payload.content
            if "content" in fields or "body" in fields
            else existing.content
        )
        next_session = payload.session if "session" in fields else existing.session
        next_folder_id = (
            existing.frontmatter.folder_id if payload.folder_id is None else payload.folder_id
        )
        if next_folder_id is not None and not self._folder_exists(next_folder_id):
            raise FileNotFoundError(f"Folder {next_folder_id} not found")

        next_context_preset = (
            existing.frontmatter.context_preset
            if payload.context_preset is None
            else payload.context_preset
        )
        next_context_text = (
            existing.frontmatter.context_text
            if payload.context_text is None
            else payload.context_text
        )

        updated = self._normalize_document(
            NoteDocument(
                frontmatter=NoteFrontmatter(
                    id=existing.frontmatter.id,
                    title=payload.title.strip() or "Untitled note",
                    created_at=existing.frontmatter.created_at,
                    updated_at=datetime.now(timezone.utc),
                    tags=payload.tags,
                    provider=payload.provider,
                    model=payload.model,
                    folder_id=next_folder_id,
                    context_preset=next_context_preset,
                    context_text=next_context_text,
                ),
                kind=next_kind,
                content_format=next_content_format,
                content=next_content,
                session=next_session,
            ),
        )
        self._save_note(updated)
        return updated

    def move_note(self, note_id: str, folder_id: str | None) -> NoteDocument:
        existing = self._load_existing_note(note_id)
        if not existing:
            raise FileNotFoundError(f"Note {note_id} not found")

        if folder_id is not None and not self._folder_exists(folder_id):
            raise FileNotFoundError(f"Folder {folder_id} not found")

        updated = self._normalize_document(
            NoteDocument(
                frontmatter=NoteFrontmatter(
                    id=existing.frontmatter.id,
                    title=existing.frontmatter.title,
                    created_at=existing.frontmatter.created_at,
                    updated_at=datetime.now(timezone.utc),
                    tags=existing.frontmatter.tags,
                    provider=existing.frontmatter.provider,
                    model=existing.frontmatter.model,
                    folder_id=folder_id,
                    context_preset=existing.frontmatter.context_preset,
                    context_text=existing.frontmatter.context_text,
                ),
                kind=existing.kind,
                content_format=existing.content_format,
                content=existing.content,
                session=existing.session,
            ),
        )
        self._save_note(updated)
        return updated

    def delete_note(self, note_id: str) -> bool:
        removed = False
        bundle_dir = self._find_note_bundle(note_id)
        if bundle_dir and bundle_dir.exists():
            shutil.rmtree(bundle_dir)
            removed = True

        for legacy_path in (
            self.notes_dir / f"{note_id}{LEGACY_NOTE_FILENAME_SUFFIX}",
            self.notes_dir / f"{note_id}.md",
        ):
            if legacy_path.exists():
                legacy_path.unlink(missing_ok=True)
                removed = True

        return removed

    def list_folders(self) -> list[FolderNode]:
        folders = [record.folder for record in self._list_folder_records()]
        return sorted(folders, key=lambda folder: folder.name.lower())

    def create_folder(self, name: str) -> FolderNode:
        normalized = name.strip()
        if not normalized:
            raise ValueError("Folder name cannot be empty")

        now = _parse_datetime(_utcnow_iso())
        folder = FolderNode(
            id=str(uuid4()),
            name=normalized,
            created_at=now,
            updated_at=now,
        )
        self._upsert_folder(folder)
        return folder

    def update_folder(self, folder_id: str, name: str) -> FolderNode:
        normalized = name.strip()
        if not normalized:
            raise ValueError("Folder name cannot be empty")

        existing = self._find_folder_record(folder_id)
        if existing is None:
            raise FileNotFoundError(f"Folder {folder_id} not found")

        updated = FolderNode(
            id=existing.folder.id,
            name=normalized,
            created_at=existing.folder.created_at,
            updated_at=_parse_datetime(_utcnow_iso()),
        )
        self._upsert_folder(updated)
        return updated

    def delete_folder(self, folder_id: str) -> bool:
        existing = self._find_folder_record(folder_id)
        if existing is None:
            return False

        for child in sorted(existing.path.iterdir()):
            if child.name == FOLDER_META_FILENAME or not child.is_dir():
                continue
            note = self._load_note_bundle(child)
            if note is None:
                continue
            self.move_note(note.frontmatter.id, None)

        metadata_path = existing.path / FOLDER_META_FILENAME
        metadata_path.unlink(missing_ok=True)
        if existing.path.exists():
            shutil.rmtree(existing.path, ignore_errors=True)
        return True

    def save_note_document(self, document: NoteDocument) -> NoteDocument:
        normalized = self._normalize_document(document)
        self._save_note(normalized)
        return normalized

    def replace_folders(self, folders: list[FolderNode]) -> list[FolderNode]:
        incoming_ids = {folder.id for folder in folders}
        for current in self.list_folders():
            if current.id not in incoming_ids:
                self.delete_folder(current.id)
        for folder in folders:
            self._upsert_folder(folder)
        return self.list_folders()

    def serialize_note_document(self, document: NoteDocument) -> str:
        normalized = self._normalize_document(document)
        payload = {
            "version": 1,
            "frontmatter": {
                "id": normalized.frontmatter.id,
                "title": normalized.frontmatter.title,
                "created_at": normalized.frontmatter.created_at.isoformat(),
                "updated_at": normalized.frontmatter.updated_at.isoformat(),
                "tags": normalized.frontmatter.tags,
                "provider": normalized.frontmatter.provider,
                "model": normalized.frontmatter.model,
                "folder_id": normalized.frontmatter.folder_id,
                "context_preset": normalized.frontmatter.context_preset,
                "context_text": normalized.frontmatter.context_text,
            },
            "kind": normalized.kind,
            "content_format": normalized.content_format,
            "content": normalized.content,
            "session": (
                normalized.session.model_dump(mode="json")
                if normalized.session is not None
                else None
            ),
        }
        return json.dumps(payload, indent=2) + "\n"

    def serialize_folders(self, folders: list[FolderNode] | None = None) -> str:
        source = folders if folders is not None else self.list_folders()
        rows = [
            {
                "id": folder.id,
                "name": folder.name,
                "created_at": folder.created_at.isoformat(),
                "updated_at": folder.updated_at.isoformat(),
            }
            for folder in source
        ]
        return json.dumps(rows, indent=2) + "\n"

    def _folder_exists(self, folder_id: str) -> bool:
        return self._find_folder_record(folder_id) is not None

    def _iter_note_bundle_dirs(self) -> list[Path]:
        bundle_dirs: list[Path] = []

        if self._unfiled_dir.exists():
            for child in sorted(self._unfiled_dir.iterdir()):
                if child.is_dir():
                    bundle_dirs.append(child)

        if self._folders_dir.exists():
            for folder_dir in sorted(self._folders_dir.iterdir()):
                if not folder_dir.is_dir():
                    continue
                for child in sorted(folder_dir.iterdir()):
                    if child.name == FOLDER_META_FILENAME or not child.is_dir():
                        continue
                    bundle_dirs.append(child)

        return bundle_dirs

    def _find_note_bundle(self, note_id: str) -> Path | None:
        direct = self._unfiled_dir / note_id
        if direct.exists():
            return direct

        for folder_dir in self._folders_dir.iterdir() if self._folders_dir.exists() else []:
            candidate = folder_dir / note_id
            if candidate.exists():
                return candidate

        return None

    def _load_existing_note(self, note_id: str) -> NoteDocument | None:
        bundle_dir = self._find_note_bundle(note_id)
        if bundle_dir:
            return self._load_note_bundle(bundle_dir)

        json_path = self.notes_dir / f"{note_id}{LEGACY_NOTE_FILENAME_SUFFIX}"
        if json_path.exists():
            return self._load_structured_note(json_path)

        legacy_path = self.notes_dir / f"{note_id}.md"
        if legacy_path.exists():
            return self._load_legacy_markdown(legacy_path)

        return None

    def _save_note(self, note: NoteDocument) -> None:
        normalized = self._normalize_document(note)
        bundle_dir = self._resolve_bundle_dir(
            normalized.frontmatter.id,
            normalized.frontmatter.folder_id,
        )
        bundle_dir.mkdir(parents=True, exist_ok=True)

        meta_payload = {
            "version": 2,
            "frontmatter": {
                "id": normalized.frontmatter.id,
                "title": normalized.frontmatter.title,
                "created_at": normalized.frontmatter.created_at.isoformat(),
                "updated_at": normalized.frontmatter.updated_at.isoformat(),
                "tags": normalized.frontmatter.tags,
                "provider": normalized.frontmatter.provider,
                "model": normalized.frontmatter.model,
                "folder_id": normalized.frontmatter.folder_id,
                "context_preset": normalized.frontmatter.context_preset,
                "context_text": normalized.frontmatter.context_text,
            },
            "kind": normalized.kind,
            "content_format": normalized.content_format,
            "session": self._serialize_session_metadata(normalized),
        }
        (bundle_dir / META_FILENAME).write_text(json.dumps(meta_payload, indent=2) + "\n", encoding="utf-8")

        if normalized.kind == "transcript":
            session = normalized.session if isinstance(normalized.session, TranscriptSessionData) else None
            self._write_body(bundle_dir / TRANSCRIPT_BODY_FILENAME, normalized.content)
            self._write_optional_body(bundle_dir / SUMMARY_BODY_FILENAME, session.summary if session else None)
            self._remove_file(bundle_dir / NOTE_BODY_FILENAME)
            self._remove_file(bundle_dir / GUIDANCE_BODY_FILENAME)
        elif normalized.kind == "interview_assist":
            session = normalized.session if isinstance(normalized.session, InterviewSessionData) else None
            self._write_body(bundle_dir / TRANSCRIPT_BODY_FILENAME, normalized.content)
            self._write_body(bundle_dir / GUIDANCE_BODY_FILENAME, session.guidance if session else "")
            self._write_optional_body(bundle_dir / SUMMARY_BODY_FILENAME, session.summary if session else None)
            self._remove_file(bundle_dir / NOTE_BODY_FILENAME)
        else:
            self._write_body(bundle_dir / NOTE_BODY_FILENAME, normalized.content)
            self._remove_file(bundle_dir / TRANSCRIPT_BODY_FILENAME)
            self._remove_file(bundle_dir / GUIDANCE_BODY_FILENAME)
            self._remove_file(bundle_dir / SUMMARY_BODY_FILENAME)

        legacy_json_path = self.notes_dir / f"{normalized.frontmatter.id}{LEGACY_NOTE_FILENAME_SUFFIX}"
        legacy_json_path.unlink(missing_ok=True)
        legacy_markdown_path = self.notes_dir / f"{normalized.frontmatter.id}.md"
        legacy_markdown_path.unlink(missing_ok=True)

    def _resolve_bundle_dir(self, note_id: str, folder_id: str | None) -> Path:
        target_parent = self._unfiled_dir if folder_id is None else self._folder_path_for(folder_id)
        if target_parent is None:
            raise FileNotFoundError(f"Folder {folder_id} not found")

        target_parent.mkdir(parents=True, exist_ok=True)
        target_dir = target_parent / note_id
        existing_dir = self._find_note_bundle(note_id)

        if existing_dir and existing_dir != target_dir:
            if target_dir.exists():
                shutil.rmtree(target_dir)
            existing_dir.rename(target_dir)

        return target_dir

    def _folder_path_for(self, folder_id: str) -> Path | None:
        record = self._find_folder_record(folder_id)
        return record.path if record else None

    def _load_note_bundle(self, bundle_dir: Path) -> NoteDocument | None:
        meta_path = bundle_dir / META_FILENAME
        if not meta_path.exists():
            return None

        raw = self._read_json_file(meta_path)
        if not isinstance(raw, dict):
            return None

        try:
            frontmatter = NoteFrontmatter.model_validate(raw.get("frontmatter", {}))
        except ValidationError:
            return None

        kind = str(raw.get("kind") or "note")
        content_format = str(raw.get("content_format") or "markdown")
        session = None
        content = ""
        session_metadata = raw.get("session")

        if kind == "transcript":
            transcript = self._read_text_file(bundle_dir / TRANSCRIPT_BODY_FILENAME)
            summary = self._read_optional_text_file(bundle_dir / SUMMARY_BODY_FILENAME)
            segments = []
            last_updated_at = frontmatter.updated_at
            if isinstance(session_metadata, dict):
                segments_payload = session_metadata.get("segments")
                last_updated_at = _parse_datetime(session_metadata.get("last_updated_at"))
                try:
                    segments = TranscriptSessionData.model_validate(
                        {
                            "session_type": "transcript",
                            "transcript": transcript,
                            "segments": segments_payload or [],
                            "summary": summary,
                            "last_updated_at": last_updated_at,
                        }
                    ).segments
                except ValidationError:
                    segments = []
            session = TranscriptSessionData(
                transcript=transcript,
                segments=segments,
                summary=summary,
                last_updated_at=last_updated_at,
            )
            content = transcript
            content_format = "plain_text"
        elif kind == "interview_assist":
            transcript = self._read_text_file(bundle_dir / TRANSCRIPT_BODY_FILENAME)
            guidance = self._read_text_file(bundle_dir / GUIDANCE_BODY_FILENAME)
            summary = self._read_optional_text_file(bundle_dir / SUMMARY_BODY_FILENAME)
            turns = []
            last_updated_at = frontmatter.updated_at
            last_coached_turn_id = None
            if isinstance(session_metadata, dict):
                turns_payload = session_metadata.get("turns")
                last_updated_at = _parse_datetime(session_metadata.get("last_updated_at"))
                last_coached_turn_id = (
                    str(session_metadata.get("last_coached_interviewer_turn_id"))
                    if session_metadata.get("last_coached_interviewer_turn_id")
                    else None
                )
                try:
                    turns = InterviewSessionData.model_validate(
                        {
                            "session_type": "interview_assist",
                            "transcript": transcript,
                            "guidance": guidance,
                            "turns": turns_payload or [],
                            "summary": summary,
                            "last_coached_interviewer_turn_id": last_coached_turn_id,
                            "last_updated_at": last_updated_at,
                        }
                    ).turns
                except ValidationError:
                    turns = []
            session = InterviewSessionData(
                transcript=transcript,
                guidance=guidance,
                turns=turns,
                summary=summary,
                last_coached_interviewer_turn_id=last_coached_turn_id,
                last_updated_at=last_updated_at,
            )
            content = transcript
            content_format = "plain_text"
        else:
            content = self._read_text_file(bundle_dir / NOTE_BODY_FILENAME)
            content_format = "markdown"

        document = NoteDocument(
            frontmatter=frontmatter,
            kind=kind,
            content_format=content_format,
            content=content,
            session=session,
        )
        return self._normalize_document(document)

    def _load_structured_note(self, file_path: Path) -> NoteDocument | None:
        raw = self._read_json_file(file_path)
        if not isinstance(raw, dict):
            return None

        try:
            document = NoteDocument.model_validate(
                {
                    "frontmatter": raw.get("frontmatter", {}),
                    "kind": raw.get("kind") or "note",
                    "content_format": raw.get("content_format") or "markdown",
                    "content": raw.get("content") or "",
                    "session": raw.get("session"),
                },
            )
        except ValidationError:
            return None

        return self._normalize_document(document)

    def _load_legacy_markdown(self, file_path: Path) -> NoteDocument | None:
        raw = file_path.read_text(encoding="utf-8")
        frontmatter_data, body = self._parse_markdown(raw)
        created_at = _parse_datetime(frontmatter_data.get("created_at"))
        updated_at = _parse_datetime(frontmatter_data.get("updated_at"))

        document = NoteDocument(
            frontmatter=NoteFrontmatter(
                id=str(frontmatter_data.get("id") or file_path.stem),
                title=str(frontmatter_data.get("title") or "Untitled note"),
                created_at=created_at,
                updated_at=updated_at,
                tags=list(frontmatter_data.get("tags") or []),
                provider=frontmatter_data.get("provider"),
                model=frontmatter_data.get("model"),
                folder_id=frontmatter_data.get("folder_id"),
                context_preset=frontmatter_data.get("context_preset"),
                context_text=frontmatter_data.get("context_text"),
            ),
            kind="note",
            content_format="markdown",
            content=body,
            session=None,
        )
        return self._normalize_document(document)

    def _search_text_for(self, note: NoteDocument, folder_name: str) -> str:
        parts = [
            note.frontmatter.title,
            note.content,
            " ".join(note.frontmatter.tags),
            folder_name,
            note.frontmatter.context_preset or "",
            note.frontmatter.context_text or "",
        ]

        if isinstance(note.session, TranscriptSessionData):
            parts.append(note.session.transcript)
            parts.append(note.session.summary or "")
        elif isinstance(note.session, InterviewSessionData):
            parts.extend(
                [
                    note.session.transcript,
                    note.session.guidance,
                    note.session.summary or "",
                    " ".join(turn.text for turn in note.session.turns),
                ],
            )

        return " ".join(part for part in parts if part)

    def _normalize_document(self, note: NoteDocument) -> NoteDocument:
        content = note.content
        session = note.session
        content_format = note.content_format

        if note.kind == "transcript":
            transcript = ""
            last_updated_at = note.frontmatter.updated_at
            if isinstance(session, TranscriptSessionData):
                transcript = session.transcript or content
                segments = session.segments
                summary = session.summary
                last_updated_at = session.last_updated_at or note.frontmatter.updated_at
            else:
                transcript = content
                segments = []
                summary = None
            content = transcript
            content_format = "plain_text"
            session = TranscriptSessionData(
                transcript=transcript,
                segments=segments,
                summary=summary,
                last_updated_at=last_updated_at,
            )
        elif note.kind == "interview_assist":
            transcript = ""
            guidance = ""
            turns = []
            summary = None
            last_coached_turn = None
            last_updated_at = note.frontmatter.updated_at
            if isinstance(session, InterviewSessionData):
                transcript = session.transcript or content
                guidance = session.guidance
                turns = session.turns
                summary = session.summary
                last_coached_turn = session.last_coached_interviewer_turn_id
                last_updated_at = session.last_updated_at or note.frontmatter.updated_at
            else:
                transcript = content
            content = transcript
            content_format = "plain_text"
            session = InterviewSessionData(
                transcript=transcript,
                guidance=guidance,
                turns=turns,
                summary=summary,
                last_coached_interviewer_turn_id=last_coached_turn,
                last_updated_at=last_updated_at,
            )
        else:
            session = None
            content_format = "markdown"

        return NoteDocument(
            frontmatter=note.frontmatter,
            kind=note.kind,
            content_format=content_format,
            content=content,
            session=session,
        )

    def _migrate_legacy_storage(self) -> None:
        for folder in self._read_legacy_folders():
            self._upsert_folder(folder)

        if self._legacy_folders_path.exists():
            self._legacy_folders_path.unlink(missing_ok=True)

        legacy_json_files = sorted(self.notes_dir.glob(f"*{LEGACY_NOTE_FILENAME_SUFFIX}"))
        for file_path in legacy_json_files:
            note = self._load_structured_note(file_path)
            if note is None:
                continue
            self._save_note(note)
            file_path.unlink(missing_ok=True)

        legacy_markdown_files = sorted(self.notes_dir.glob("*.md"))
        for file_path in legacy_markdown_files:
            if file_path.parent != self.notes_dir:
                continue
            note = self._load_legacy_markdown(file_path)
            if note is None:
                continue
            self._save_note(note)
            file_path.unlink(missing_ok=True)

    def _read_legacy_folders(self) -> list[FolderNode]:
        rows = self._read_json_file(self._legacy_folders_path)
        if not isinstance(rows, list):
            return []

        folders: list[FolderNode] = []
        for row in rows:
            if not isinstance(row, dict) or not row.get("id"):
                continue
            folders.append(
                FolderNode(
                    id=str(row.get("id")),
                    name=str(row.get("name") or "Untitled folder"),
                    created_at=_parse_datetime(row.get("created_at")),
                    updated_at=_parse_datetime(row.get("updated_at")),
                )
            )
        return folders

    def _list_folder_records(self) -> list[_FolderRecord]:
        records: list[_FolderRecord] = []
        if not self._folders_dir.exists():
            return records

        for child in sorted(self._folders_dir.iterdir()):
            if not child.is_dir():
                continue
            meta_path = child / FOLDER_META_FILENAME
            raw = self._read_json_file(meta_path)
            if not isinstance(raw, dict) or not raw.get("id"):
                continue
            try:
                folder = FolderNode(
                    id=str(raw.get("id")),
                    name=str(raw.get("name") or "Untitled folder"),
                    created_at=_parse_datetime(raw.get("created_at")),
                    updated_at=_parse_datetime(raw.get("updated_at")),
                )
            except ValidationError:
                continue
            records.append(_FolderRecord(folder=folder, path=child, slug=child.name))
        return records

    def _find_folder_record(self, folder_id: str) -> _FolderRecord | None:
        for record in self._list_folder_records():
            if record.folder.id == folder_id:
                return record
        return None

    def _upsert_folder(self, folder: FolderNode) -> None:
        existing = self._find_folder_record(folder.id)
        desired_slug = (
            existing.slug
            if existing and existing.folder.name == folder.name
            else self._next_available_folder_slug(folder.name, exclude_folder_id=folder.id)
        )
        target_path = self._folders_dir / desired_slug
        if existing and existing.path != target_path:
            if target_path.exists():
                shutil.rmtree(target_path)
            existing.path.rename(target_path)

        target_path.mkdir(parents=True, exist_ok=True)
        payload = {
            "id": folder.id,
            "name": folder.name,
            "slug": target_path.name,
            "created_at": folder.created_at.isoformat(),
            "updated_at": folder.updated_at.isoformat(),
        }
        (target_path / FOLDER_META_FILENAME).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    def _next_available_folder_slug(self, name: str, exclude_folder_id: str | None = None) -> str:
        base = _slugify(name) or "folder"
        records = self._list_folder_records()
        used = {record.slug: record.folder.id for record in records}
        if base not in used or used[base] == exclude_folder_id:
            return base

        counter = 2
        while True:
            candidate = f"{base}-{counter}"
            if candidate not in used or used[candidate] == exclude_folder_id:
                return candidate
            counter += 1

    def _write_body(self, path: Path, content: str) -> None:
        path.write_text(content, encoding="utf-8")

    def _serialize_session_metadata(self, note: NoteDocument) -> dict[str, object] | None:
        if isinstance(note.session, TranscriptSessionData):
            return {
                "session_type": "transcript",
                "segments": [segment.model_dump(mode="json") for segment in note.session.segments],
                "last_updated_at": note.session.last_updated_at.isoformat()
                if note.session.last_updated_at is not None
                else None,
            }

        if isinstance(note.session, InterviewSessionData):
            return {
                "session_type": "interview_assist",
                "turns": [turn.model_dump(mode="json") for turn in note.session.turns],
                "last_coached_interviewer_turn_id": note.session.last_coached_interviewer_turn_id,
                "last_updated_at": note.session.last_updated_at.isoformat()
                if note.session.last_updated_at is not None
                else None,
            }

        return None

    def _write_optional_body(self, path: Path, content: str | None) -> None:
        if content is None or not content.strip():
            self._remove_file(path)
            return
        self._write_body(path, content)

    def _remove_file(self, path: Path) -> None:
        path.unlink(missing_ok=True)

    def _read_text_file(self, path: Path) -> str:
        if not path.exists():
            return ""
        return path.read_text(encoding="utf-8")

    def _read_optional_text_file(self, path: Path) -> str | None:
        if not path.exists():
            return None
        return path.read_text(encoding="utf-8")

    @staticmethod
    def _read_json_file(path: Path) -> object:
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    @staticmethod
    def _parse_markdown(raw: str) -> tuple[dict, str]:
        if not raw.startswith(FRONTMATTER_START):
            return {}, raw

        close_idx = raw.find(FRONTMATTER_END, len(FRONTMATTER_START))
        if close_idx == -1:
            return {}, raw

        frontmatter_blob = raw[len(FRONTMATTER_START) : close_idx]
        body_start = close_idx + len(FRONTMATTER_END)
        body = raw[body_start:]
        parsed = yaml.safe_load(frontmatter_blob) or {}
        if not isinstance(parsed, dict):
            return {}, body
        return parsed, body


def _parse_datetime(raw_value: object) -> datetime:
    if not raw_value:
        return datetime.now(timezone.utc)

    if isinstance(raw_value, datetime):
        if raw_value.tzinfo is None:
            return raw_value.replace(tzinfo=timezone.utc)
        return raw_value

    try:
        parsed = datetime.fromisoformat(str(raw_value))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        return datetime.now(timezone.utc)


def _utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


def _slugify(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower())
    normalized = re.sub(r"-{2,}", "-", normalized).strip("-")
    return normalized or "folder"

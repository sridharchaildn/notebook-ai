from __future__ import annotations

import json
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
FOLDERS_FILENAME = ".folders.json"
STORAGE_MODEL_SPEC = load_storage_model_spec()
NOTE_FILENAME_SUFFIX = str(STORAGE_MODEL_SPEC.get("default_note_extension") or ".note.json")


class NoteStore:
    def __init__(self, notes_dir: Path):
        self.notes_dir: Path
        self._folders_path: Path
        self.set_notes_dir(notes_dir)

    def set_notes_dir(self, notes_dir: Path) -> None:
        self.notes_dir = notes_dir.expanduser().resolve()
        self.notes_dir.mkdir(parents=True, exist_ok=True)
        self._folders_path = self.notes_dir / FOLDERS_FILENAME
        if not self._folders_path.exists():
            self._folders_path.write_text("[]\n", encoding="utf-8")

    def get_local_root(self) -> str:
        return str(self.notes_dir)

    def list_notes(self, query: str = "") -> list[NoteDocument]:
        notes_by_id: dict[str, NoteDocument] = {}
        normalized_query = query.strip().lower()

        for file_path in sorted(self.notes_dir.glob(f"*{NOTE_FILENAME_SUFFIX}")):
            note = self._load_note(file_path)
            if not note:
                continue
            notes_by_id[note.frontmatter.id] = note

        for file_path in sorted(self.notes_dir.glob("*.md")):
            note = self._load_note(file_path)
            if not note:
                continue
            notes_by_id.setdefault(note.frontmatter.id, note)

        notes = list(notes_by_id.values())
        if normalized_query:
            notes = [
                note
                for note in notes
                if normalized_query in self._search_text_for(note).lower()
            ]

        return sorted(notes, key=lambda item: item.frontmatter.updated_at, reverse=True)

    def create_note(self, payload: NoteCreateRequest) -> NoteDocument:
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
        json_path = self._json_note_path(note_id)
        legacy_path = self._legacy_note_path(note_id)
        if json_path.exists():
            json_path.unlink(missing_ok=True)
            removed = True
        if legacy_path.exists():
            legacy_path.unlink(missing_ok=True)
            removed = True
        return removed

    def list_folders(self) -> list[FolderNode]:
        rows = self._read_folders()
        folders = [
            FolderNode(
                id=str(row.get("id")),
                name=str(row.get("name") or "Untitled folder"),
                created_at=_parse_datetime(str(row.get("created_at") or "")),
                updated_at=_parse_datetime(str(row.get("updated_at") or "")),
            )
            for row in rows
            if row.get("id")
        ]
        return sorted(folders, key=lambda folder: folder.name.lower())

    def create_folder(self, name: str) -> FolderNode:
        normalized = name.strip()
        if not normalized:
            raise ValueError("Folder name cannot be empty")

        now = _utcnow_iso()
        folder = {
            "id": str(uuid4()),
            "name": normalized,
            "created_at": now,
            "updated_at": now,
        }
        rows = self._read_folders()
        rows.append(folder)
        self._write_folders(rows)
        return FolderNode(
            id=folder["id"],
            name=folder["name"],
            created_at=_parse_datetime(folder["created_at"]),
            updated_at=_parse_datetime(folder["updated_at"]),
        )

    def update_folder(self, folder_id: str, name: str) -> FolderNode:
        normalized = name.strip()
        if not normalized:
            raise ValueError("Folder name cannot be empty")

        rows = self._read_folders()
        for row in rows:
            if str(row.get("id")) != folder_id:
                continue
            row["name"] = normalized
            row["updated_at"] = _utcnow_iso()
            self._write_folders(rows)
            return FolderNode(
                id=str(row["id"]),
                name=str(row["name"]),
                created_at=_parse_datetime(str(row.get("created_at") or "")),
                updated_at=_parse_datetime(str(row.get("updated_at") or "")),
            )

        raise FileNotFoundError(f"Folder {folder_id} not found")

    def delete_folder(self, folder_id: str) -> bool:
        rows = self._read_folders()
        next_rows = [row for row in rows if str(row.get("id")) != folder_id]
        if len(next_rows) == len(rows):
            return False

        self._write_folders(next_rows)

        for note in self.list_notes():
            if note.frontmatter.folder_id != folder_id:
                continue
            self.move_note(note.frontmatter.id, None)

        return True

    def save_note_document(self, document: NoteDocument) -> NoteDocument:
        normalized = self._normalize_document(document)
        self._save_note(normalized)
        return normalized

    def replace_folders(self, folders: list[FolderNode]) -> list[FolderNode]:
        rows = [
            {
                "id": folder.id,
                "name": folder.name,
                "created_at": folder.created_at.isoformat(),
                "updated_at": folder.updated_at.isoformat(),
            }
            for folder in folders
        ]
        self._write_folders(rows)
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
        return any(folder.id == folder_id for folder in self.list_folders())

    def _json_note_path(self, note_id: str) -> Path:
        return self.notes_dir / f"{note_id}{NOTE_FILENAME_SUFFIX}"

    def _legacy_note_path(self, note_id: str) -> Path:
        return self.notes_dir / f"{note_id}.md"

    def _load_existing_note(self, note_id: str) -> NoteDocument | None:
        json_path = self._json_note_path(note_id)
        if json_path.exists():
            return self._load_note(json_path)

        legacy_path = self._legacy_note_path(note_id)
        if legacy_path.exists():
            return self._load_note(legacy_path)

        return None

    def _read_folders(self) -> list[dict[str, object]]:
        if not self._folders_path.exists():
            return []

        raw = self._folders_path.read_text(encoding="utf-8").strip()
        if not raw:
            return []

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return []

        if not isinstance(parsed, list):
            return []

        return [item for item in parsed if isinstance(item, dict)]

    def _write_folders(self, rows: list[dict[str, object]]) -> None:
        self._folders_path.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")

    def _load_note(self, file_path: Path) -> NoteDocument | None:
        if not file_path.exists():
            return None

        if file_path.name.endswith(NOTE_FILENAME_SUFFIX):
            return self._load_structured_note(file_path)
        if file_path.suffix == ".md":
            return self._load_legacy_markdown(file_path)
        return None

    def _load_structured_note(self, file_path: Path) -> NoteDocument | None:
        try:
            raw = json.loads(file_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return None

        if not isinstance(raw, dict):
            return None

        try:
            document = NoteDocument.model_validate(
                {
                    "frontmatter": raw.get("frontmatter", {}),
                    "kind": raw.get("kind") or "note",
                    "content_format": raw.get("content_format") or "plain_text",
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

    def _save_note(self, note: NoteDocument) -> None:
        normalized = self._normalize_document(note)
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
        self._json_note_path(normalized.frontmatter.id).write_text(
            json.dumps(payload, indent=2) + "\n",
            encoding="utf-8",
        )
        legacy_path = self._legacy_note_path(normalized.frontmatter.id)
        if legacy_path.exists():
            legacy_path.unlink(missing_ok=True)

    def _search_text_for(self, note: NoteDocument) -> str:
        parts = [
            note.frontmatter.title,
            note.content,
            " ".join(note.frontmatter.tags),
            note.frontmatter.context_preset or "",
            note.frontmatter.context_text or "",
        ]

        if isinstance(note.session, TranscriptSessionData):
            parts.append(note.session.transcript)
        elif isinstance(note.session, InterviewSessionData):
            parts.extend(
                [
                    note.session.transcript,
                    note.session.guidance,
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
                last_updated_at = session.last_updated_at or note.frontmatter.updated_at
            else:
                transcript = content
                segments = []
            content = transcript
            content_format = "plain_text"
            session = TranscriptSessionData(
                transcript=transcript,
                segments=segments,
                last_updated_at=last_updated_at,
            )
        elif note.kind == "interview_assist":
            transcript = ""
            guidance = ""
            turns = []
            last_coached_turn = None
            last_updated_at = note.frontmatter.updated_at
            if isinstance(session, InterviewSessionData):
                transcript = session.transcript or content
                guidance = session.guidance
                turns = session.turns
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
                last_coached_interviewer_turn_id=last_coached_turn,
                last_updated_at=last_updated_at,
            )
        else:
            session = None

        return NoteDocument(
            frontmatter=note.frontmatter,
            kind=note.kind,
            content_format=content_format,
            content=content,
            session=session,
        )

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


def _parse_datetime(raw_value: str | datetime | None) -> datetime:
    if not raw_value:
        return datetime.now(timezone.utc)

    if isinstance(raw_value, datetime):
        if raw_value.tzinfo is None:
            return raw_value.replace(tzinfo=timezone.utc)
        return raw_value

    try:
        parsed = datetime.fromisoformat(raw_value)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        return datetime.now(timezone.utc)


def _utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import yaml

from .models import NoteCreateRequest, NoteDocument, NoteFrontmatter, NoteUpdateRequest

FRONTMATTER_START = "---\n"
FRONTMATTER_END = "\n---\n"


class NoteStore:
    def __init__(self, notes_dir: Path):
        self.notes_dir = notes_dir
        self.notes_dir.mkdir(parents=True, exist_ok=True)

    def list_notes(self, query: str = "") -> list[NoteDocument]:
        notes: list[NoteDocument] = []
        normalized_query = query.strip().lower()

        for file_path in self.notes_dir.glob("*.md"):
            note = self._load_note(file_path)
            if not note:
                continue

            if normalized_query:
                haystack = " ".join(
                    [
                        note.frontmatter.title,
                        note.body,
                        " ".join(note.frontmatter.tags),
                    ]
                ).lower()
                if normalized_query not in haystack:
                    continue

            notes.append(note)

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
        )
        document = NoteDocument(frontmatter=frontmatter, body=payload.body)
        self._save_note(document)
        return document

    def update_note(self, note_id: str, payload: NoteUpdateRequest) -> NoteDocument:
        file_path = self._note_path(note_id)
        existing = self._load_note(file_path)
        if not existing:
            raise FileNotFoundError(f"Note {note_id} not found")

        updated = NoteDocument(
            frontmatter=NoteFrontmatter(
                id=existing.frontmatter.id,
                title=payload.title.strip() or "Untitled note",
                created_at=existing.frontmatter.created_at,
                updated_at=datetime.now(timezone.utc),
                tags=payload.tags,
                provider=payload.provider,
                model=payload.model,
            ),
            body=payload.body,
        )
        self._save_note(updated)
        return updated

    def _note_path(self, note_id: str) -> Path:
        return self.notes_dir / f"{note_id}.md"

    def _load_note(self, file_path: Path) -> NoteDocument | None:
        if not file_path.exists():
            return None

        raw = file_path.read_text(encoding="utf-8")
        frontmatter_data, body = self._parse_markdown(raw)
        created_at = _parse_datetime(frontmatter_data.get("created_at"))
        updated_at = _parse_datetime(frontmatter_data.get("updated_at"))

        frontmatter = NoteFrontmatter(
            id=str(frontmatter_data.get("id") or file_path.stem),
            title=str(frontmatter_data.get("title") or "Untitled note"),
            created_at=created_at,
            updated_at=updated_at,
            tags=list(frontmatter_data.get("tags") or []),
            provider=frontmatter_data.get("provider"),
            model=frontmatter_data.get("model"),
        )

        return NoteDocument(frontmatter=frontmatter, body=body)

    def _save_note(self, note: NoteDocument) -> None:
        data = {
            "id": note.frontmatter.id,
            "title": note.frontmatter.title,
            "created_at": note.frontmatter.created_at.isoformat(),
            "updated_at": note.frontmatter.updated_at.isoformat(),
            "tags": note.frontmatter.tags,
            "provider": note.frontmatter.provider,
            "model": note.frontmatter.model,
        }
        yaml_blob = yaml.safe_dump(data, sort_keys=False, allow_unicode=False).strip()
        body = note.body.rstrip()
        content = f"{FRONTMATTER_START}{yaml_blob}{FRONTMATTER_END}{body}\n"
        self._note_path(note.frontmatter.id).write_text(content, encoding="utf-8")

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


def _parse_datetime(raw_value: str | None) -> datetime:
    if not raw_value:
        return datetime.now(timezone.utc)

    try:
        parsed = datetime.fromisoformat(raw_value)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        return datetime.now(timezone.utc)

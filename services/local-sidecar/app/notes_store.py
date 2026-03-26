from __future__ import annotations

import json
from datetime import UTC, datetime, timezone
from pathlib import Path
from uuid import uuid4

import yaml

from .models import FolderNode, NoteCreateRequest, NoteDocument, NoteFrontmatter, NoteUpdateRequest

FRONTMATTER_START = "---\n"
FRONTMATTER_END = "\n---\n"
FOLDERS_FILENAME = ".folders.json"


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
            folder_id=payload.folder_id,
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
                folder_id=existing.frontmatter.folder_id
                if payload.folder_id is None
                else payload.folder_id,
            ),
            body=payload.body,
        )
        self._save_note(updated)
        return updated

    def move_note(self, note_id: str, folder_id: str | None) -> NoteDocument:
        file_path = self._note_path(note_id)
        existing = self._load_note(file_path)
        if not existing:
            raise FileNotFoundError(f"Note {note_id} not found")

        if folder_id is not None and not self._folder_exists(folder_id):
            raise FileNotFoundError(f"Folder {folder_id} not found")

        updated = NoteDocument(
            frontmatter=NoteFrontmatter(
                id=existing.frontmatter.id,
                title=existing.frontmatter.title,
                created_at=existing.frontmatter.created_at,
                updated_at=datetime.now(timezone.utc),
                tags=existing.frontmatter.tags,
                provider=existing.frontmatter.provider,
                model=existing.frontmatter.model,
                folder_id=folder_id,
            ),
            body=existing.body,
        )
        self._save_note(updated)
        return updated

    def delete_note(self, note_id: str) -> bool:
        file_path = self._note_path(note_id)
        if not file_path.exists():
            return False
        file_path.unlink(missing_ok=True)
        return True

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

    def _folder_exists(self, folder_id: str) -> bool:
        return any(folder.id == folder_id for folder in self.list_folders())

    def _note_path(self, note_id: str) -> Path:
        return self.notes_dir / f"{note_id}.md"

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
            folder_id=frontmatter_data.get("folder_id"),
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
            "folder_id": note.frontmatter.folder_id,
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


def _utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()

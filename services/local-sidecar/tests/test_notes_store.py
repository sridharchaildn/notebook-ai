from __future__ import annotations

from pathlib import Path
from textwrap import dedent

from app.models import NoteCreateRequest, NoteUpdateRequest
from app.notes_store import NoteStore


def test_structured_note_roundtrip(tmp_path: Path):
    store = NoteStore(tmp_path / "notes")

    created = store.create_note(
        NoteCreateRequest(
            title="Sprint Plan",
            content="- Draft roadmap\n- Align stakeholders",
            tags=["planning", "q2"],
            provider="openai",
            model="gpt-4o-mini",
        )
    )

    updated = store.update_note(
        created.frontmatter.id,
        NoteUpdateRequest(
            title="Sprint Plan v2",
            content="Updated body",
            tags=["planning"],
            provider="openrouter",
            model="openai/gpt-4o-mini",
        ),
    )

    all_notes = store.list_notes()
    assert len(all_notes) == 1

    reloaded = all_notes[0]
    assert reloaded.frontmatter.id == created.frontmatter.id
    assert reloaded.frontmatter.title == "Sprint Plan v2"
    assert reloaded.content == "Updated body"
    assert reloaded.frontmatter.provider == "openrouter"
    assert reloaded.frontmatter.model == "openai/gpt-4o-mini"
    assert (tmp_path / "notes" / f"{created.frontmatter.id}.note.json").exists()

    search = store.list_notes(query="updated")
    assert len(search) == 1
    assert updated.frontmatter.updated_at >= created.frontmatter.created_at


def test_legacy_markdown_import_migrates_on_save(tmp_path: Path):
    notes_dir = tmp_path / "notes"
    notes_dir.mkdir(parents=True, exist_ok=True)
    legacy_path = notes_dir / "legacy-note.md"
    legacy_path.write_text(
        dedent(
            """\
            ---
            id: legacy-note
            title: Legacy note
            created_at: 2026-03-01T12:00:00+00:00
            updated_at: 2026-03-01T12:00:00+00:00
            tags:
              - legacy
            ---
            # Legacy content

            Imported from markdown.
            """
        ),
        encoding="utf-8",
    )

    store = NoteStore(notes_dir)
    loaded = store.list_notes()
    assert len(loaded) == 1
    assert loaded[0].content_format == "markdown"

    updated = store.update_note(
        "legacy-note",
        NoteUpdateRequest(
            title="Legacy note updated",
            content=loaded[0].content,
            content_format="markdown",
            kind="note",
            tags=["legacy"],
        ),
    )

    assert updated.frontmatter.title == "Legacy note updated"
    assert (notes_dir / "legacy-note.note.json").exists()
    assert not legacy_path.exists()


def test_folder_crud_and_move(tmp_path: Path):
    store = NoteStore(tmp_path / "notes")
    folder = store.create_folder("Interviews")
    assert folder.name == "Interviews"

    created = store.create_note(
        NoteCreateRequest(
            title="Session 1",
            content="Transcript",
            tags=["interview"],
        )
    )

    moved = store.move_note(created.frontmatter.id, folder.id)
    assert moved.frontmatter.folder_id == folder.id

    renamed = store.update_folder(folder.id, "Interview Prep")
    assert renamed.name == "Interview Prep"

    removed = store.delete_folder(folder.id)
    assert removed is True

    reloaded = store.list_notes()[0]
    assert reloaded.frontmatter.folder_id is None

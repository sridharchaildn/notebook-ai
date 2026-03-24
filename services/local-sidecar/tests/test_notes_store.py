from __future__ import annotations

from pathlib import Path

from app.models import NoteCreateRequest, NoteUpdateRequest
from app.notes_store import NoteStore


def test_markdown_frontmatter_roundtrip(tmp_path: Path):
    store = NoteStore(tmp_path / "notes")

    created = store.create_note(
        NoteCreateRequest(
            title="Sprint Plan",
            body="- Draft roadmap\n- Align stakeholders",
            tags=["planning", "q2"],
            provider="openai",
            model="gpt-4o-mini",
        )
    )

    updated = store.update_note(
        created.frontmatter.id,
        NoteUpdateRequest(
            title="Sprint Plan v2",
            body="Updated body",
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
    assert reloaded.body == "Updated body\n"
    assert reloaded.frontmatter.provider == "openrouter"
    assert reloaded.frontmatter.model == "openai/gpt-4o-mini"

    search = store.list_notes(query="updated")
    assert len(search) == 1
    assert updated.frontmatter.updated_at >= created.frontmatter.created_at

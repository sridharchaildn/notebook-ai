import type { NoteDocument } from '@notebook-ai/contracts';
import { Search, SquarePen } from 'lucide-react';

interface Props {
  notes: NoteDocument[];
  selectedId: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function NoteList({ notes, selectedId, search, onSearchChange, onSelect, onCreate }: Props) {
  return (
    <aside className="note-list">
      <div className="note-list__topbar">
        <h1>Notebook AI</h1>
        <button type="button" className="ghost-btn" onClick={onCreate}>
          <SquarePen size={16} />
          New
        </button>
      </div>

      <div className="search-wrap">
        <Search size={16} />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search notes"
        />
      </div>

      <div className="note-list__items">
        {notes.length === 0 ? (
          <p className="empty-state">No notes yet. Create your first one.</p>
        ) : (
          notes.map((note) => {
            const isActive = selectedId === note.frontmatter.id;
            return (
              <button
                key={note.frontmatter.id}
                type="button"
                onClick={() => onSelect(note.frontmatter.id)}
                className={isActive ? 'note-row active' : 'note-row'}
              >
                <span className="note-row__title">{note.frontmatter.title || 'Untitled note'}</span>
                <span className="note-row__meta">
                  {new Date(note.frontmatter.updated_at).toLocaleString()}
                </span>
                <p className="note-row__snippet">{note.body.slice(0, 92) || 'Start writing...'}</p>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

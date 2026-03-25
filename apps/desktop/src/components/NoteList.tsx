import type { NoteDocument } from '@notebook-ai/contracts';
import { BookOpen, HelpCircle, PanelLeftClose, Search, Settings, SquarePen } from 'lucide-react';

interface Props {
  notes: NoteDocument[];
  selectedId: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onOpenSettings: () => void;
  onOpenSplash: () => void;
  onCollapse: () => void;
}

export function NoteList({
  notes,
  selectedId,
  search,
  onSearchChange,
  onSelect,
  onCreate,
  onOpenSettings,
  onOpenSplash,
  onCollapse,
}: Props) {
  return (
    <aside className="note-list">
      <div className="note-list__topbar">
        <button type="button" className="app-brand-btn" onClick={onOpenSplash} aria-label="Open splash screen">
          <span className="app-brand-icon">
            <BookOpen size={14} />
          </span>
          <span className="app-brand-label">Notebook AI</span>
        </button>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button type="button" className="ghost-btn" onClick={onCollapse} aria-label="Collapse sidebar">
            <PanelLeftClose size={16} />
          </button>
        </div>
      </div>

      <div className="search-wrap">
        <Search size={16} className="muted" />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search notes..."
        />
      </div>

      <div style={{ padding: '0 12px 8px' }}>
        <button type="button" className="solid-btn" onClick={onCreate} style={{ width: '100%', justifyContent: 'center' }}>
          <SquarePen size={14} />
          New Note
        </button>
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
                {note.frontmatter.tags.length > 0 && (
                  <div className="note-row__tags">
                    {note.frontmatter.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="tag-pill">{tag}</span>
                    ))}
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>

      <div className="note-list__footer">
        <button type="button" className="footer-btn" onClick={onOpenSettings}>
          <Settings size={16} />
          Settings
        </button>
        <button type="button" className="footer-btn" onClick={() => window.open('https://github.com', '_blank')}>
          <HelpCircle size={16} />
          Help
        </button>
      </div>
    </aside>
  );
}

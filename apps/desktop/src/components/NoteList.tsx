import { getNoteSnippet } from '@notebook-ai/app-core';
import type { NoteDocument } from '@notebook-ai/contracts';
import { BookOpen, Ellipsis, HelpCircle, LogOut, PanelLeftClose, Search, Settings, SquarePen, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

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
  onLogout: () => void;
  onRenameNote: (id: string) => void;
  onDeleteNote: (id: string) => void;
  logoutBusy: boolean;
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
  onLogout,
  onRenameNote,
  onDeleteNote,
  logoutBusy,
}: Props) {
  const [menuNoteId, setMenuNoteId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current) return;
      if (event.target instanceof Node && menuRef.current.contains(event.target)) return;
      setMenuNoteId(null);
    }

    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, []);

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
              <div
                key={note.frontmatter.id}
                className={isActive ? 'note-row active' : 'note-row'}
              >
                <button
                  type="button"
                  onClick={() => onSelect(note.frontmatter.id)}
                  className="note-row__main"
                >
                  <span className="note-row__title">{note.frontmatter.title || 'Untitled note'}</span>
                  <span className="note-row__meta">
                    {new Date(note.frontmatter.updated_at).toLocaleString()}
                  </span>
                  <p className="note-row__snippet">{getNoteSnippet(note) || 'Start writing...'}</p>
                  {note.frontmatter.tags.length > 0 && (
                    <div className="note-row__tags">
                      {note.frontmatter.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="tag-pill">{tag}</span>
                      ))}
                    </div>
                  )}
                </button>
                <div className="note-row__actions" ref={menuNoteId === note.frontmatter.id ? menuRef : null}>
                  <button
                    type="button"
                    className="note-row__menu-trigger"
                    aria-label={`Open actions for ${note.frontmatter.title || 'Untitled note'}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenuNoteId((current) => (current === note.frontmatter.id ? null : note.frontmatter.id));
                    }}
                  >
                    <Ellipsis size={14} />
                  </button>
                  {menuNoteId === note.frontmatter.id ? (
                    <div className="note-row__menu">
                      <button
                        type="button"
                        className="note-row__menu-item"
                        onClick={() => {
                          onSelect(note.frontmatter.id);
                          onRenameNote(note.frontmatter.id);
                          setMenuNoteId(null);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="note-row__menu-item danger"
                        onClick={() => {
                          onDeleteNote(note.frontmatter.id);
                          setMenuNoteId(null);
                        }}
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="note-list__footer">
        <button type="button" className="footer-btn" onClick={onOpenSettings}>
          <Settings size={16} />
          Settings
        </button>
        <button type="button" className="footer-btn" onClick={onLogout} disabled={logoutBusy}>
          <LogOut size={16} />
          {logoutBusy ? 'Signing out...' : 'Sign out'}
        </button>
        <button type="button" className="footer-btn" onClick={() => window.open('http://127.0.0.1:3000', '_blank')}>
          <HelpCircle size={16} />
          Help
        </button>
      </div>
    </aside>
  );
}

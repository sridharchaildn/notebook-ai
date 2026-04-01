import { getNoteSnippet } from '@notebook-ai/app-core';
import type { FolderNode, NoteDocument } from '@notebook-ai/contracts';
import {
  BookOpen,
  ChevronRight,
  Ellipsis,
  FolderPlus,
  HelpCircle,
  LogOut,
  PanelLeftClose,
  Search,
  Settings,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

type FolderViewKey = 'unfiled' | `folder:${string}` | null;
const ROOT_FOLDER_LABEL = 'Notes';

interface Props {
  notes: NoteDocument[];
  folders: FolderNode[];
  selectedId: string | null;
  selectedFolderId: string | null;
  selectedNoteIds: string[];
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
  onSelectFolder: (folderId: string | null) => void;
  onToggleNoteSelection: (id: string, checked: boolean) => void;
  onMoveSelectedNotes: (folderId: string | null) => void;
  onCreate: () => void;
  onCreateFolder: (name: string) => void;
  onOpenSettings: () => void;
  onOpenSplash: () => void;
  onCollapse: () => void;
  onLogout: () => void;
  onRenameNote: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveNote: (id: string, folderId: string | null) => void;
  onClearSelectedNotes: () => void;
  logoutBusy: boolean;
}

export function NoteList({
  notes,
  folders,
  selectedId,
  selectedFolderId,
  selectedNoteIds,
  search,
  onSearchChange,
  onSelect,
  onSelectFolder,
  onToggleNoteSelection,
  onMoveSelectedNotes,
  onCreate,
  onCreateFolder,
  onOpenSettings,
  onOpenSplash,
  onCollapse,
  onLogout,
  onRenameNote,
  onDeleteNote,
  onRenameFolder,
  onDeleteFolder,
  onMoveNote,
  onClearSelectedNotes,
  logoutBusy,
}: Props) {
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [bulkDestination, setBulkDestination] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'folders' | 'notes'>('folders');
  const [openFolderKey, setOpenFolderKey] = useState<FolderViewKey>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [confirmDeleteFolderId, setConfirmDeleteFolderId] = useState<string | null>(null);
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  function getFolderViewKey(folderId: string | null): FolderViewKey {
    return folderId ? `folder:${folderId}` : 'unfiled';
  }

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current) return;
      if (event.target instanceof Node && menuRef.current.contains(event.target)) return;
      setMenuKey(null);
      setConfirmDeleteFolderId(null);
    }

    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, []);

  useEffect(() => {
    if (selectedNoteIds.length === 0) {
      setBulkDestination(selectedFolderId ?? '');
    }
  }, [selectedFolderId, selectedNoteIds.length]);

  useEffect(() => {
    if (selectedId !== null || selectedFolderId === null) return;
    setOpenFolderKey(getFolderViewKey(selectedFolderId));
  }, [selectedFolderId, selectedId]);

  useEffect(() => {
    if (!openFolderKey || !openFolderKey.startsWith('folder:')) return;
    const folderId = openFolderKey.slice('folder:'.length);
    if (!folders.some((folder) => folder.id === folderId)) {
      setOpenFolderKey(null);
    }
  }, [openFolderKey, folders]);

  const notesByFolder = useMemo(() => {
    const grouped = new Map<string | null, NoteDocument[]>();
    grouped.set(null, []);
    for (const folder of folders) grouped.set(folder.id, []);
    for (const note of notes) {
      const key = note.frontmatter.folder_id ?? null;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(note);
    }
    return grouped;
  }, [notes, folders]);

  function renderNoteRow(note: NoteDocument) {
    const isActive = selectedId === note.frontmatter.id;
    const isChecked = selectedNoteIds.includes(note.frontmatter.id);
    const activeMenuKey = `note:${note.frontmatter.id}`;
    return (
      <div 
        key={note.frontmatter.id} 
        className={isActive ? 'note-row active' : 'note-row'}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', note.frontmatter.id);
          setDraggedNoteId(note.frontmatter.id);
        }}
        onDragEnd={() => {
          setDraggedNoteId(null);
          setDragOverFolderId(null);
        }}
      >
        <label className="note-row__checkbox">
          <input
            type="checkbox"
            checked={isChecked}
            onChange={(event) => onToggleNoteSelection(note.frontmatter.id, event.target.checked)}
          />
        </label>
        <button type="button" onClick={() => onSelect(note.frontmatter.id)} className="note-row__main">
          <span className="note-row__title">{note.frontmatter.title || 'Untitled note'}</span>
          <span className="note-row__meta">{new Date(note.frontmatter.updated_at).toLocaleString()}</span>
          <p className="note-row__snippet">{getNoteSnippet(note) || 'Start writing...'}</p>
          {note.frontmatter.tags.length > 0 ? (
            <div className="note-row__tags">
              {note.frontmatter.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="tag-pill">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </button>
        <div className="note-row__actions" ref={menuKey === activeMenuKey ? menuRef : null}>
          <button
            type="button"
            className="note-row__menu-trigger"
            aria-label={`Open actions for ${note.frontmatter.title || 'Untitled note'}`}
            onClick={(event) => {
              event.stopPropagation();
              setMenuKey((current) => (current === activeMenuKey ? null : activeMenuKey));
            }}
          >
            <Ellipsis size={14} />
          </button>
          {menuKey === activeMenuKey ? (
            <div className="note-row__menu">
              <button
                type="button"
                className="note-row__menu-item"
                onClick={() => {
                  onSelect(note.frontmatter.id);
                  onRenameNote(note.frontmatter.id);
                  setMenuKey(null);
                }}
              >
                Rename
              </button>
              {note.frontmatter.folder_id ? (
                <button
                  type="button"
                  className="note-row__menu-item"
                  onClick={() => {
                    onMoveNote(note.frontmatter.id, null);
                    setMenuKey(null);
                  }}
                >
                  Move to {ROOT_FOLDER_LABEL}
                </button>
              ) : null}
              {folders
                .filter((folder) => folder.id !== note.frontmatter.folder_id)
                .map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    className="note-row__menu-item"
                    onClick={() => {
                      onMoveNote(note.frontmatter.id, folder.id);
                      setMenuKey(null);
                    }}
                  >
                    Move to {folder.name}
                  </button>
                ))}
              <button
                type="button"
                className="note-row__menu-item danger"
                onClick={() => {
                  onDeleteNote(note.frontmatter.id);
                  setMenuKey(null);
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
  }

  function renderFolderEntry(label: string, folderId: string | null, items: NoteDocument[]) {
    const folder = folderId ? folders.find((entry) => entry.id === folderId) ?? null : null;
    const activeMenuKey = folder ? `folder:${folder.id}` : null;
    const isActiveFolder = selectedFolderId === folderId;
    const isOpen = openFolderKey === getFolderViewKey(folderId);
    const isRenamingFolder = folder !== null && renamingFolderId === folderId;

    return (
      <section key={folderId ?? 'unfiled'} className="folder-section">
        <div 
          className={`folder-section__header${isActiveFolder ? ' is-active' : ''}${dragOverFolderId === folderId ? ' is-drag-over' : ''}`}
          onDragOver={(e) => {
            if (draggedNoteId && !items.some(n => n.frontmatter.id === draggedNoteId)) {
              e.preventDefault();
              setDragOverFolderId(folderId);
            }
          }}
          onDragLeave={() => {
            if (dragOverFolderId === folderId) setDragOverFolderId(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverFolderId(null);
            const noteId = e.dataTransfer.getData('text/plain');
            if (noteId && noteId === draggedNoteId) {
              onMoveNote(noteId, folderId);
            }
          }}
        >
          <button
            type="button"
            className="folder-section__header-button"
            onClick={() => {
              if (!isRenamingFolder) {
                const nextKey = getFolderViewKey(folderId);
                setOpenFolderKey((current) => (current === nextKey ? null : nextKey));
                onSelectFolder(folderId);
              }
            }}
          >
            <span className={`folder-section__chevron${isOpen ? ' is-open' : ''}`} aria-hidden="true">
              <ChevronRight size={14} />
            </span>
            {isRenamingFolder ? (
              <input
                autoFocus
                className="inline-folder-input"
                defaultValue={folder?.name || ''}
                onBlur={(e) => {
                  setRenamingFolderId(null);
                  if (folder && e.target.value.trim() && e.target.value.trim() !== folder.name) {
                    onRenameFolder(folder.id, e.target.value.trim());
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.currentTarget.blur();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setRenamingFolderId(null);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="folder-section__title">{label}</span>
            )}
            <span className="folder-section__count">{items.length}</span>
          </button>
          {folder && activeMenuKey ? (
            <div className="note-row__actions" ref={menuKey === activeMenuKey ? menuRef : null}>
              <button
                type="button"
                className="note-row__menu-trigger"
                aria-label={`Open actions for folder ${folder.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuKey((current) => (current === activeMenuKey ? null : activeMenuKey));
                }}
              >
                <Ellipsis size={14} />
              </button>
              {menuKey === activeMenuKey ? (
                <div className="note-row__menu">
                  <button
                    type="button"
                    className="note-row__menu-item"
                    onClick={() => {
                      setRenamingFolderId(folder.id);
                      setMenuKey(null);
                    }}
                  >
                    Rename folder
                  </button>
                  <button
                    type="button"
                    className="note-row__menu-item danger"
                    onClick={(e) => {
                      if (confirmDeleteFolderId === folder.id) {
                        onDeleteFolder(folder.id);
                        setConfirmDeleteFolderId(null);
                        setMenuKey(null);
                      } else {
                        e.stopPropagation();
                        setConfirmDeleteFolderId(folder.id);
                      }
                    }}
                  >
                    <Trash2 size={14} />
                    {confirmDeleteFolderId === folder.id ? 'Click to confirm' : 'Delete folder'}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {isOpen ? (
          <div className="folder-section__items">
            {items.length === 0 ? (
              <div className="folder-section__empty">No notes here yet.</div>
            ) : (
              items.map((note) => renderNoteRow(note))
            )}
          </div>
        ) : null}
      </section>
    );
  }

  const folderEntries = [
    renderFolderEntry(ROOT_FOLDER_LABEL, null, notesByFolder.get(null) ?? []),
    ...folders.map((folder) => renderFolderEntry(folder.name, folder.id, notesByFolder.get(folder.id) ?? [])),
  ];

  if (creatingFolder) {
    folderEntries.push(
      <section key="creating-folder" className="folder-section">
        <div className="folder-section__header is-active">
          <div className="folder-section__header-button" style={{ paddingLeft: '6px' }}>
            <input
              autoFocus
              className="inline-folder-input"
              placeholder="Folder name"
              onBlur={(e) => {
                setCreatingFolder(false);
                if (e.target.value.trim()) {
                  onCreateFolder(e.target.value.trim());
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setCreatingFolder(false);
                }
              }}
            />
          </div>
        </div>
      </section>
    );
  }

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
        <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search notes..." />
      </div>

      <div className="note-list__tabs">
        <button
          type="button"
          className={activeTab === 'folders' ? 'active' : ''}
          onClick={() => setActiveTab('folders')}
        >
          Folders
        </button>
        <button
          type="button"
          className={activeTab === 'notes' ? 'active' : ''}
          onClick={() => {
            setActiveTab('notes');
            setOpenFolderKey(null);
            if (selectedId === null) {
              onSelectFolder(null);
            }
          }}
        >
          All Notes
        </button>
      </div>

      <div className="note-list__create-actions">
        <button type="button" className="solid-btn" onClick={onCreate} style={{ width: '100%', justifyContent: 'center' }}>
          <SquarePen size={14} />
          New Note
        </button>
        <button type="button" className="ghost-btn" onClick={() => setCreatingFolder(true)} style={{ width: '100%', justifyContent: 'center' }}>
          <FolderPlus size={14} />
          New Folder
        </button>
      </div>

      {selectedNoteIds.length > 0 ? (
        <div className="note-list__bulk-bar">
          <div className="note-list__bulk-copy">{selectedNoteIds.length} selected</div>
          <select value={bulkDestination} onChange={(event) => setBulkDestination(event.target.value)}>
            <option value="">{ROOT_FOLDER_LABEL}</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ghost-btn ghost-btn--compact"
            onClick={() => onMoveSelectedNotes(bulkDestination || null)}
          >
            Move
          </button>
          <button
            type="button"
            className="ghost-btn ghost-btn--icon"
            onClick={onClearSelectedNotes}
            aria-label="Clear selected notes"
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      <div className="note-list__items">
        {notes.length === 0 && folders.length === 0 ? (
          <p className="empty-state">No notes yet. Create your first note or folder.</p>
        ) : activeTab === 'folders' ? (
          folderEntries
        ) : notes.length === 0 ? (
          <p className="empty-state">No notes yet.</p>
        ) : (
          notes.map((note) => renderNoteRow(note))
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

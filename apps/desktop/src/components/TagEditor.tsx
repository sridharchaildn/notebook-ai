import { X } from 'lucide-react';
import type { KeyboardEvent } from 'react';

interface Props {
  tags: string[];
  draftValue: string;
  onDraftChange: (value: string) => void;
  onCommitDraft: () => void;
  onRemoveTag: (tag: string) => void;
  onRemoveLastTag: () => void;
}

export function TagEditor({
  tags,
  draftValue,
  onDraftChange,
  onCommitDraft,
  onRemoveTag,
  onRemoveLastTag,
}: Props) {
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      onCommitDraft();
      return;
    }
    if (event.key === 'Backspace' && draftValue.trim().length === 0 && tags.length > 0) {
      event.preventDefault();
      onRemoveLastTag();
    }
  }

  return (
    <label className="tag-editor" aria-label="Tags">
      <span className="tag-editor__label">Tags</span>
      <div className="tag-editor__surface">
        {tags.map((tag) => (
          <span key={tag.toLowerCase()} className="tag-chip">
            <span>{tag}</span>
            <button
              type="button"
              className="tag-chip__remove"
              aria-label={`Remove ${tag}`}
              onClick={() => onRemoveTag(tag)}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          value={draftValue}
          onChange={(event) => onDraftChange(event.target.value)}
          onBlur={onCommitDraft}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? 'Add tags' : 'Add another tag'}
        />
      </div>
    </label>
  );
}

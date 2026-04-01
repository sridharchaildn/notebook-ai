import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import StarterKit from '@tiptap/starter-kit';
import { EditorContent, useEditor } from '@tiptap/react';
import {
  Bold,
  CheckSquare,
  Code2,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  Quote,
  Table2,
} from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const turndownService = new TurndownService({
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  headingStyle: 'atx',
});

turndownService.use(gfm);

function markdownToHtml(markdown: string): string {
  const rendered = marked.parse(markdown ?? '');
  return typeof rendered === 'string' ? rendered : '';
}

function htmlToMarkdown(html: string): string {
  const markdown = turndownService.turndown(html || '');
  return markdown.replace(/\n{3,}/g, '\n\n').trimEnd();
}

interface ToolbarButtonProps {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function ToolbarButton({ active = false, disabled = false, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={`ghost-btn ghost-btn--compact${active ? ' active' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function RichMarkdownEditor({ value, onChange, placeholder = 'Write your thoughts here...' }: Props) {
  const lastMarkdownRef = useRef(value);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({ placeholder }),
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: markdownToHtml(value),
    editorProps: {
      attributes: {
        class: 'rich-markdown-editor__content-surface',
      },
    },
    onUpdate({ editor: currentEditor }) {
      const nextMarkdown = htmlToMarkdown(currentEditor.getHTML());
      lastMarkdownRef.current = nextMarkdown;
      onChange(nextMarkdown);
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (value === lastMarkdownRef.current) return;
    lastMarkdownRef.current = value;
    editor.commands.setContent(markdownToHtml(value), false);
  }, [editor, value]);

  function toggleLink() {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href as string | undefined;
    const nextUrl = window.prompt('Enter link URL', previousUrl ?? 'https://');
    if (nextUrl === null) return;
    if (!nextUrl.trim()) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: nextUrl.trim() }).run();
  }

  return (
    <section className="rich-markdown-editor">
      <div className="rich-markdown-editor__toolbar">
        <ToolbarButton
          active={editor?.isActive('bold')}
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold size={14} />
          Bold
        </ToolbarButton>
        <ToolbarButton
          active={editor?.isActive('italic')}
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic size={14} />
          Italic
        </ToolbarButton>
        <ToolbarButton
          active={editor?.isActive('heading', { level: 1 })}
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          <Heading1 size={14} />
          H1
        </ToolbarButton>
        <ToolbarButton
          active={editor?.isActive('heading', { level: 2 })}
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 size={14} />
          H2
        </ToolbarButton>
        <ToolbarButton
          active={editor?.isActive('bulletList')}
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <List size={14} />
          List
        </ToolbarButton>
        <ToolbarButton
          active={editor?.isActive('taskList')}
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleTaskList().run()}
        >
          <CheckSquare size={14} />
          Tasks
        </ToolbarButton>
        <ToolbarButton
          active={editor?.isActive('blockquote')}
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          <Quote size={14} />
          Quote
        </ToolbarButton>
        <ToolbarButton
          active={editor?.isActive('codeBlock')}
          disabled={!editor}
          onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
        >
          <Code2 size={14} />
          Code
        </ToolbarButton>
        <ToolbarButton active={editor?.isActive('link')} disabled={!editor} onClick={toggleLink}>
          <Link2 size={14} />
          Link
        </ToolbarButton>
        <ToolbarButton
          disabled={!editor}
          onClick={() =>
            editor
              ?.chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
        >
          <Table2 size={14} />
          Table
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} className="rich-markdown-editor__content" />
    </section>
  );
}

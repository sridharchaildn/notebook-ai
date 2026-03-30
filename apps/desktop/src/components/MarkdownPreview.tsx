import { Fragment } from 'react';

interface Props {
  content: string;
}

function renderInline(text: string) {
  return text;
}

export function MarkdownPreview({ content }: Props) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: Array<
    | { type: 'heading'; level: number; text: string }
    | { type: 'list'; items: string[] }
    | { type: 'paragraph'; text: string }
    | { type: 'code'; text: string }
  > = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      blocks.push({ type: 'code', text: codeLines.join('\n') });
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const items: string[] = [];
      while (index < lines.length) {
        const next = (lines[index] ?? '').trim();
        if (!(next.startsWith('- ') || next.startsWith('* '))) break;
        items.push(next.slice(2).trim());
        index += 1;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const next = lines[index] ?? '';
      const nextTrimmed = next.trim();
      if (!nextTrimmed) break;
      if (/^#{1,6}\s+/.test(nextTrimmed) || nextTrimmed.startsWith('- ') || nextTrimmed.startsWith('* ') || nextTrimmed.startsWith('```')) {
        break;
      }
      paragraphLines.push(nextTrimmed);
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') });
  }

  return (
    <article className="markdown-preview">
      {blocks.length === 0 ? (
        <p className="markdown-preview__empty">Nothing to preview yet.</p>
      ) : (
        blocks.map((block, blockIndex) => {
          if (block.type === 'heading') {
            const Tag = `h${Math.min(6, Math.max(1, block.level))}` as keyof JSX.IntrinsicElements;
            return (
              <Tag key={`heading-${blockIndex}`} className={`markdown-preview__heading markdown-preview__heading--${block.level}`}>
                {renderInline(block.text)}
              </Tag>
            );
          }

          if (block.type === 'list') {
            return (
              <ul key={`list-${blockIndex}`} className="markdown-preview__list">
                {block.items.map((item, itemIndex) => (
                  <li key={`list-${blockIndex}-${itemIndex}`}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          }

          if (block.type === 'code') {
            return (
              <pre key={`code-${blockIndex}`} className="markdown-preview__code">
                <code>{block.text}</code>
              </pre>
            );
          }

          return (
            <p key={`paragraph-${blockIndex}`} className="markdown-preview__paragraph">
              {block.text.split('\n').map((segment, segmentIndex) => (
                <Fragment key={`paragraph-${blockIndex}-${segmentIndex}`}>
                  {renderInline(segment)}
                </Fragment>
              ))}
            </p>
          );
        })
      )}
    </article>
  );
}

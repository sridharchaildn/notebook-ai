import { describe, expect, it } from 'vitest';

import { buildTranscriptFromSegments, commitTag, removeTag } from './noteMetadata';

describe('note metadata helpers', () => {
  it('commits tags once and de-duplicates case-insensitively', () => {
    expect(commitTag([], '  Launch  ')).toEqual(['Launch']);
    expect(commitTag(['Launch'], 'launch')).toEqual(['Launch']);
  });

  it('removes tags case-insensitively', () => {
    expect(removeTag(['Launch', 'Meeting'], 'meeting')).toEqual(['Launch']);
  });

  it('builds source-aware transcript text from segments', () => {
    expect(
      buildTranscriptFromSegments([
        { id: '1', text: 'I can take that action item.', source_hint: 'me' },
        { id: '2', text: 'Can you send the deck tomorrow?', source_hint: 'other_audio' },
      ]),
    ).toContain('Me:\nI can take that action item.');
  });
});

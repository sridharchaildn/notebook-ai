import { describe, expect, it } from 'vitest';
import {
  getInterviewSession,
  getNotePrimaryText,
  getNoteSnippet,
  getTranscriptSession,
  isInterviewNote,
  isMarkdownNote,
  isTranscriptNote,
} from '@notebook-ai/app-core';
import type { NoteDocument } from '@notebook-ai/contracts';

function buildNote(overrides: Partial<NoteDocument>): NoteDocument {
  return {
    frontmatter: {
      id: 'note-1',
      title: 'Test note',
      created_at: '2026-03-26T00:00:00.000Z',
      updated_at: '2026-03-26T00:00:00.000Z',
      tags: [],
      folder_id: null,
      provider: undefined,
      model: undefined,
    },
    kind: 'note',
    content_format: 'plain_text',
    content: '',
    session: null,
    ...overrides,
  };
}

describe('app-core note helpers', () => {
  it('strips markdown syntax from snippets and primary text', () => {
    const note = buildNote({
      content_format: 'markdown',
      content: '# Heading\n\n- first item\n- second item',
    });

    expect(isMarkdownNote(note)).toBe(true);
    expect(getNotePrimaryText(note)).toBe('Heading\n\nfirst item\nsecond item');
    expect(getNoteSnippet(note)).toContain('Heading');
    expect(getNoteSnippet(note)).not.toContain('#');
    expect(getNoteSnippet(note)).not.toContain('- ');
  });

  it('reads transcript session text from structured session data', () => {
    const note = buildNote({
      kind: 'transcript',
      content: '',
      session: {
        session_type: 'transcript',
        transcript: 'Transcript body',
        last_updated_at: '2026-03-26T00:00:00.000Z',
      },
    });

    expect(isTranscriptNote(note)).toBe(true);
    expect(getTranscriptSession(note)?.transcript).toBe('Transcript body');
    expect(getNotePrimaryText(note)).toBe('Transcript body');
  });

  it('reads interview guidance and transcript from structured interview sessions', () => {
    const note = buildNote({
      kind: 'interview_assist',
      content: '',
      session: {
        session_type: 'interview_assist',
        transcript: 'Interviewer: Tell me about yourself.',
        guidance: 'I have five years of backend experience.',
        turns: [
          { id: '1', role: 'interviewer', text: 'Tell me about yourself.' },
        ],
        last_coached_interviewer_turn_id: '1',
        last_updated_at: '2026-03-26T00:00:00.000Z',
      },
    });

    expect(isInterviewNote(note)).toBe(true);
    expect(getInterviewSession(note)?.guidance).toContain('backend experience');
    expect(getNotePrimaryText(note)).toContain('Tell me about yourself');
    expect(getNotePrimaryText(note)).toContain('backend experience');
  });
});

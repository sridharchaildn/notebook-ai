import type {
  InterviewSessionData,
  NoteDocument,
  TranscriptSessionData,
} from '@notebook-ai/contracts';

function stripMarkdownSyntax(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_{1,2}(.*?)_{1,2}/g, '$1');
}

export function isInterviewNote(note: NoteDocument | null | undefined): boolean {
  return note?.kind === 'interview_assist';
}

export function isTranscriptNote(note: NoteDocument | null | undefined): boolean {
  return note?.kind === 'transcript';
}

export function isMarkdownNote(note: NoteDocument | null | undefined): boolean {
  return note?.kind === 'note' && note?.content_format === 'markdown';
}

export function getTranscriptSession(note: NoteDocument | null | undefined): TranscriptSessionData | null {
  if (!note?.session || note.session.session_type !== 'transcript') return null;
  return note.session;
}

export function getInterviewSession(note: NoteDocument | null | undefined): InterviewSessionData | null {
  if (!note?.session || note.session.session_type !== 'interview_assist') return null;
  return note.session;
}

export function getNotePrimaryText(note: NoteDocument | null | undefined): string {
  if (!note) return '';

  if (note.kind === 'interview_assist') {
    const session = getInterviewSession(note);
    return [session?.transcript ?? note.content, session?.guidance ?? '']
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }

  if (note.kind === 'transcript') {
    return getTranscriptSession(note)?.transcript?.trim() || note.content.trim();
  }

  return note.content_format === 'markdown'
    ? stripMarkdownSyntax(note.content).trim()
    : note.content.trim();
}

export function getNoteSnippet(note: NoteDocument | null | undefined, maxLength = 92): string {
  const text = getNotePrimaryText(note).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…` : text;
}

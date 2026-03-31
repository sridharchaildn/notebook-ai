import type { NoteContextPreset, SourceHint, TranscriptSegment } from '@notebook-ai/contracts';

export const NOTE_CONTEXT_PRESETS: NoteContextPreset[] = ['meeting', 'podcast', 'youtube', 'custom'];

export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function commitTag(existing: string[], raw: string): string[] {
  const normalized = normalizeTag(raw);
  if (!normalized) return existing;
  const lower = normalized.toLowerCase();
  if (existing.some((tag) => tag.toLowerCase() === lower)) {
    return existing;
  }
  return [...existing, normalized];
}

export function removeTag(existing: string[], target: string): string[] {
  const lower = target.trim().toLowerCase();
  return existing.filter((tag) => tag.trim().toLowerCase() !== lower);
}

export function sourceHintLabel(sourceHint: SourceHint | null | undefined): string {
  if (sourceHint === 'me') return 'Me';
  if (sourceHint === 'other_audio') return 'Speaker';
  return 'Speaker';
}

export function buildTranscriptFromSegments(
  segments: TranscriptSegment[] | null | undefined,
  fallbackTranscript = '',
): string {
  if (!segments || segments.length === 0) {
    return fallbackTranscript.trim();
  }

  const blocks = segments
    .map((segment) => {
      const text = segment.text.trim();
      if (!text) return '';
      return `${sourceHintLabel(segment.source_hint)}:\n${text}`;
    })
    .filter(Boolean);

  return blocks.length > 0 ? blocks.join('\n\n') : fallbackTranscript.trim();
}

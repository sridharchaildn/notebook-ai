import type { NoteContextPreset } from '@notebook-ai/contracts';

import { NOTE_CONTEXT_PRESETS } from '../lib/noteMetadata';

const PRESET_LABELS: Record<NoteContextPreset, { label: string; hint: string; placeholder: string }> = {
  meeting: {
    label: 'Meeting',
    hint: 'Good for calls, standups, customer meetings, and reviews.',
    placeholder: 'Meeting with X about hiring, launch planning, or status review',
  },
  podcast: {
    label: 'Podcast',
    hint: 'Bias summaries toward hosts, guests, and discussion topics.',
    placeholder: 'Podcast episode about AI products, growth, or engineering',
  },
  youtube: {
    label: 'YouTube',
    hint: 'Useful for videos, demos, explainers, and tutorials.',
    placeholder: 'YouTube video about Kafka basics, React, or product design',
  },
  custom: {
    label: 'Custom',
    hint: 'Use your own framing when the note does not fit the presets.',
    placeholder: 'This is a lecture, sales call, workshop, or something else',
  },
};

interface Props {
  preset: NoteContextPreset;
  text: string;
  onPresetChange: (preset: NoteContextPreset) => void;
  onTextChange: (value: string) => void;
}

export function NoteContextEditor({ preset, text, onPresetChange, onTextChange }: Props) {
  const copy = PRESET_LABELS[preset];

  return (
    <section className="context-editor" aria-label="Note context">
      <div className="context-editor__header">
        <span className="context-editor__label">Context</span>
        <span className="context-editor__hint">{copy.hint}</span>
      </div>
      <div className="context-editor__presets" role="tablist" aria-label="Context presets">
        {NOTE_CONTEXT_PRESETS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={`context-editor__preset${candidate === preset ? ' active' : ''}`}
            onClick={() => onPresetChange(candidate)}
          >
            {PRESET_LABELS[candidate].label}
          </button>
        ))}
      </div>
      <input
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        className="context-editor__input"
        placeholder={copy.placeholder}
      />
    </section>
  );
}

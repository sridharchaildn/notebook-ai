import type { AITransformType } from '@notebook-ai/contracts';
import { LoaderCircle, Sparkles } from 'lucide-react';

interface Props {
  output: string;
  running: boolean;
  onRun: (action: AITransformType) => void;
}

const actions: Array<{ id: AITransformType; label: string; description: string }> = [
  {
    id: 'summarize',
    label: 'Summarize',
    description: 'Turn long notes into a compact brief.',
  },
  {
    id: 'rewrite',
    label: 'Rewrite',
    description: 'Refine tone and clarity while preserving meaning.',
  },
  {
    id: 'extract_action_items',
    label: 'Action Items',
    description: 'Extract concrete tasks with clear ownership intent.',
  },
];

export function AIActionPanel({ output, running, onRun }: Props) {
  return (
    <section className="ai-panel">
      <div className="section-title-row">
        <h2>AI Copilot</h2>
        {running ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
      </div>

      <div className="ai-actions">
        {actions.map((action) => (
          <button
            type="button"
            key={action.id}
            disabled={running}
            className="ai-action"
            onClick={() => onRun(action.id)}
          >
            <strong>{action.label}</strong>
            <span>{action.description}</span>
          </button>
        ))}
      </div>

      <div className="ai-output" role="status" aria-live="polite">
        {output || 'AI output appears here as tokens stream in.'}
      </div>
    </section>
  );
}

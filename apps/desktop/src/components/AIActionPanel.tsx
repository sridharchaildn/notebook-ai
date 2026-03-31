import type { AITransformType, CopilotChatMessage } from '@notebook-ai/contracts';
import { FileText, ListChecks, LoaderCircle, MessageSquareText, Send, Sparkles, Wand2 } from 'lucide-react';

interface Props {
  output: string;
  running: boolean;
  runningAction: AITransformType | null;
  onRun: (action: AITransformType) => void;
  onStopTransform: () => void;
  transcriptChatEnabled: boolean;
  chatDraft: string;
  chatHistory: CopilotChatMessage[];
  chatBusy: boolean;
  onChatDraftChange: (value: string) => void;
  onSendChat: () => void;
  onStopChat: () => void;
  onClearChat: () => void;
}

const actions: Array<{ id: AITransformType; label: string; description: string; icon: React.ReactNode }> = [
  {
    id: 'summarize',
    label: 'Summarize',
    description: 'Turn long notes into a compact brief.',
    icon: <FileText size={16} />,
  },
  {
    id: 'rewrite',
    label: 'Rewrite',
    description: 'Refine tone and clarity while preserving meaning.',
    icon: <Wand2 size={16} />,
  },
  {
    id: 'extract_action_items',
    label: 'Action Items',
    description: 'Extract concrete tasks with clear ownership intent.',
    icon: <ListChecks size={16} />,
  },
];

export function AIActionPanel({
  output,
  running,
  runningAction,
  onRun,
  onStopTransform,
  transcriptChatEnabled,
  chatDraft,
  chatHistory,
  chatBusy,
  onChatDraftChange,
  onSendChat,
  onStopChat,
  onClearChat,
}: Props) {
  const runningCopy =
    runningAction === 'summarize'
      ? 'Generating summary...'
      : runningAction === 'rewrite'
        ? 'Rewriting note...'
        : runningAction === 'extract_action_items'
          ? 'Extracting action items...'
          : 'Working...';

  return (
    <section className="ai-panel">
      <div className="section-title-row">
        <h2>AI Copilot</h2>
        <div className="transcription-panel__header-actions">
          {running ? (
            <>
              <LoaderCircle size={16} className="spin" />
              <button type="button" className="ghost-btn ghost-btn--compact" onClick={onStopTransform}>
                Stop
              </button>
            </>
          ) : (
            <Sparkles size={16} style={{ color: 'var(--primary)' }} />
          )}
        </div>
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
            <div className="ai-action__icon">
              {action.icon}
            </div>
            <div className="ai-action__content">
              <strong>{action.label}</strong>
              <span>{action.description}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="ai-output" role="status" aria-live="polite">
        {output || (running ? runningCopy : 'AI output appears here as tokens stream in.')}
      </div>

      {transcriptChatEnabled ? (
        <section className="copilot-chat">
          <div className="copilot-chat__header">
            <div>
              <h3>Ask Copilot</h3>
              <p>Ask about this transcript, the context, or who said what.</p>
            </div>
            <button type="button" className="ghost-btn" onClick={onClearChat} disabled={chatBusy || chatHistory.length === 0}>
              Clear
            </button>
          </div>
          <div className="copilot-chat__messages">
            {chatHistory.length === 0 ? (
              <div className="copilot-chat__empty">
                <MessageSquareText size={16} />
                <span>Ask a question like “What did I commit to?” or “Summarize the other side’s concerns.”</span>
              </div>
            ) : (
              chatHistory.map((message, index) => (
                <article key={`${message.role}-${index}`} className={`copilot-chat__message ${message.role}`}>
                  <div className="copilot-chat__role">{message.role === 'user' ? 'You' : 'Copilot'}</div>
                  <div className="copilot-chat__content">{message.content || (chatBusy ? 'Thinking…' : '')}</div>
                </article>
              ))
            )}
          </div>
          <div className="copilot-chat__composer">
            <textarea
              value={chatDraft}
              onChange={(event) => onChatDraftChange(event.target.value)}
              placeholder="Ask Copilot about this transcript..."
              rows={3}
            />
            <button
              type="button"
              className="solid-btn"
              disabled={!chatBusy && chatDraft.trim().length === 0}
              onClick={chatBusy ? onStopChat : onSendChat}
            >
              <Send size={14} />
              {chatBusy ? 'Stop' : 'Send'}
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );
}

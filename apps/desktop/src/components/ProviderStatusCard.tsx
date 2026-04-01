import type { ProviderConnection } from '@notebook-ai/contracts';
import { CircleCheckBig, CircleDashed, KeyRound } from 'lucide-react';

interface Props {
  providers: ProviderConnection[];
  byokProvider: 'openai' | 'openrouter';
  byokValue: string;
  byokSubmitting: boolean;
  onByokProviderChange: (value: 'openai' | 'openrouter') => void;
  onByokValueChange: (value: string) => void;
  onSaveByok: () => void;
}

const providerLabel: Record<ProviderConnection['provider'], string> = {
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
};

export function ProviderStatusCard({
  providers,
  byokProvider,
  byokValue,
  byokSubmitting,
  onByokProviderChange,
  onByokValueChange,
  onSaveByok,
}: Props) {
  return (
    <section className="provider-panel">
      <div className="section-title-row">
        <h2>Providers</h2>
      </div>

      <div className="provider-status-grid">
        {providers.map((entry) => (
          <article key={entry.provider} className="provider-chip">
            <div className="provider-chip__title">
              <span>{providerLabel[entry.provider]}</span>
              {entry.connected ? (
                <CircleCheckBig size={14} className="ok" />
              ) : (
                <CircleDashed size={14} className="muted" />
              )}
            </div>
            <small>
              {entry.connected
                ? `Connected via ${entry.via}; ${entry.scope === 'desktop_local' ? 'stored locally on this device' : 'source unavailable'}.`
                : 'No local key saved on this device.'}
            </small>
          </article>
        ))}
      </div>

      <div className="byok-form">
        <label>
          Provider
          <select
            value={byokProvider}
            onChange={(event) =>
              onByokProviderChange(event.target.value as 'openai' | 'openrouter')
            }
          >
            <option value="openai">OpenAI</option>
            <option value="openrouter">OpenRouter</option>
          </select>
        </label>

        <label>
          API key
          <input
            type="password"
            value={byokValue}
            onChange={(event) => onByokValueChange(event.target.value)}
            placeholder="sk-..."
          />
        </label>

        <button type="button" className="solid-btn" disabled={byokSubmitting} onClick={onSaveByok}>
          <KeyRound size={15} />
          {byokSubmitting ? 'Saving...' : 'Save key'}
        </button>
      </div>
    </section>
  );
}

import type { ProviderId, ProviderModel } from '@notebook-ai/contracts';
import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

export const providerLabel: Record<ProviderId, string> = {
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
};

type BrandKey =
  | 'openai'
  | 'openrouter'
  | 'anthropic'
  | 'google'
  | 'meta'
  | 'xai'
  | 'mistral'
  | 'deepseek'
  | 'amazon'
  | 'alibaba'
  | 'cohere'
  | 'microsoft'
  | 'perplexity'
  | 'moonshot'
  | 'unknown';

interface BrandInfo {
  key: BrandKey;
  label: string;
  initials: string;
}

export function inferBrandFromModel(model: ProviderModel): BrandInfo {
  const namespace = model.id.includes('/') ? model.id.split('/')[0]!.toLowerCase() : model.provider;
  const normalized = namespace.replace(/[_\s]+/g, '-');
  const aliasMap: Record<string, BrandInfo> = {
    openai: { key: 'openai', label: 'OpenAI', initials: 'AI' },
    openrouter: { key: 'openrouter', label: 'OpenRouter', initials: 'OR' },
    anthropic: { key: 'anthropic', label: 'Anthropic', initials: 'AN' },
    google: { key: 'google', label: 'Google', initials: 'G' },
    'google-vertex': { key: 'google', label: 'Google', initials: 'G' },
    'google-ai-studio': { key: 'google', label: 'Google', initials: 'G' },
    meta: { key: 'meta', label: 'Meta', initials: 'M' },
    'meta-llama': { key: 'meta', label: 'Meta', initials: 'M' },
    'x-ai': { key: 'xai', label: 'xAI', initials: 'x' },
    xai: { key: 'xai', label: 'xAI', initials: 'x' },
    mistral: { key: 'mistral', label: 'Mistral', initials: 'M' },
    mistralai: { key: 'mistral', label: 'Mistral', initials: 'M' },
    deepseek: { key: 'deepseek', label: 'DeepSeek', initials: 'DS' },
    amazon: { key: 'amazon', label: 'Amazon', initials: 'AZ' },
    alibaba: { key: 'alibaba', label: 'Alibaba', initials: 'AB' },
    qwen: { key: 'alibaba', label: 'Alibaba Qwen', initials: 'QW' },
    cohere: { key: 'cohere', label: 'Cohere', initials: 'CO' },
    microsoft: { key: 'microsoft', label: 'Microsoft', initials: 'MS' },
    perplexity: { key: 'perplexity', label: 'Perplexity', initials: 'PX' },
    moonshotai: { key: 'moonshot', label: 'Moonshot', initials: 'MS' },
  };
  return aliasMap[normalized] ?? {
    key: 'unknown',
    label: namespace
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || providerLabel[model.provider],
    initials: (namespace.replace(/[^a-z0-9]/g, '').slice(0, 2) || providerLabel[model.provider].slice(0, 2)).toUpperCase(),
  };
}

export function displayModelName(model: ProviderModel): string {
  return model.label?.trim() || model.id;
}

export function displayModelSubline(model: ProviderModel): string {
  const brand = inferBrandFromModel(model).label;
  return displayModelName(model) === model.id ? brand : `${brand} • ${model.id}`;
}

function inferBrandLabel(brand: BrandKey): BrandInfo {
  const fallbackMap: Record<BrandKey, BrandInfo> = {
    openai: { key: 'openai', label: 'OpenAI', initials: 'AI' },
    openrouter: { key: 'openrouter', label: 'OpenRouter', initials: 'OR' },
    anthropic: { key: 'anthropic', label: 'Anthropic', initials: 'AN' },
    google: { key: 'google', label: 'Google', initials: 'G' },
    meta: { key: 'meta', label: 'Meta', initials: 'M' },
    xai: { key: 'xai', label: 'xAI', initials: 'x' },
    mistral: { key: 'mistral', label: 'Mistral', initials: 'M' },
    deepseek: { key: 'deepseek', label: 'DeepSeek', initials: 'DS' },
    amazon: { key: 'amazon', label: 'Amazon', initials: 'AZ' },
    alibaba: { key: 'alibaba', label: 'Alibaba', initials: 'AB' },
    cohere: { key: 'cohere', label: 'Cohere', initials: 'CO' },
    microsoft: { key: 'microsoft', label: 'Microsoft', initials: 'MS' },
    perplexity: { key: 'perplexity', label: 'Perplexity', initials: 'PX' },
    moonshot: { key: 'moonshot', label: 'Moonshot', initials: 'MS' },
    unknown: { key: 'unknown', label: 'Model', initials: 'ML' },
  };
  return fallbackMap[brand];
}

export function BrandMark({ brand }: { brand: BrandKey }) {
  if (brand === 'openai') {
    return (
      <span className={`provider-mark provider-mark--${brand}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.042 6.042 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073ZM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494ZM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646ZM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872v.024Zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667Zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66v.018Zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.392.682l-.005 6.72ZM9.4 10.025l2.6-1.5 2.6 1.5v3l-2.6 1.502-2.6-1.502Z" />
        </svg>
      </span>
    );
  }

  if (brand === 'openrouter') {
    return (
      <span className={`provider-mark provider-mark--${brand}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
          <circle cx="6" cy="12" r="1.8" fill="currentColor" stroke="none" />
          <circle cx="18" cy="7" r="1.8" fill="currentColor" stroke="none" />
          <circle cx="18" cy="17" r="1.8" fill="currentColor" stroke="none" />
          <path d="M7.9 12h4.3" strokeLinecap="round" />
          <path d="M12 12l4.2-4.1" strokeLinecap="round" />
          <path d="M12 12l4.2 4.1" strokeLinecap="round" />
        </svg>
      </span>
    );
  }

  if (brand === 'anthropic') {
    return (
      <span className={`provider-mark provider-mark--${brand}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
          <path d="M6 19L12 5l6 14" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8.5 13h7" strokeLinecap="round" />
        </svg>
      </span>
    );
  }

  if (brand === 'google') {
    return (
      <span className={`provider-mark provider-mark--${brand}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" width="16" height="16">
          <path d="M20 12.2c0 4.5-3.1 7.8-8 7.8a8 8 0 1 1 0-16c2.2 0 4.1.8 5.6 2.2" strokeLinecap="round" />
          <path d="M12 12h8" strokeLinecap="round" />
          <path d="M20 8v4" strokeLinecap="round" />
        </svg>
      </span>
    );
  }

  if (brand === 'meta') {
    return (
      <span className={`provider-mark provider-mark--${brand}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
          <path d="M4 15.5c1.7-5.7 4-8.5 6.4-8.5 2.1 0 3.5 2.2 5.6 6.3 1.4 2.8 2.5 4.2 4 4.2 1.4 0 2-.9 2-2.3 0-3.2-1.9-8.2-5.2-8.2-2.7 0-4.4 2.7-4.8 4-.4-1.3-2.1-4-4.8-4C3.9 7 2 12 2 15.2c0 1.4.6 2.3 2 2.3 1.5 0 2.6-1.4 4-4.2Z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  if (brand === 'xai') {
    return (
      <span className={`provider-mark provider-mark--${brand}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </span>
    );
  }

  return (
    <span className={`provider-mark provider-mark--${brand}`} aria-hidden="true">
      <span className="provider-mark__text">{inferBrandLabel(brand).initials}</span>
    </span>
  );
}

export function ProviderMark({ provider }: { provider: ProviderId }) {
  return <BrandMark brand={provider} />;
}

interface ModelPickerProps {
  label: string;
  value: string;
  models: ProviderModel[];
  loading: boolean;
  disabled?: boolean;
  placeholder: string;
  onChange: (model: string) => void;
}

export function ModelPicker({
  label,
  value,
  models,
  loading,
  disabled = false,
  placeholder,
  onChange,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === value) ?? null,
    [models, value],
  );

  const filteredModels = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return models;
    return models.filter((model) => {
      const brand = inferBrandFromModel(model).label.toLowerCase();
      return (
        displayModelName(model).toLowerCase().includes(needle) ||
        model.id.toLowerCase().includes(needle) ||
        brand.includes(needle)
      );
    });
  }, [models, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const timer = window.setTimeout(() => {
      searchRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const selectedBrand = selectedModel ? inferBrandFromModel(selectedModel) : null;
  const triggerText = selectedModel ? displayModelName(selectedModel) : placeholder;
  const triggerSubline = selectedModel ? displayModelSubline(selectedModel) : 'Select a model';

  return (
    <label className="model-picker-field">
      {label}
      <div className={`model-picker${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`} ref={rootRef}>
        <button
          type="button"
          className="model-picker__trigger"
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            setOpen((current) => !current);
          }}
        >
          <span className="model-picker__value">
            {selectedBrand ? <BrandMark brand={selectedBrand.key} /> : null}
            <span className="model-picker__copy">
              <strong>{triggerText}</strong>
              <small>{triggerSubline}</small>
            </span>
          </span>
          <ChevronDown size={15} className={`model-picker__chevron${open ? ' is-open' : ''}`} />
        </button>

        {open ? (
          <div className="model-picker__menu">
            <div className="model-picker__search">
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search models..."
              />
            </div>
            <div className="model-picker__options">
              {loading ? (
                <div className="model-picker__empty">Loading models...</div>
              ) : filteredModels.length === 0 ? (
                <div className="model-picker__empty">No models match your search.</div>
              ) : (
                filteredModels.map((model) => {
                  const brand = inferBrandFromModel(model);
                  const selected = model.id === value;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      className={`model-picker__option${selected ? ' is-selected' : ''}`}
                      onClick={() => {
                        onChange(model.id);
                        setOpen(false);
                      }}
                    >
                      <BrandMark brand={brand.key} />
                      <span className="model-picker__option-copy">
                        <strong>{displayModelName(model)}</strong>
                        <small>{displayModelSubline(model)}</small>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ) : null}
      </div>
    </label>
  );
}

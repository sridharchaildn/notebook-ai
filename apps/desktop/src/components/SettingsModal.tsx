import type { ProviderConnection, ProviderId, ProviderModel, SyncStatus } from '@notebook-ai/contracts';
import {
  CircleCheckBig,
  CircleDashed,
  ChevronDown,
  Cloud,
  Folder,
  FolderSync,
  HardDrive,
  Keyboard,
  KeyRound,
  Link,
  Mic,
  Palette,
  Settings,
  Unplug,
  X,
  Zap,
  Waves,
  Brain,
  Info,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { syncPhaseLabel, syncProgressPercent } from '../lib/syncStatus';

type SettingsTab = 'general' | 'providers' | 'copilot' | 'transcription' | 'appearance' | 'shortcuts';

interface Props {
  open: boolean;
  onClose: () => void;
  /* Provider props */
  providers: ProviderConnection[];
  byokProvider: 'openai' | 'openrouter';
  byokValue: string;
  byokSubmitting: boolean;
  onByokProviderChange: (value: 'openai' | 'openrouter') => void;
  onByokValueChange: (value: string) => void;
  onSaveByok: () => void;
  onOpenOAuth: () => void;
  disconnectingProvider: ProviderId | null;
  onDisconnectProvider: (provider: ProviderId) => void;
  connectedProviders: ProviderId[];
  copilotProvider: ProviderId;
  copilotModel: string;
  copilotModels: ProviderModel[];
  copilotModelsLoading: boolean;
  copilotModelsError: string;
  onCopilotProviderChange: (provider: ProviderId) => void;
  onCopilotModelChange: (model: string) => void;
  /* Theme props */
  theme: 'light' | 'dark';
  onThemeChange: (theme: 'light' | 'dark') => void;
  /* Storage + account props */
  sessionUserId: string | null;
  logoutBusy: boolean;
  storageMode: 'local' | 'local_and_drive';
  localRootPath: string;
  storageBusy: boolean;
  syncPendingOps: number;
  syncStatus: SyncStatus | null;
  syncActionBusy: boolean;
  driveConnected: boolean;
  driveFolderName: string;
  driveStatusBusy: boolean;
  onStorageModeChange: (mode: 'local' | 'local_and_drive') => void;
  onChooseLocalFolder: () => void;
  onRunSyncNow: () => void;
  onLogout: () => void;
  transcriptionEngine: 'whisper' | 'llm';
  transcriptionProvider: ProviderId;
  transcriptionModel: string;
  transcriptionModels: ProviderModel[];
  transcriptionModelsLoading: boolean;
  transcriptionModelsError: string;
  onTranscriptionEngineChange: (engine: 'whisper' | 'llm') => void;
  onTranscriptionProviderChange: (provider: ProviderId) => void;
  onTranscriptionModelChange: (model: string) => void;
  onConnectDrive: () => void;
  onRefreshDriveStatus: () => void;
}

const providerLabel: Record<ProviderConnection['provider'], string> = {
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

function inferBrandFromModel(model: ProviderModel): BrandInfo {
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

function displayModelName(model: ProviderModel): string {
  return model.label?.trim() || model.id;
}

function displayModelSubline(model: ProviderModel): string {
  const brand = inferBrandFromModel(model).label;
  return displayModelName(model) === model.id ? brand : `${brand} • ${model.id}`;
}

function BrandMark({ brand }: { brand: BrandKey }) {
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

function ProviderMark({ provider }: { provider: ProviderId }) {
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

function ModelPicker({
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

const tabs: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
  { id: 'general', label: 'General', icon: <Settings size={16} /> },
  { id: 'providers', label: 'AI Connection', icon: <Zap size={16} /> },
  { id: 'copilot', label: 'Copilot', icon: <Brain size={16} /> },
  { id: 'transcription', label: 'Transcription', icon: <Mic size={16} /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={16} /> },
  { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard size={16} /> },
];

export function SettingsModal({
  open,
  onClose,
  providers,
  byokProvider,
  byokValue,
  byokSubmitting,
  onByokProviderChange,
  onByokValueChange,
  onSaveByok,
  onOpenOAuth,
  disconnectingProvider,
  onDisconnectProvider,
  connectedProviders,
  copilotProvider,
  copilotModel,
  copilotModels,
  copilotModelsLoading,
  copilotModelsError,
  onCopilotProviderChange,
  onCopilotModelChange,
  theme,
  onThemeChange,
  sessionUserId,
  logoutBusy,
  storageMode,
  localRootPath,
  storageBusy,
  syncPendingOps,
  syncStatus,
  syncActionBusy,
  driveConnected,
  driveFolderName,
  driveStatusBusy,
  onStorageModeChange,
  onChooseLocalFolder,
  onRunSyncNow,
  onLogout,
  transcriptionEngine,
  transcriptionProvider,
  transcriptionModel,
  transcriptionModels,
  transcriptionModelsLoading,
  transcriptionModelsError,
  onTranscriptionEngineChange,
  onTranscriptionProviderChange,
  onTranscriptionModelChange,
  onConnectDrive,
  onRefreshDriveStatus,
}: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('providers');
  const progressPercent = syncProgressPercent(syncStatus);
  const syncLabel = syncPhaseLabel(syncStatus);
  const selectedCopilotModel = copilotModels.find((model) => model.id === copilotModel) ?? null;
  const selectedCopilotBrand = selectedCopilotModel ? inferBrandFromModel(selectedCopilotModel) : null;
  const selectedTranscriptionModel =
    transcriptionModels.find((model) => model.id === transcriptionModel) ?? null;
  const selectedTranscriptionBrand = selectedTranscriptionModel
    ? inferBrandFromModel(selectedTranscriptionModel)
    : null;

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="settings-modal">
        {/* Tab navigation */}
        <nav className="settings-tabs">
          <div className="settings-tabs__header">Settings</div>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`settings-tab${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Tab content */}
        <div className="settings-content">
          {activeTab === 'providers' && (
            <>
              <h3>Connected Providers</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 12px' }}>
                Disconnect removes the saved key or OAuth token from the cloud vault and clears the local
                cache. Keys set only in the sidecar <code style={{ fontSize: '0.75rem' }}>.env</code> still
                count as connected until you remove them there.
              </p>
              <div className="provider-status-grid">
                {providers.map((entry) => (
                  <article key={entry.provider} className="provider-chip">
                    <div className="provider-chip__title">
                      <span className="provider-label">
                        <ProviderMark provider={entry.provider} />
                        <span>{providerLabel[entry.provider]}</span>
                      </span>
                      {entry.connected ? (
                        <span className="connected-badge success">
                          <CircleCheckBig size={12} /> Connected
                        </span>
                      ) : (
                        <span className="connected-badge warning">
                          <CircleDashed size={12} /> Not connected
                        </span>
                      )}
                    </div>
                    <small>
                      {entry.connected
                        ? `Connected via ${entry.via}`
                        : 'No active connection'}
                    </small>
                    {entry.connected ? (
                      <div className="provider-chip__actions">
                        <button
                          type="button"
                          className="ghost-btn provider-disconnect-btn"
                          disabled={disconnectingProvider === entry.provider}
                          onClick={() => onDisconnectProvider(entry.provider)}
                        >
                          <Unplug size={14} aria-hidden />
                          {disconnectingProvider === entry.provider ? 'Disconnecting...' : 'Disconnect'}
                        </button>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>

              <h3>Add Provider</h3>
              <div className="provider-actions">
                <button type="button" className="cta-btn" onClick={onOpenOAuth} style={{ width: '100%', justifyContent: 'center' }}>
                  <Link size={15} />
                  Connect via OAuth
                </button>
              </div>

              <div className="settings-divider">or</div>

              <h3>Bring Your Own Key</h3>
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
            </>
          )}

          {activeTab === 'appearance' && (
            <>
              <h3>Theme</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className={`settings-tab${theme === 'light' ? ' active' : ''}`}
                  onClick={() => onThemeChange('light')}
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  ☀️ Light
                </button>
                <button
                  type="button"
                  className={`settings-tab${theme === 'dark' ? ' active' : ''}`}
                  onClick={() => onThemeChange('dark')}
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  🌙 Dark
                </button>
              </div>
            </>
          )}

          {activeTab === 'copilot' && (
            <>
              <h3>Copilot Defaults</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', marginBottom: '16px' }}>
                Choose the provider and model used for summaries, rewrites, action items, and interview coaching.
              </p>
              <div className="model-brand">
                {selectedCopilotBrand ? (
                  <BrandMark brand={selectedCopilotBrand.key} />
                ) : (
                  <ProviderMark provider={copilotProvider} />
                )}
                <div className="model-brand__copy">
                  <strong>
                    {selectedCopilotModel ? displayModelName(selectedCopilotModel) : providerLabel[copilotProvider]}
                  </strong>
                  <small>
                    {selectedCopilotModel
                      ? `${selectedCopilotBrand?.label ?? providerLabel[copilotProvider]} via ${providerLabel[copilotProvider]}`
                      : 'Choose the default model for Copilot.'}
                  </small>
                </div>
              </div>
              <div className="byok-form" style={{ marginTop: '16px' }}>
                <label>
                  Provider
                  <select
                    value={copilotProvider}
                    onChange={(event) => onCopilotProviderChange(event.target.value as ProviderId)}
                    disabled={connectedProviders.length === 0}
                  >
                    {connectedProviders.length === 0 ? (
                      <option value={copilotProvider}>Connect a provider first</option>
                    ) : (
                      connectedProviders.map((provider) => (
                        <option key={provider} value={provider}>
                          {providerLabel[provider]}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <ModelPicker
                  label="Copilot model"
                  value={copilotModel}
                  models={copilotModels}
                  loading={copilotModelsLoading}
                  disabled={connectedProviders.length === 0 || copilotModels.length === 0}
                  placeholder="Choose a Copilot model"
                  onChange={onCopilotModelChange}
                />
                {copilotModelsError ? (
                  <small style={{ color: 'var(--danger)' }}>{copilotModelsError}</small>
                ) : (
                  <small>Copilot uses this model across note transforms and interview guidance.</small>
                )}
              </div>
            </>
          )}

          {activeTab === 'general' && (
            <>
              <h3>General</h3>
              <div style={{ display: 'grid', gap: '10px' }}>
                <div className="provider-chip">
                  <div className="provider-chip__title">
                    <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                      <Cloud size={14} />
                      Account
                    </span>
                  </div>
                  <small>{sessionUserId ? 'Desktop session active.' : 'Not signed in yet.'}</small>
                  {sessionUserId ? (
                    <div style={{ marginTop: '8px' }}>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={onLogout}
                        disabled={logoutBusy}
                      >
                        <Unplug size={14} />
                        {logoutBusy ? 'Signing out...' : 'Sign out'}
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="provider-chip">
                  <div className="provider-chip__title">
                    <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                      <HardDrive size={14} />
                      Transcript Storage
                    </span>
                  </div>
                  <small>Choose local-only or local + Google Drive mirror.</small>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button
                      type="button"
                      className={`settings-tab${storageMode === 'local' ? ' active' : ''}`}
                      onClick={() => onStorageModeChange('local')}
                      disabled={storageBusy}
                      style={{ flex: 1, justifyContent: 'center' }}
                    >
                      Local only
                    </button>
                    <button
                      type="button"
                      className={`settings-tab${storageMode === 'local_and_drive' ? ' active' : ''}`}
                      onClick={() => onStorageModeChange('local_and_drive')}
                      disabled={storageBusy}
                      style={{ flex: 1, justifyContent: 'center' }}
                    >
                      Local + Drive
                    </button>
                  </div>
                  <div style={{ display: 'grid', gap: '8px', marginTop: '8px' }}>
                    <button type="button" className="ghost-btn" onClick={onChooseLocalFolder} disabled={storageBusy}>
                      <Folder size={14} />
                      Choose Local Folder
                    </button>
                    <small title={localRootPath}>{localRootPath || 'No folder selected yet.'}</small>
                    {storageMode === 'local_and_drive' ? (
                      <div className="provider-chip" style={{ marginTop: '2px' }}>
                        <div className="provider-chip__title">
                          <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                            <Cloud size={14} />
                            Google Drive
                          </span>
                          {driveConnected ? (
                            <span className="connected-badge success">
                              <CircleCheckBig size={12} /> Connected
                            </span>
                          ) : (
                            <span className="connected-badge warning">
                              <CircleDashed size={12} /> Not connected
                            </span>
                          )}
                        </div>
                        <small>
                          {driveConnected
                            ? `Mirroring to "${driveFolderName || 'Notebook AI'}".`
                            : 'Connect Drive to enable cloud mirror for transcripts.'}
                        </small>
                        {syncStatus ? (
                          <div style={{ display: 'grid', gap: '4px', marginTop: '10px' }}>
                            {syncLabel ? <small style={{ color: 'var(--text-secondary)' }}>{syncLabel}</small> : null}
                            <small>
                              {syncStatus.state === 'syncing'
                                ? `Syncing ${syncStatus.completed_items ?? 0}/${syncStatus.total_items ?? 0}${
                                    syncStatus.current_item ? ` • ${syncStatus.current_item}` : ''
                                  }`
                                : syncActionBusy
                                  ? 'Starting Drive sync...'
                                : driveStatusBusy && !driveConnected
                                  ? 'Waiting for Google Drive approval in your browser.'
                                : syncStatus.state === 'needs_setup'
                                  ? syncStatus.last_error || 'Finish Drive setup to begin mirroring.'
                                  : syncStatus.last_error && syncStatus.state === 'error'
                                    ? syncStatus.last_error
                                    : syncStatus.last_synced_at
                                      ? `Last mirrored ${new Date(syncStatus.last_synced_at).toLocaleString()}`
                                      : syncStatus.pending_ops > 0
                                        ? `${syncStatus.pending_ops} change${syncStatus.pending_ops === 1 ? '' : 's'} waiting to sync.`
                                        : 'Drive mirror is ready.'}
                            </small>
                            {syncStatus.state === 'syncing' && (syncStatus.total_items ?? 0) > 0 ? (
                              <div
                                style={{
                                  width: '100%',
                                  height: '6px',
                                  borderRadius: '999px',
                                  background: 'var(--surface-sunken)',
                                  overflow: 'hidden',
                                }}
                              >
                                <div
                                  style={{
                                    width: `${progressPercent}%`,
                                    height: '100%',
                                    background: 'var(--success)',
                                  }}
                                />
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                          {!driveConnected ? (
                            <button
                              type="button"
                              className="cta-btn"
                              onClick={onConnectDrive}
                              disabled={storageBusy || driveStatusBusy}
                              style={{ flex: 1, justifyContent: 'center' }}
                            >
                              <Link size={14} />
                              Connect Google Drive
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="ghost-btn"
                            onClick={onRefreshDriveStatus}
                            disabled={storageBusy || driveStatusBusy}
                            style={{ flex: driveConnected ? 1 : undefined }}
                          >
                            <FolderSync size={14} />
                            {driveStatusBusy ? 'Refreshing...' : 'Refresh status'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {storageMode === 'local_and_drive' ? (
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={onRunSyncNow}
                        disabled={storageBusy || driveStatusBusy || syncActionBusy || !driveConnected || syncStatus?.state === 'syncing'}
                      >
                        <FolderSync size={14} />
                        {syncActionBusy
                          ? 'Starting sync...'
                          : syncStatus?.state === 'syncing'
                          ? `Syncing ${syncStatus.completed_items ?? 0}/${syncStatus.total_items ?? 0}`
                          : `Sync now (${syncPendingOps} pending)`}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'transcription' && (
            <>
              <h3>Transcription Quality</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', marginBottom: '16px' }}>
                Capture quality determines how your audio is processed. Fast mode uses local or fast models, while Detailed mode uses slower, more accurate models.
              </p>

              <div style={{ display: 'grid', gap: '10px' }}>
                <article 
                  className={`provider-chip${transcriptionEngine === 'whisper' ? ' active' : ''}`}
                  style={{ cursor: 'pointer', borderColor: transcriptionEngine === 'whisper' ? 'var(--primary)' : undefined, opacity: transcriptionEngine === 'whisper' ? 1 : 0.6 }}
                  onClick={() => onTranscriptionEngineChange('whisper')}
                >
                  <div className="provider-chip__title">
                    <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                      <Waves size={14} />
                      Fast Mode
                    </span>
                    <span title="Uses Whisper for real-time, fast transcription. Good for clear audio and quick notes.">
                      <Info size={16} style={{ color: 'var(--text-tertiary)' }} />
                    </span>
                  </div>
                  <small>Optimized for speed and local processing.</small>
                </article>

                <article 
                  className={`provider-chip${transcriptionEngine === 'llm' ? ' active' : ''}`}
                  style={{ cursor: 'pointer', borderColor: transcriptionEngine === 'llm' ? 'var(--primary)' : undefined, opacity: transcriptionEngine === 'llm' ? 1 : 0.6 }}
                  onClick={() => onTranscriptionEngineChange('llm')}
                >
                  <div className="provider-chip__title">
                    <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                      <Brain size={14} />
                      Detailed Mode
                    </span>
                    <span title="Uses advanced language models to deeply understand complex context, accents, and industry terms.">
                      <Info size={16} style={{ color: 'var(--text-tertiary)' }} />
                    </span>
                  </div>
                  <small>Optimized for deeper accuracy on complex topics.</small>
                </article>
              </div>

              <div className="byok-form" style={{ marginTop: '16px' }}>
                <div className="model-brand">
                  {selectedTranscriptionBrand ? (
                    <BrandMark brand={selectedTranscriptionBrand.key} />
                  ) : (
                    <ProviderMark provider={transcriptionProvider} />
                  )}
                  <div className="model-brand__copy">
                    <strong>
                      {selectedTranscriptionModel
                        ? displayModelName(selectedTranscriptionModel)
                        : providerLabel[transcriptionProvider]}
                    </strong>
                    <small>
                      {selectedTranscriptionModel
                        ? `${selectedTranscriptionBrand?.label ?? providerLabel[transcriptionProvider]} via ${providerLabel[transcriptionProvider]}`
                        : 'Choose the model used for transcription.'}
                    </small>
                  </div>
                </div>
                <label>
                  Provider
                  <select
                    value={transcriptionProvider}
                    onChange={(event) => onTranscriptionProviderChange(event.target.value as ProviderId)}
                    disabled={transcriptionEngine === 'whisper' || connectedProviders.length === 0}
                  >
                    {transcriptionEngine === 'whisper' ? (
                      <option value="openai">OpenAI</option>
                    ) : connectedProviders.length === 0 ? (
                      <option value={transcriptionProvider}>Connect a provider first</option>
                    ) : (
                      connectedProviders.map((provider) => (
                        <option key={provider} value={provider}>
                          {providerLabel[provider]}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <ModelPicker
                  label="Audio model"
                  value={transcriptionModel}
                  models={transcriptionModels}
                  loading={transcriptionModelsLoading}
                  disabled={transcriptionModels.length === 0}
                  placeholder="Choose an audio model"
                  onChange={onTranscriptionModelChange}
                />

                {transcriptionModelsError ? (
                  <small style={{ color: 'var(--danger)' }}>{transcriptionModelsError}</small>
                ) : transcriptionEngine === 'whisper' ? (
                  <small>Fast Mode currently uses OpenAI speech-to-text models only.</small>
                ) : (
                  <small>Detailed Mode can use OpenAI or OpenRouter audio-capable models.</small>
                )}
              </div>
            </>
          )}

          {activeTab === 'shortcuts' && (
            <>
              <h3>Keyboard Shortcuts</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem' }}>
                Keyboard shortcut customization will appear here in future updates.
              </p>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="settings-footer">
          <span className="settings-version">Notebook AI v0.4.0</span>
          <button type="button" className="ghost-btn" onClick={onClose}>
            <X size={14} />
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

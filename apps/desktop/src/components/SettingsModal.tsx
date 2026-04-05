import type {
  MarkdownSettings,
  ProviderConnection,
  ProviderId,
  ProviderModel,
  SyncStatus,
  TranscriptionPreferences,
} from '@notebook-ai/contracts';
import {
  CircleCheckBig,
  CircleDashed,
  Cloud,
  FileText,
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
import { useState } from 'react';
import { syncPhaseLabel, syncProgressPercent } from '../lib/syncStatus';
import {
  BrandMark,
  displayModelName,
  inferBrandFromModel,
  ModelPicker,
  ProviderMark,
  providerLabel,
} from './ProviderModelPicker';

type SettingsTab =
  | 'general'
  | 'providers'
  | 'copilot'
  | 'transcription'
  | 'markdown'
  | 'appearance'
  | 'shortcuts';

interface Props {
  open: boolean;
  onClose: () => void;
  /* Provider props */
  settingsFeedback: {
    tone: 'success' | 'error';
    message: string;
  } | null;
  providers: ProviderConnection[];
  byokProvider: 'openai' | 'openrouter';
  byokValue: string;
  byokSubmitting: boolean;
  onByokProviderChange: (value: 'openai' | 'openrouter') => void;
  onByokValueChange: (value: string) => void;
  onSaveByok: () => void;
  onClearSettingsFeedback: () => void;
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
  driveDisconnectBusy: boolean;
  manualDriveConnectUrl: string | null;
  onStorageModeChange: (mode: 'local' | 'local_and_drive') => void;
  onChooseLocalFolder: () => void;
  onRunSyncNow: () => void;
  onLogout: () => void;
  transcriptionPreferences: TranscriptionPreferences;
  onTranscriptionPreferencesChange: (
    patch: Partial<Omit<TranscriptionPreferences, 'updated_at'>>,
  ) => void;
  transcriptionProvider: ProviderId;
  transcriptionModel: string;
  transcriptionModels: ProviderModel[];
  transcriptionModelsLoading: boolean;
  transcriptionModelsError: string;
  onTranscriptionModelChange: (model: string) => void;
  markdownSettings: MarkdownSettings;
  onMarkdownSettingsChange: (patch: Partial<Omit<MarkdownSettings, 'updated_at'>>) => void;
  onConnectDrive: () => void;
  onRefreshDriveStatus: () => void;
  onDisconnectDrive: () => void;
  onOpenManualDriveConnect: () => void;
  onCopyManualDriveConnectUrl: () => void;
  buildVersion: string;
}

const tabs: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
  { id: 'general', label: 'General', icon: <Settings size={16} /> },
  { id: 'providers', label: 'AI Connection', icon: <Zap size={16} /> },
  { id: 'copilot', label: 'Copilot', icon: <Brain size={16} /> },
  { id: 'transcription', label: 'Transcription', icon: <Mic size={16} /> },
  { id: 'markdown', label: 'Markdown', icon: <FileText size={16} /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={16} /> },
  { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard size={16} /> },
];

function splitCommaSeparated(raw: string): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of raw.split(',')) {
    const normalized = value.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(normalized);
  }
  return next;
}

function describeProviderConnection(entry: ProviderConnection): string {
  if (!entry.connected) {
    return 'No local key saved on this device.';
  }

  const viaLabel = entry.via === 'api_key' ? 'API key' : entry.via;
  const scopeLabel =
    entry.scope === 'desktop_local'
      ? 'stored locally on this device'
      : entry.scope === 'account_vault'
        ? 'stored in your encrypted account vault'
        : 'source unavailable';

  return `Connected via ${viaLabel}; ${scopeLabel}.`;
}

export function SettingsModal({
  open,
  onClose,
  settingsFeedback,
  providers,
  byokProvider,
  byokValue,
  byokSubmitting,
  onByokProviderChange,
  onByokValueChange,
  onSaveByok,
  onClearSettingsFeedback,
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
  driveDisconnectBusy,
  manualDriveConnectUrl,
  onStorageModeChange,
  onChooseLocalFolder,
  onRunSyncNow,
  onLogout,
  transcriptionPreferences,
  onTranscriptionPreferencesChange,
  transcriptionProvider,
  transcriptionModel,
  transcriptionModels,
  transcriptionModelsLoading,
  transcriptionModelsError,
  onTranscriptionModelChange,
  markdownSettings,
  onMarkdownSettingsChange,
  onConnectDrive,
  onRefreshDriveStatus,
  onDisconnectDrive,
  onOpenManualDriveConnect,
  onCopyManualDriveConnectUrl,
  buildVersion,
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
  const showDriveConnectionPanel = storageMode === 'local_and_drive' || driveConnected;

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
          {settingsFeedback ? (
            <div
              className={`settings-feedback settings-feedback--${settingsFeedback.tone}`}
              role={settingsFeedback.tone === 'error' ? 'alert' : 'status'}
              aria-live="polite"
            >
              <span className="settings-feedback__text">{settingsFeedback.message}</span>
              <button
                type="button"
                className="settings-feedback__dismiss"
                onClick={onClearSettingsFeedback}
                aria-label="Dismiss settings message"
              >
                <X size={14} />
              </button>
            </div>
          ) : null}
          {activeTab === 'providers' && (
            <>
              <h3>Connected Providers</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 12px' }}>
                Desktop AI keys are stored locally on this device. They are not synced to your
                account, and if you uninstall the app or move devices you will need to enter them
                again. Keys set in the sidecar <code style={{ fontSize: '0.75rem' }}>.env</code> also
                count as local device credentials.
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
                      {describeProviderConnection(entry)}
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

              <h3>Bring Your Own Key</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '0 0 12px' }}>
                Save a provider key locally for this desktop install only. Web and future mobile apps
                use the encrypted account vault instead.
              </p>
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
                    {showDriveConnectionPanel ? (
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
                            ? storageMode === 'local_and_drive'
                              ? `Mirroring to "${driveFolderName || 'Notebook AI'}".`
                              : `Connected to "${driveFolderName || 'Notebook AI'}", but local-only storage is active.`
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
                                : driveDisconnectBusy
                                  ? 'Disconnecting Google Drive...'
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
                          {!driveConnected && storageMode === 'local_and_drive' ? (
                            <button
                              type="button"
                              className="cta-btn"
                              onClick={onConnectDrive}
                              disabled={storageBusy || driveStatusBusy || driveDisconnectBusy}
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
                            disabled={storageBusy || driveStatusBusy || driveDisconnectBusy}
                            style={{ flex: driveConnected ? 1 : undefined }}
                          >
                            <FolderSync size={14} />
                            {driveStatusBusy ? 'Refreshing...' : 'Refresh status'}
                          </button>
                          {driveConnected ? (
                            <button
                              type="button"
                              className="ghost-btn"
                              onClick={onDisconnectDrive}
                              disabled={storageBusy || driveStatusBusy || driveDisconnectBusy}
                              style={{ flex: 1 }}
                            >
                              <Unplug size={14} />
                              {driveDisconnectBusy ? 'Disconnecting...' : 'Disconnect Drive'}
                            </button>
                          ) : null}
                        </div>
                        {!driveConnected && manualDriveConnectUrl ? (
                          <div style={{ display: 'grid', gap: '8px', marginTop: '10px' }}>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                type="button"
                                className="ghost-btn"
                                onClick={onOpenManualDriveConnect}
                                disabled={storageBusy || driveDisconnectBusy}
                                style={{ flex: 1 }}
                              >
                                <Link size={14} />
                                Open approval page
                              </button>
                              <button
                                type="button"
                                className="ghost-btn"
                                onClick={onCopyManualDriveConnectUrl}
                                disabled={storageBusy || driveDisconnectBusy}
                                style={{ flex: 1 }}
                              >
                                <Info size={14} />
                                Copy link
                              </button>
                            </div>
                            <small style={{ wordBreak: 'break-all' }}>{manualDriveConnectUrl}</small>
                          </div>
                        ) : null}
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
              <h3>Transcription</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', marginBottom: '16px' }}>
                Desktop recording uses one robust transcription path based on normalized local audio and OpenAI speech-to-text models.
              </p>

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
                  <input type="text" value="OpenAI speech-to-text" readOnly disabled />
                </label>

                <ModelPicker
                  label="Audio model"
                  value={transcriptionModel}
                  models={transcriptionModels}
                  loading={transcriptionModelsLoading}
                  disabled={transcriptionModels.length === 0}
                  placeholder="Choose an OpenAI audio model"
                  onChange={onTranscriptionModelChange}
                />

                {transcriptionModelsError ? (
                  <small style={{ color: 'var(--danger)' }}>{transcriptionModelsError}</small>
                ) : connectedProviders.includes('openai') ? (
                  <small>Desktop recording uses OpenAI speech-to-text models only.</small>
                ) : (
                  <small>Connect OpenAI in AI Connection to choose a transcription model.</small>
                )}

                <label>
                  Primary language
                  <input
                    type="text"
                    value={transcriptionPreferences.main_language}
                    onChange={(event) =>
                      onTranscriptionPreferencesChange({
                        main_language: event.target.value.trim() || 'auto',
                      })
                    }
                    placeholder="auto, en, es, hi..."
                  />
                </label>

                <label>
                  Spoken languages
                  <input
                    type="text"
                    value={transcriptionPreferences.spoken_languages.join(', ')}
                    onChange={(event) =>
                      onTranscriptionPreferencesChange({
                        spoken_languages: splitCommaSeparated(event.target.value),
                      })
                    }
                    placeholder="English, Spanish, Hindi"
                  />
                </label>

                <label>
                  Custom vocabulary
                  <textarea
                    value={transcriptionPreferences.custom_vocabulary.join(', ')}
                    onChange={(event) =>
                      onTranscriptionPreferencesChange({
                        custom_vocabulary: splitCommaSeparated(event.target.value),
                      })
                    }
                    placeholder="Customer names, product names, jargon"
                    rows={3}
                  />
                </label>

                <small>
                  Language and vocabulary hints are stored locally and applied to live transcription.
                </small>
              </div>
            </>
          )}

          {activeTab === 'markdown' && (
            <>
              <h3>Markdown</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', marginBottom: '16px' }}>
                Notebook AI stores authored note bodies as markdown-backed documents while keeping the main UI in rich rendered views.
              </p>

              <div className="byok-form">
                <label>
                  Editor surface
                  <select
                    value={markdownSettings.editor_mode}
                    onChange={(event) =>
                      onMarkdownSettingsChange({
                        editor_mode: event.target.value as MarkdownSettings['editor_mode'],
                      })
                    }
                  >
                    <option value="rich_text">Rich text editor</option>
                    <option value="preview">Preview first</option>
                  </select>
                </label>

                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={markdownSettings.enable_import}
                    onChange={(event) =>
                      onMarkdownSettingsChange({ enable_import: event.target.checked })
                    }
                  />
                  <span>Allow markdown import</span>
                </label>

                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={markdownSettings.enable_export}
                    onChange={(event) =>
                      onMarkdownSettingsChange({ enable_export: event.target.checked })
                    }
                  />
                  <span>Allow markdown export</span>
                </label>

                <small>
                  Source view stays hidden by default. These settings only control compatibility behavior and default rendered surfaces.
                </small>
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
          <span className="settings-version">Notebook AI v{buildVersion}</span>
          <button type="button" className="ghost-btn" onClick={onClose}>
            <X size={14} />
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

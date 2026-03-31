import type { ProviderConnection, ProviderId, ProviderModel, SyncStatus } from '@notebook-ai/contracts';
import {
  CircleCheckBig,
  CircleDashed,
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

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderId } from '@notebook-ai/contracts';

function buildSettingsModalProps() {
  return {
    open: true,
    onClose: vi.fn(),
    settingsFeedback: null,
    providers: [],
    byokProvider: 'openai' as const,
    byokValue: '',
    byokSubmitting: false,
    onByokProviderChange: vi.fn(),
    onByokValueChange: vi.fn(),
    onSaveByok: vi.fn(),
    onClearSettingsFeedback: vi.fn(),
    disconnectingProvider: null,
    onDisconnectProvider: vi.fn(),
    connectedProviders: ['openai'] satisfies ProviderId[],
    copilotProvider: 'openai' as const,
    copilotModel: '',
    copilotModels: [],
    copilotModelsLoading: false,
    copilotModelsError: '',
    onCopilotProviderChange: vi.fn(),
    onCopilotModelChange: vi.fn(),
    theme: 'dark' as const,
    onThemeChange: vi.fn(),
    sessionUserId: 'user-1',
    logoutBusy: false,
    storageMode: 'local' as const,
    localRootPath: '/tmp/notebook',
    storageBusy: false,
    syncPendingOps: 0,
    syncStatus: null,
    syncActionBusy: false,
    driveConnected: false,
    driveFolderName: 'Notebook AI',
    driveStatusBusy: false,
    driveDisconnectBusy: false,
    manualDriveConnectUrl: null,
    onStorageModeChange: vi.fn(),
    onChooseLocalFolder: vi.fn(),
    onRunSyncNow: vi.fn(),
    onLogout: vi.fn(),
    transcriptionPreferences: {
      main_language: 'auto',
      spoken_languages: [],
      custom_vocabulary: [],
      updated_at: null,
    },
    onTranscriptionPreferencesChange: vi.fn(),
    transcriptionProvider: 'openai' as const,
    transcriptionModel: '',
    transcriptionModels: [],
    transcriptionModelsLoading: false,
    transcriptionModelsError: '',
    onTranscriptionModelChange: vi.fn(),
    markdownSettings: {
      enable_import: true,
      enable_export: true,
      editor_mode: 'rich_text' as const,
      updated_at: null,
    },
    onMarkdownSettingsChange: vi.fn(),
    onConnectDrive: vi.fn(),
    onRefreshDriveStatus: vi.fn(),
    onDisconnectDrive: vi.fn(),
    onOpenManualDriveConnect: vi.fn(),
    onCopyManualDriveConnectUrl: vi.fn(),
    buildVersion: '0.1.0',
  };
}

describe('SettingsModal', () => {
  afterEach(() => {
    vi.doUnmock('react');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('removes the detailed mode toggle from transcription settings', async () => {
    vi.doMock('react', async () => {
      const actual = await vi.importActual<typeof import('react')>('react');
      return {
        ...actual,
        useState: vi.fn((initial: unknown) => {
          if (initial === 'providers') {
            return ['transcription', vi.fn()] as const;
          }
          return actual.useState(initial);
        }),
      };
    });

    const { SettingsModal } = await import('./SettingsModal');
    const html = renderToStaticMarkup(<SettingsModal {...buildSettingsModalProps()} />);

    expect(html).toContain('Desktop recording uses one robust transcription path');
    expect(html).toContain('OpenAI speech-to-text');
    expect(html).not.toContain('Detailed Mode');
    expect(html).not.toContain('Fast Mode');
  });
});

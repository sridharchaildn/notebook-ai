import type { SyncStatus } from '@notebook-ai/contracts';
import { AlertTriangle, Cloud, FolderSync, ListTodo } from 'lucide-react';
import { buildSyncBannerModel } from '../lib/syncStatus';

interface Props {
  syncStatus: SyncStatus | null;
  driveFolderName: string;
  onOpenSettings: () => void;
}

export function SyncStatusBanner({ syncStatus, driveFolderName, onOpenSettings }: Props) {
  const model = buildSyncBannerModel(syncStatus, driveFolderName);

  if (!model) return null;

  const Icon =
    model.tone === 'syncing'
      ? FolderSync
      : model.tone === 'queued'
        ? ListTodo
        : model.tone === 'warning'
          ? AlertTriangle
          : Cloud;

  return (
    <button
      type="button"
      className={`sync-banner sync-banner--${model.tone}`}
      onClick={onOpenSettings}
      aria-live="polite"
    >
      <span className="sync-banner__icon" aria-hidden="true">
        <Icon size={16} />
      </span>
      <span className="sync-banner__content">
        <span className="sync-banner__title-row">
          <span className="sync-banner__title">{model.title}</span>
          <span className="sync-banner__cta">Open sync settings</span>
        </span>
        <span className="sync-banner__detail">{model.detail}</span>
        {model.progressPercent !== null ? (
          <span className="sync-banner__progress" aria-hidden="true">
            <span
              className="sync-banner__progress-bar"
              style={{ width: `${model.progressPercent}%` }}
            />
          </span>
        ) : null}
      </span>
    </button>
  );
}

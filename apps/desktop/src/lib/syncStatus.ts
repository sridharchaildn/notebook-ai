import type { SyncStatus } from '@notebook-ai/contracts';

export interface SyncBannerModel {
  tone: 'syncing' | 'queued' | 'warning' | 'error';
  title: string;
  detail: string;
  progressPercent: number | null;
}

export function syncPhaseLabel(syncStatus: SyncStatus | null): string | null {
  if (!syncStatus || syncStatus.state !== 'syncing') return null;
  switch (syncStatus.phase) {
    case 'preparing':
      return 'Preparing mirror';
    case 'pulling':
      return 'Downloading from Drive';
    case 'merging':
      return 'Merging local and Drive changes';
    case 'pushing':
      return 'Uploading to Drive';
    case 'finalizing':
      return 'Finalizing mirror';
    default:
      return 'Syncing';
  }
}

export function syncProgressPercent(syncStatus: SyncStatus | null): number {
  if (!syncStatus || syncStatus.state !== 'syncing' || (syncStatus.total_items ?? 0) <= 0) {
    return 0;
  }
  return Math.min(
    100,
    Math.round((((syncStatus.completed_items ?? 0) / Math.max(syncStatus.total_items ?? 1, 1)) * 100)),
  );
}

export function describeSyncStatus(status: SyncStatus, folderName?: string): string {
  const target = folderName || 'Notebook AI';
  if (status.state === 'syncing') {
    return `Syncing ${status.completed_items ?? 0}/${status.total_items ?? 0} sync items to ${target}...`;
  }
  if (status.state === 'needs_setup' && status.last_error) {
    return status.last_error;
  }
  if (status.state === 'error' && status.last_error) {
    return status.last_error;
  }
  if (status.pending_ops > 0) {
    return `Drive mirror queued ${status.pending_ops} change${status.pending_ops === 1 ? '' : 's'} for ${target}.`;
  }
  if (status.last_synced_at) {
    return `Drive mirror is up to date in ${target}.`;
  }
  return `Drive mirror is ready for ${target}.`;
}

export function buildSyncBannerModel(
  syncStatus: SyncStatus | null,
  folderName?: string,
): SyncBannerModel | null {
  if (!syncStatus?.enabled) return null;

  const target = folderName || 'Notebook AI';

  if (syncStatus.state === 'syncing') {
    const completed = syncStatus.completed_items ?? 0;
    const total = syncStatus.total_items ?? 0;
    const title = syncPhaseLabel(syncStatus) ?? 'Syncing';
    const detail =
      total > 0
        ? `${completed} of ${total} sync items${syncStatus.current_item ? ` • ${syncStatus.current_item}` : ''}`
        : `Syncing to ${target}${syncStatus.current_item ? ` • ${syncStatus.current_item}` : ''}`;
    return {
      tone: 'syncing',
      title,
      detail,
      progressPercent: total > 0 ? syncProgressPercent(syncStatus) : null,
    };
  }

  if (syncStatus.state === 'needs_setup') {
    return {
      tone: 'warning',
      title: 'Finish Drive setup',
      detail: syncStatus.last_error || `Connect Google Drive to mirror into ${target}.`,
      progressPercent: null,
    };
  }

  if (syncStatus.state === 'error') {
    return {
      tone: 'error',
      title: 'Drive mirror needs attention',
      detail: syncStatus.last_error || `Unable to sync with ${target}.`,
      progressPercent: null,
    };
  }

  if (syncStatus.pending_ops > 0) {
    return {
      tone: 'queued',
      title: 'Changes waiting to sync',
      detail: `${syncStatus.pending_ops} queued change${syncStatus.pending_ops === 1 ? '' : 's'} for ${target}.`,
      progressPercent: null,
    };
  }

  return null;
}

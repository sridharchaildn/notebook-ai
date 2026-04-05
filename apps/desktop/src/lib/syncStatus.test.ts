import { describe, expect, it } from 'vitest';
import type { SyncStatus } from '@notebook-ai/contracts';
import {
  buildSyncBannerModel,
  describeSyncStatus,
  isDriveMirrorLikelyConnected,
  syncPhaseLabel,
  syncProgressPercent,
} from './syncStatus';

function buildStatus(overrides: Partial<SyncStatus>): SyncStatus {
  return {
    enabled: true,
    pending_ops: 0,
    state: 'idle',
    phase: 'idle',
    current_item: null,
    completed_items: 0,
    total_items: 0,
    last_run_at: null,
    last_synced_at: null,
    last_error: null,
    ...overrides,
  };
}

describe('sync status helpers', () => {
  it('builds a visible syncing model with progress details', () => {
    const status = buildStatus({
      state: 'syncing',
      phase: 'pushing',
      completed_items: 2,
      total_items: 5,
      current_item: 'Interview Assist 6:12 PM',
    });

    expect(syncPhaseLabel(status)).toBe('Uploading to Drive');
    expect(syncProgressPercent(status)).toBe(40);
    expect(buildSyncBannerModel(status, 'Notebook AI') ).toEqual({
      tone: 'syncing',
      title: 'Uploading to Drive',
      detail: '2 of 5 sync items • Interview Assist 6:12 PM',
      progressPercent: 40,
    });
    expect(describeSyncStatus(status, 'Notebook AI')).toContain('Syncing 2/5 sync items');
  });

  it('builds a queued model when changes are waiting', () => {
    const status = buildStatus({
      pending_ops: 3,
    });

    expect(buildSyncBannerModel(status, 'Notebook AI')).toEqual({
      tone: 'queued',
      title: 'Changes waiting to sync',
      detail: '3 queued changes for Notebook AI.',
      progressPercent: null,
    });
  });

  it('builds an error model when mirror setup fails', () => {
    const status = buildStatus({
      state: 'error',
      last_error: 'Google Drive access expired.',
    });

    expect(buildSyncBannerModel(status, 'Notebook AI')).toEqual({
      tone: 'error',
      title: 'Drive mirror needs attention',
      detail: 'Google Drive access expired.',
      progressPercent: null,
    });
  });

  it('treats recent successful mirror activity as likely connected', () => {
    expect(
      isDriveMirrorLikelyConnected(
        buildStatus({
          last_synced_at: '2026-04-03T18:58:12Z',
        }),
      ),
    ).toBe(true);

    expect(
      isDriveMirrorLikelyConnected(
        buildStatus({
          enabled: false,
          last_synced_at: '2026-04-03T18:58:12Z',
        }),
      ),
    ).toBe(false);
  });
});

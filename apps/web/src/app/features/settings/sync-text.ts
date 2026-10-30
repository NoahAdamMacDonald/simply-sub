import type { SyncProblem } from '@simply-sub/core';
import { dateText } from '../../shared/date-text';
import type { JoinPreview, SyncSnag } from '../../shared/sync/sync-service';

// What Settings' Sync between devices says (PROJECT-PLAN P13, M10.9): when this device last synced, and what held
// sync back or stopped it, in words.

/** "Synced just now", "Synced 5 minutes ago", "Synced 3 hours ago", "Synced Oct 28, 2026", at `now` (ms). */
export function syncedText(syncedAt: string | undefined, now: number): string {
  if (syncedAt === undefined) return 'Not synced yet';
  const minutes = Math.floor((now - Date.parse(syncedAt)) / 60_000);
  if (minutes < 1) return 'Synced just now';
  if (minutes < 60) return `Synced ${minutes === 1 ? 'a minute' : `${minutes} minutes`} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours === 1 ? 'an hour' : `${hours} hours`} ago`;
  return `Synced ${dateText(syncedAt.slice(0, 10))}`;
}

/** What held the last sync back: sync tries again by itself. */
export const snagTexts: Record<SyncSnag, string> = {
  offline: 'You’re offline: sync waits until you’re back online.',
  busy: 'Sync is busy: it tries again in a moment.',
  full: 'The sync server has taken all it can today: it tries again tomorrow.',
  tooBig: 'Your data is too big to sync: over 1 MB once sealed.',
  failed: 'Sync didn’t work this time: it tries again shortly.',
};

/** What stopped sync on this device, until the user acts. */
export const problemTexts: Record<SyncProblem, string> = {
  gone:
    'The synced copy was deleted, from another device or by starting over there. Sync stopped here, ' +
    'and this device’s data stays.',
  newer: 'The synced copy is from a newer version of Simply Sub. Update this one to keep syncing.',
  unopenable: 'The synced copy doesn’t open with this device’s code, so sync stopped here.',
};

/** Why a code found nothing to join. */
export const previewTexts: Record<Exclude<JoinPreview['kind'], 'copy'>, string> = {
  none: 'No synced copy uses this code. Check the words, or turn on sync on your other device first.',
  newer: 'The synced copy is from a newer version of Simply Sub. Update this one first.',
  unopenable: 'The synced copy doesn’t open with this code.',
  offline: 'You’re offline. Join once you’re back online.',
  failed: 'The synced copy couldn’t be read. Try again in a moment.',
};

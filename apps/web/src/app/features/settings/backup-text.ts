import type { BackupCounts } from '@simply-sub/core';
import type { ImportCounts } from '../../core/storage/backup-repository';

// What the backup dialogs say about a backup's records (P13).

const names: Record<keyof BackupCounts, [string, string]> = {
  lists: ['list', 'lists'],
  items: ['subscription', 'subscriptions'],
  customSubs: ['custom subscription', 'custom subscriptions'],
  rankings: ['feature rank', 'feature ranks'],
  cards: ['payment card', 'payment cards'],
  tags: ['tag', 'tags'],
};

/** "3 lists", "1 subscription": each kind of record the backup has, in the dialog's order, the empty ones left out. */
export function countLines(counts: BackupCounts): string[] {
  return (Object.keys(names) as (keyof BackupCounts)[]).flatMap((kind) => {
    const count = counts[kind];
    if (count === 0) return [];
    const [one, many] = names[kind];
    return [`${count} ${count === 1 ? one : many}`];
  });
}

/** What an import says once it's done: Replace took the backup; Merge took what was newer, or found nothing. */
export function importedText(mode: 'replace' | 'merge', counts: ImportCounts): string {
  if (mode === 'replace') return 'Imported the backup';
  const written = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (written === 0) return 'Nothing in the backup was newer than what’s here';
  return written === 1
    ? 'Merged 1 record from the backup'
    : `Merged ${written} records from the backup`;
}

import type { IsoDate } from '../dates/iso-date';

// The names exports give their files (M7.5), like Export backup's `simply-sub-backup-2026-10-27.json`.

/** The longest part a file's name takes from what it holds. */
const maxSubject = 40;

/**
 * A file's name, from what it holds (a list's name, or "payments") and the day: `simply-sub-work-related-2026-10-28.csv`.
 * Only plain letters, digits and dashes, which every system takes: accents go ("Côté" is "cote"), and a name with
 * none of them is "list".
 */
export function exportFileName(subject: string, today: IsoDate, extension: string): string {
  const slug = subject
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, maxSubject)
    .replace(/^-+|-+$/g, '');
  return `simply-sub-${slug || 'list'}-${today}.${extension}`;
}

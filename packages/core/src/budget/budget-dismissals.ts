import { monthOf, type IsoMonth } from '../dates/iso-month';
import type { IsoDate } from '../dates/iso-date';

// Dismissed budget warnings (PROJECT-PLAN P2, P4, M7.7): a warning the user dismisses stays hidden until its period or
// its budget changes. Settings keeps a key for each (dismissedBudgetWarnings): whose payments it's about (a list's id,
// or "all" for Home's every list together), month or year, the period, and the budget it went over:
// "all month 2027-01 50", "0192f1c4-… year 2026 1000". The next 12 months' warning (M10.38), whose period moves every
// day, is kept for the month it was dismissed in, with the total it had then: "all next-12 2026-11 750 2905.59". It
// stays hidden through that month, unless the total grows past it.

/** A budget warning's period: one month, this year, or the next 12 months (M10.38). */
export type BudgetWarningKind = 'month' | 'year' | 'next-12';

/** What a dismissed warning's key looks like, for the settings' schema. */
export const budgetWarningKeyPattern =
  /^(?:all|[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}) (?:(?:month \d{4}-(?:0[1-9]|1[0-2])|year \d{4}) \d+(?:\.\d+)?|next-12 \d{4}-(?:0[1-9]|1[0-2]) \d+(?:\.\d+)? \d+(?:\.\d+)?)$/;

/** The most dismissals Settings keeps: the oldest go first. */
export const maxDismissedBudgetWarnings = 50;

/**
 * A warning's key: `listId` for a list's own (List view), none for every list's (Home). The next 12 months' takes the
 * month it's shown in as its period, and its total, to the cent.
 */
export function budgetWarningKey(
  listId: string | undefined,
  kind: BudgetWarningKind,
  period: IsoMonth | number,
  budget: number,
  total?: number,
): string {
  const key = `${listId ?? 'all'} ${kind} ${period} ${budget}`;
  return kind === 'next-12' ? `${key} ${Math.round((total ?? 0) * 100) / 100}` : key;
}

/**
 * The dismissed key that hides the warning whose key is `key`, if one does: the same key, or for the next 12 months'
 * one of the same month and budget whose total was as high or higher, so a total that grows shows it again.
 */
export function dismissingKey(keys: readonly string[], key: string): string | undefined {
  const [whose, kind, period, budget, total] = key.split(' ');
  if (kind !== 'next-12') return keys.includes(key) ? key : undefined;
  return keys.find((kept) => {
    const parts = kept.split(' ');
    return (
      parts[0] === whose &&
      parts[1] === kind &&
      parts[2] === period &&
      parts[3] === budget &&
      Number(parts[4]) >= Number(total)
    );
  });
}

/**
 * The dismissed keys with `key` added, at the end. Keys for a period that's over (a month before `today`'s, a year
 * before its) are dropped, since their warnings can't come back, and so is the next 12 months' key `key` takes the
 * place of, and the oldest past the limit.
 */
export function withDismissedWarning(
  keys: readonly string[],
  key: string,
  today: IsoDate,
): string[] {
  const month = monthOf(today);
  const year = month.slice(0, 4);
  const same = key.split(' ').slice(0, 4).join(' ');
  const current = keys.filter((kept) => {
    const [, kind, period] = kept.split(' ');
    if (kind === 'next-12' && kept.split(' ').slice(0, 4).join(' ') === same) return false;
    return kept !== key && (kind === 'year' ? period >= year : period >= month);
  });
  return [...current, key].slice(-maxDismissedBudgetWarnings);
}

/** The dismissed keys without `removed`. */
export function withoutDismissedWarnings(
  keys: readonly string[],
  removed: readonly string[],
): string[] {
  return keys.filter((key) => !removed.includes(key));
}

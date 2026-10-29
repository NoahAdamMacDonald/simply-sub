import { monthOf, type IsoMonth } from '../dates/iso-month';
import type { IsoDate } from '../dates/iso-date';

// Dismissed budget warnings (PROJECT-PLAN P2, P4, M7.7): a warning the user dismisses stays hidden until its period or
// its budget changes. Settings keeps a key for each (dismissedBudgetWarnings): whose payments it's about (a list's id,
// or "all" for Home's every list together), month or year, the period, and the budget it went over:
// "all month 2027-01 50", "0192f1c4-… year 2026 1000".

/** A budget warning's period: one month, or this year. */
export type BudgetWarningKind = 'month' | 'year';

/** What a dismissed warning's key looks like, for the settings' schema. */
export const budgetWarningKeyPattern =
  /^(?:all|[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}) (?:month \d{4}-(?:0[1-9]|1[0-2])|year \d{4}) \d+(?:\.\d+)?$/;

/** The most dismissals Settings keeps: the oldest go first. */
export const maxDismissedBudgetWarnings = 50;

/** A warning's key: `listId` for a list's own (List view), none for every list's (Home). */
export function budgetWarningKey(
  listId: string | undefined,
  kind: BudgetWarningKind,
  period: IsoMonth | number,
  budget: number,
): string {
  return `${listId ?? 'all'} ${kind} ${period} ${budget}`;
}

/**
 * The dismissed keys with `key` added, at the end. Keys for a period that's over (a month before `today`'s, a year
 * before its) are dropped, since their warnings can't come back, and so are the oldest past the limit.
 */
export function withDismissedWarning(
  keys: readonly string[],
  key: string,
  today: IsoDate,
): string[] {
  const month = monthOf(today);
  const year = month.slice(0, 4);
  const current = keys.filter((kept) => {
    const [, kind, period] = kept.split(' ');
    return kept !== key && (kind === 'month' ? period >= month : period >= year);
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

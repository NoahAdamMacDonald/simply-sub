import { describe, expect, it } from 'vitest';
import {
  budgetWarningKey,
  dismissingKey,
  maxDismissedBudgetWarnings,
  settingsSchema,
  withDismissedWarning,
  withoutDismissedWarnings,
} from '../../src';
import { issues } from '../catalog/helpers';
import { settings } from '../user/fixtures';

// Dismissed budget warnings (P2, P4, M7.7): hidden until the period or the budget changes.

const today = '2026-10-28';
const work = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';

describe('budgetWarningKey', () => {
  it('names whose payments, the period and the budget', () => {
    expect(budgetWarningKey(undefined, 'month', '2027-01', 50)).toBe('all month 2027-01 50');
    expect(budgetWarningKey(work, 'year', 2026, 1000.5)).toBe(`${work} year 2026 1000.5`);
  });

  it('gives the next 12 months’ warning the month it’s shown in and its total, to the cent (M10.38)', () => {
    expect(budgetWarningKey(undefined, 'next-12', '2026-11', 750, 2905.594)).toBe(
      'all next-12 2026-11 750 2905.59',
    );
  });
});

describe('dismissingKey (M10.38)', () => {
  it('matches a month’s or a year’s key exactly', () => {
    expect(dismissingKey(['all year 2026 750'], 'all year 2026 750')).toBe('all year 2026 750');
    expect(dismissingKey(['all year 2026 750'], 'all year 2026 800')).toBeUndefined();
  });

  it('hides the next 12 months’ warning through its month while the total doesn’t grow', () => {
    const dismissed = ['all next-12 2026-11 750 2905.59'];
    const key = (month: string, total: number) =>
      budgetWarningKey(undefined, 'next-12', month, 750, total);
    expect(dismissingKey(dismissed, key('2026-11', 2905.59))).toBe(dismissed[0]);
    // A smaller total (a subscription ended) stays hidden; a bigger one shows again.
    expect(dismissingKey(dismissed, key('2026-11', 2700))).toBe(dismissed[0]);
    expect(dismissingKey(dismissed, key('2026-11', 2905.6))).toBeUndefined();
    // The next month, or another budget or list, shows it again.
    expect(dismissingKey(dismissed, key('2026-12', 2700))).toBeUndefined();
    expect(
      dismissingKey(dismissed, budgetWarningKey(work, 'next-12', '2026-11', 750, 100)),
    ).toBeUndefined();
    expect(
      dismissingKey(dismissed, budgetWarningKey(undefined, 'next-12', '2026-11', 800, 100)),
    ).toBeUndefined();
  });
});

describe('withDismissedWarning', () => {
  it('adds the key once, last', () => {
    const january = budgetWarningKey(undefined, 'month', '2027-01', 50);
    const year = budgetWarningKey(work, 'year', 2026, 1000);
    expect(withDismissedWarning([], january, today)).toEqual([january]);
    expect(withDismissedWarning([january, year], january, today)).toEqual([year, january]);
  });

  it('drops the keys of periods that are over, which can’t come back', () => {
    const september = budgetWarningKey(undefined, 'month', '2026-09', 50);
    const october = budgetWarningKey(undefined, 'month', '2026-10', 50);
    const lastYear = budgetWarningKey(undefined, 'year', 2025, 1000);
    const thisYear = budgetWarningKey(undefined, 'year', 2026, 1000);
    const january = budgetWarningKey(undefined, 'month', '2027-01', 50);
    expect(withDismissedWarning([september, october, lastYear, thisYear], january, today)).toEqual([
      october,
      thisYear,
      january,
    ]);
  });

  it('drops a past month’s next 12 months’ key, and the one a new dismissal of it replaces (M10.38)', () => {
    const october = budgetWarningKey(undefined, 'next-12', '2026-09', 750, 1000);
    const before = budgetWarningKey(undefined, 'next-12', '2026-10', 750, 1000);
    const after = budgetWarningKey(undefined, 'next-12', '2026-10', 750, 1200);
    expect(withDismissedWarning([october, before], after, today)).toEqual([after]);
  });

  it('keeps no more than the limit, dropping the oldest', () => {
    const keys = Array.from({ length: maxDismissedBudgetWarnings }, (_, index) =>
      budgetWarningKey(undefined, 'month', '2027-01', index + 1),
    );
    const added = withDismissedWarning(keys, budgetWarningKey(undefined, 'year', 2026, 9), today);
    expect(added).toHaveLength(maxDismissedBudgetWarnings);
    expect(added[0]).toBe(keys[1]);
    expect(added.at(-1)).toBe('all year 2026 9');
  });
});

describe('withoutDismissedWarnings', () => {
  it('shows the warnings again', () => {
    expect(withoutDismissedWarnings(['a', 'b', 'c'], ['a', 'c'])).toEqual(['b']);
  });
});

describe('settings.dismissedBudgetWarnings', () => {
  it('keeps budget warnings’ keys, and stays optional', () => {
    const dismissed = [
      'all month 2027-01 50',
      `${work} year 2026 1000`,
      'all next-12 2026-11 750 2905.59',
    ];
    expect(issues(settingsSchema, { ...settings, dismissedBudgetWarnings: dismissed })).toEqual([]);
    expect(issues(settingsSchema, settings)).toEqual([]);
    for (const bad of [
      [],
      ['all month 2027-13 50'],
      ['anyone year 2026 1'],
      ['all week 2026 1'],
      ['all next-12 2026-11 750'],
      ['all year 2026 750 12'],
    ]) {
      expect(
        issues(settingsSchema, { ...settings, dismissedBudgetWarnings: bad }).length,
      ).toBeGreaterThan(0);
    }
  });
});

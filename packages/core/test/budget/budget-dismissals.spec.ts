import { describe, expect, it } from 'vitest';
import {
  budgetWarningKey,
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
    const dismissed = ['all month 2027-01 50', `${work} year 2026 1000`];
    expect(issues(settingsSchema, { ...settings, dismissedBudgetWarnings: dismissed })).toEqual([]);
    expect(issues(settingsSchema, settings)).toEqual([]);
    for (const bad of [[], ['all month 2027-13 50'], ['anyone year 2026 1'], ['all week 2026 1']]) {
      expect(
        issues(settingsSchema, { ...settings, dismissedBudgetWarnings: bad }).length,
      ).toBeGreaterThan(0);
    }
  });
});

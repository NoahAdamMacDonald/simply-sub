import { describe, expect, it } from 'vitest';
import { chargeDates, reanchorIssue, reanchored, type Billing } from '../../src';

// "Wrong date?" (P4, P10, PROJECT-PLAN §3.1): the date given becomes the anchor, and every later date follows it.

type Recurring = Extract<Billing, { mode: 'recurring' }>;
const today = '2026-10-28';
const billing: Recurring = {
  mode: 'recurring',
  interval: 'month',
  intervalCount: 1,
  anchorDate: '2026-02-28',
  billingDay: 31,
  autoRenew: true,
};

describe('reanchored', () => {
  it('makes the date the anchor, and every later charge follows it', () => {
    const moved = reanchored(
      { ...billing, anchorDate: '2026-11-12', billingDay: undefined },
      '2026-11-14',
    );
    expect(moved).toEqual({ ...billing, anchorDate: '2026-11-14', billingDay: undefined });
    expect(chargeDates(moved, { from: '2026-11-01', to: '2027-02-01' })).toEqual([
      '2026-11-14',
      '2026-12-14',
      '2027-01-14',
    ]);
  });

  it('keeps the billing day while the new date allows it, and drops it when not', () => {
    expect(reanchored(billing, '2026-11-30')).toEqual({ ...billing, anchorDate: '2026-11-30' });
    const dropped = reanchored(billing, '2026-11-29');
    expect(dropped).toEqual({
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-11-29',
      autoRenew: true,
    });
  });
});

describe('reanchorIssue', () => {
  it('takes today or a later date within the item’s dates', () => {
    expect(reanchorIssue(billing, today, today)).toBeUndefined();
    expect(reanchorIssue(billing, '2026-11-14', today)).toBeUndefined();
  });

  it('refuses what isn’t a date, a past one, or one outside its start and end dates', () => {
    expect(reanchorIssue(billing, null, today)).toBe('Enter a date, as YYYY-MM-DD');
    expect(reanchorIssue(billing, '2026-02-30', today)).toBe('Enter a date, as YYYY-MM-DD');
    expect(reanchorIssue(billing, '2026-10-27', today)).toBe('Pick today or a later date');
    expect(reanchorIssue({ ...billing, startDate: '2026-12-01' }, '2026-11-14', today)).toBe(
      'Pick a date from the day it started',
    );
    expect(reanchorIssue({ ...billing, endDate: '2026-11-14' }, '2026-11-14', today)).toBe(
      'Pick a date before it ends',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { chargeDates, reanchorIssue, reanchored, switchedBilling, type Billing } from '../../src';

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

// A yearly renewal charged before its date (M11.21): the charge date given anchors the renewal it pays for.
describe('charged before the renewal', () => {
  const early: Recurring = {
    mode: 'recurring',
    interval: 'year',
    intervalCount: 1,
    anchorDate: '2027-03-10',
    autoRenew: true,
    chargeDaysBefore: 35,
  };

  it('anchors the renewal that many days after the charge, so the charge stays on the date given', () => {
    const moved = reanchored(early, '2027-02-05');
    expect(moved).toEqual({ ...early, anchorDate: '2027-03-12' });
    expect(chargeDates(moved, { from: '2027-01-01', to: '2028-01-01' })).toEqual(['2027-02-05']);
  });

  it('keeps it on a yearly period it switches to, and drops it on another', () => {
    expect(switchedBilling(early, { interval: 'year', intervalCount: 1 }, '2027-02-03')).toEqual(
      early,
    );
    expect(switchedBilling(early, { interval: 'month', intervalCount: 1 }, '2027-02-03')).toEqual({
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2027-02-03',
      autoRenew: true,
    });
  });

  it('refuses a charge date whose renewal is on or after the end date', () => {
    const ending = { ...early, endDate: '2027-03-10' };
    expect(reanchorIssue(ending, '2027-02-02', '2026-11-13')).toBeUndefined();
    expect(reanchorIssue(ending, '2027-02-03', '2026-11-13')).toBe('Pick a date before it ends');
  });
});

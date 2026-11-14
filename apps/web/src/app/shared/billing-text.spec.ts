import type { Billing, Charge } from '@simply-sub/core';
import { renewalText } from './billing-text';

// The list editor's rows (P5): when an item renews, from its next charge.

describe('renewalText', () => {
  const yearly: Billing = {
    mode: 'recurring',
    interval: 'year',
    intervalCount: 1,
    anchorDate: '2027-03-10',
    autoRenew: true,
  };
  const charge = (date: string) => ({ date, manual: false }) as Charge;

  it('is the next charge’s date', () => {
    expect(renewalText(yearly, charge('2027-03-10'), '2026-11-13')).toBe(
      'Renews Mar 10, 2027 · auto',
    );
  });

  it('says both dates for a renewal charged early (M11.21), and only the purchase’s on its day', () => {
    const early: Billing = { ...yearly, chargeDaysBefore: 35 };
    expect(renewalText(early, charge('2027-02-03'), '2026-11-13')).toBe(
      'Renews Mar 10, 2027, charged Feb 3, 2027 · auto',
    );
    expect(
      renewalText({ ...early, startDate: '2026-11-20' }, charge('2026-11-20'), '2026-11-13'),
    ).toBe('Renews Nov 20 · auto');
  });
});

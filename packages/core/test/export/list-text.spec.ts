import { describe, expect, it } from 'vitest';
import { listText } from '../../src';
import { context, familyList, format, workList } from './fixtures';

// List view's Text export (BLUEPRINT §11.2, M7.5).

describe('listText', () => {
  it('gives the list’s totals, then each item as charged, with its next charge and live tags', () => {
    expect(listText(workList, context, format)).toBe(
      [
        'Work Related',
        'Exported from Simply Sub on Oct 28, 2026',
        '',
        'This month: $43.04',
        'This year: $516.47',
        'Next 12 months: $516.47',
        '',
        '2 subscriptions',
        '',
        'Netflix Standard',
        '  Cost: $19.94 monthly, with $0.95 tax',
        '  Renews automatically',
        '  Next charge: Nov 12, 2026',
        '  Status: Active',
        '  Tags: Family',
        '',
        'Crave Premium',
        '  Cost: $23.10 monthly, with $1.10 tax',
        '  Renews automatically',
        '  Next charge: Oct 31, 2026',
        '  Status: Active',
        '  Tags: Work',
        '',
      ].join('\n'),
    );
  });

  it('marks converted totals, says what isn’t counted, and gives end dates, notes and the items it can’t price', () => {
    expect(listText(familyList, context, format)).toBe(
      [
        'Family',
        'Exported from Simply Sub on Oct 28, 2026',
        '',
        'This month: $12.59',
        'This year: ≈ $245.23',
        'Next 12 months: ≈ $131.93',
        '1 subscription isn’t counted in these totals.',
        '',
        '3 subscriptions',
        '',
        'Mullvad VPN',
        '  Cost: ≈ $94.16 yearly',
        '  Renew manually',
        '  Next charge: Jan 20, 2027',
        '  Status: Active',
        '',
        "Kids' (Disney+ Standard)",
        '  Cost: $12.59 monthly, with $0.60 tax',
        '  Renews automatically',
        '  Next charge: Nov 5, 2026',
        '  Ends: Feb 1, 2027',
        '  Status: Active',
        '  Note: Shared with',
        '        the cousins',
        '',
        'Old plan (netflix.basic)',
        '  Can’t be priced: This plan is no longer in the catalog',
        '  Tags: Family',
        '',
      ].join('\n'),
    );
  });

  it('says a free plan is free, and when an inactive one starts again', () => {
    const [netflix] = workList.resolved;
    const free = {
      ...netflix,
      price: { ...netflix.price, amount: 0, monthlyEquivalent: 0 },
      status: { kind: 'inactive' as const, activeFrom: '2026-12-01', manual: false },
      nextCharge: undefined,
    };
    const text = listText({ ...workList, resolved: [free] }, context, format);
    expect(text).toContain(
      [
        'Netflix Standard',
        '  Cost: Free',
        '  No charge to come',
        '  Status: Inactive until Dec 1, 2026',
      ].join('\n'),
    );
  });

  it('says what an own price still to come will be, and from when (M9.6)', () => {
    const [netflix] = workList.resolved;
    const own = { amount: 9.99, currency: 'USD', since: '2026-11-12', plusTax: true };
    const switched = { ...netflix, item: { ...netflix.item, priceOverride: own } };
    expect(listText({ ...workList, resolved: [switched] }, context, format)).toContain(
      '  Your own price from Nov 12, 2026: US$9.99 monthly + tax\n',
    );
    const started = { ...own, since: '2026-10-12' };
    const applies = { ...switched, item: { ...switched.item, priceOverride: started } };
    expect(listText({ ...workList, resolved: [applies] }, context, format)).toContain(
      '  Your own price\n',
    );
  });
});

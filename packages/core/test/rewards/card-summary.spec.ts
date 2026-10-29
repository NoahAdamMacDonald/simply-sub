import { describe, expect, it } from 'vitest';
import { cardSummary } from '../../src';
import {
  canadian,
  dollarCard,
  noRates,
  ontario,
  otherListId,
  resolved,
  cashBack,
  today,
  yearly,
} from './fixtures';

const context = { today, currency: 'CAD', place: ontario, fx: canadian.fx };

describe('cardSummary', () => {
  it('lists the items paid with the card, from every list, with what each costs a month with tax', () => {
    const netflix = resolved('netflix.standard', { cardId: cashBack.id });
    const crave = resolved('crave.standard', {
      cardId: cashBack.id,
      listId: otherListId,
      nickname: 'Mom’s',
      billing: { ...yearly, autoRenew: true },
    });
    const other = resolved('netflix.premium', { cardId: dollarCard.id });
    const unpaid = resolved('netflix.standard-ads');
    const summary = cardSummary(cashBack, [netflix, other, crave, unpaid], context);
    expect(summary.subscriptions.map(({ title, listId }) => [title, listId])).toEqual([
      ['Netflix Standard', netflix.listId],
      ['Mom’s (Crave Standard With Ads)', otherListId],
    ]);
    expect(summary.monthly).toBeCloseTo(18.99 * 1.13 + (119.99 / 12) * 1.13);
    expect(summary).toMatchObject({ monthlyApprox: false, notCounted: 0 });
  });

  it("adds up this month's charges paid with it, the ones already made too", () => {
    // Renewing on Nov 12, so it was charged on Oct 12.
    const netflix = resolved('netflix.standard', { cardId: cashBack.id });
    const crave = resolved('crave.standard', { cardId: cashBack.id, billing: yearly });
    const october = cardSummary(cashBack, [netflix, crave], context);
    expect(october.thisMonth).toBeCloseTo(18.99 * 1.13);
    expect(october).toMatchObject({ thisMonthApprox: false, thisMonthLeftOut: 0 });
    // Crave's year falls in November.
    const november = cardSummary(cashBack, [netflix, crave], { ...context, today: '2026-11-03' });
    expect(november.thisMonth).toBeCloseTo((18.99 + 119.99) * 1.13);
  });

  it("counts this month's charges in the card's currency, converted at the ECB rate", () => {
    const netflix = resolved('netflix.standard', { cardId: dollarCard.id });
    const november = cardSummary(dollarCard, [netflix], { ...context, today: '2026-11-03' });
    expect(november.thisMonth).toBeCloseTo(18.99 * 1.13 * 0.7243);
    expect(november.thisMonthApprox).toBe(true);
  });

  it('counts a foreign charge as posted, its FX fee in, and gives the net a month and the months over the limit', () => {
    // Mullvad's €60 a year, renewing Nov 12 (Ontario's tax: the test catalog's Mullvad doesn't include it).
    const mullvad = resolved('mullvad.vpn', { cardId: cashBack.id, billing: yearly });
    const netflix = resolved('netflix.standard', { cardId: cashBack.id });
    const tight = { ...cashBack, monthlyLimit: 50 };
    const november = cardSummary(tight, [mullvad, netflix], { ...context, today: '2026-11-03' });
    const inCad = (60 * 1.13) / 0.664;
    expect(november.thisMonth).toBeCloseTo(inCad * 1.025 + 18.99 * 1.13);
    expect(november.net).toBeCloseTo((inCad / 12) * 1.025 * 0.985 + 18.99 * 1.13 * 0.985);
    expect(november.overLimit.map((over) => [over.month, over.days])).toEqual([
      ['2026-11', ['2026-11-12']],
    ]);
  });

  it('leaves out and counts what it has no rate for', () => {
    const mullvad = resolved('mullvad.vpn', { cardId: cashBack.id, billing: yearly }, noRates);
    const summary = cardSummary(cashBack, [mullvad], {
      ...context,
      fx: undefined,
      today: '2026-11-03',
    });
    expect(summary).toMatchObject({ monthly: 0, notCounted: 1, thisMonth: 0, thisMonthLeftOut: 1 });
    expect(summary.subscriptions[0].monthly).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { cardSummary } from '../../src';
import {
  canadian,
  dollarCard,
  noRates,
  ontario,
  otherListId,
  resolved,
  simplii,
  today,
  yearly,
} from './fixtures';

const context = { today, currency: 'CAD', place: ontario, fx: canadian.fx };

describe('cardSummary', () => {
  it('lists the items paid with the card, from every list, with what each costs a month with tax', () => {
    const netflix = resolved('netflix.standard', { cardId: simplii.id });
    const crave = resolved('crave.standard', {
      cardId: simplii.id,
      listId: otherListId,
      nickname: 'Mom’s',
      billing: { ...yearly, autoRenew: true },
    });
    const other = resolved('netflix.premium', { cardId: dollarCard.id });
    const unpaid = resolved('netflix.standard-ads');
    const summary = cardSummary(simplii, [netflix, other, crave, unpaid], context);
    expect(summary.subscriptions.map(({ title, listId }) => [title, listId])).toEqual([
      ['Netflix Standard', netflix.listId],
      ['Mom’s (Crave Standard With Ads)', otherListId],
    ]);
    expect(summary.monthly).toBeCloseTo(18.99 * 1.13 + (119.99 / 12) * 1.13);
    expect(summary).toMatchObject({ monthlyApprox: false, notCounted: 0 });
  });

  it("adds up this month's charges paid with it, the ones already made too", () => {
    // Renewing on Nov 12, so it was charged on Oct 12.
    const netflix = resolved('netflix.standard', { cardId: simplii.id });
    const crave = resolved('crave.standard', { cardId: simplii.id, billing: yearly });
    const october = cardSummary(simplii, [netflix, crave], context);
    expect(october.thisMonth).toBeCloseTo(18.99 * 1.13);
    expect(october).toMatchObject({ thisMonthApprox: false, thisMonthLeftOut: 0 });
    // Crave's year falls in November.
    const november = cardSummary(simplii, [netflix, crave], { ...context, today: '2026-11-03' });
    expect(november.thisMonth).toBeCloseTo((18.99 + 119.99) * 1.13);
  });

  it("counts this month's charges in the card's currency, converted at the ECB rate", () => {
    const netflix = resolved('netflix.standard', { cardId: dollarCard.id });
    const november = cardSummary(dollarCard, [netflix], { ...context, today: '2026-11-03' });
    expect(november.thisMonth).toBeCloseTo(18.99 * 1.13 * 0.7243);
    expect(november.thisMonthApprox).toBe(true);
  });

  it('leaves out and counts what it has no rate for', () => {
    const mullvad = resolved('mullvad.vpn', { cardId: simplii.id, billing: yearly }, noRates);
    const summary = cardSummary(simplii, [mullvad], {
      ...context,
      fx: undefined,
      today: '2026-11-03',
    });
    expect(summary).toMatchObject({ monthly: 0, notCounted: 1, thisMonth: 0, thisMonthLeftOut: 1 });
    expect(summary.subscriptions[0].monthly).toBeUndefined();
  });
});

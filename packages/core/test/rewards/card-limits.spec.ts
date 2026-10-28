import { describe, expect, it } from 'vitest';
import {
  cardLoads,
  itemLedger,
  itemOnCard,
  limitMonths,
  overLimits,
  type PaymentCard,
} from '../../src';
import { canadian, noRates, ontario, resolved, simplii, today, yearly } from './fixtures';

// An item's charges on a card (card-ledger.ts) and a card's monthly limit (card-limits.ts): Ontario's 13%, Oct 26, 2026.

const context = { today, currency: 'CAD', place: ontario, fx: canadian.fx };
const netflixMonth = 18.99 * 1.13;

describe('limitMonths', () => {
  it('are this month and the next 11', () => {
    const months = limitMonths(today);
    expect(months).toHaveLength(12);
    expect([months[0], months[11]]).toEqual(['2026-10', '2027-09']);
  });
});

describe('itemLedger and itemOnCard', () => {
  it('count the next 12 months for savings, and each of limitMonths for the limit', () => {
    // Renewing on Nov 12, so it was charged on Oct 12: this month counts it, the next 12 months don't.
    const ledger = itemLedger(resolved('netflix.standard'), context);
    expect(ledger.next12.map((charge) => charge.date)).toHaveLength(12);
    expect(ledger.next12[0].date).toBe('2026-11-12');
    expect(ledger.months.map((charges) => charges.length)).toEqual(Array(12).fill(1));
    expect(ledger.months[0][0].date).toBe('2026-10-12');

    const on = itemOnCard(ledger, simplii, context);
    expect(on.gross).toBeCloseTo(12 * netflixMonth);
    expect(on.net).toBeCloseTo(12 * netflixMonth * 0.985);
    expect(on.posted[0]).toBeCloseTo(netflixMonth);
    expect(on).toMatchObject({ converted: false, leftOut: 0 });
    const bare = itemOnCard(ledger, undefined, context);
    expect(bare.net).toBe(bare.gross);
    expect(bare.posted).toEqual(Array(12).fill(0));
  });

  it('count an annual plan in the month it’s charged, and add the FX fee to a foreign one', () => {
    // €60 a year, renewing Nov 12, with Ontario's 13%: the test catalog's Mullvad doesn't include tax.
    const ledger = itemLedger(resolved('mullvad.vpn', { billing: yearly }), context);
    const on = itemOnCard(ledger, simplii, context);
    const inCad = (60 * 1.13) / 0.664;
    expect(on.posted[1]).toBeCloseTo(inCad * 1.025);
    expect(on.posted.filter((amount) => amount > 0)).toHaveLength(1);
    expect(on.net).toBeCloseTo(inCad * 1.025 * 0.985);
    expect(on.converted).toBe(true);
  });

  it('leave out what they have no rate for', () => {
    const ledger = itemLedger(resolved('mullvad.vpn', { billing: yearly }, noRates), context);
    expect(itemOnCard(ledger, simplii, { ...context, fx: undefined }).leftOut).toBe(1);
  });
});

describe('cardLoads and overLimits', () => {
  const tight: PaymentCard = { ...simplii, monthlyLimit: 100 };

  it('add up what each card’s items post to it, a month at a time', () => {
    const netflix = resolved('netflix.standard', { cardId: simplii.id });
    const crave = resolved('crave.standard', { cardId: simplii.id });
    const loads = cardLoads(
      [itemLedger(netflix, context), itemLedger(crave, context)],
      [simplii],
      context,
    );
    expect(loads.get(simplii.id)?.[0]).toBeCloseTo(netflixMonth + 11.99 * 1.13);
  });

  it('flag a month over the limit, from the day that takes it over', () => {
    const netflix = resolved('netflix.standard', { cardId: tight.id });
    // A year of Crave, renewing on Nov 20: November goes over the $100 limit that day.
    const crave = resolved('crave.standard', {
      cardId: tight.id,
      billing: { ...yearly, anchorDate: '2026-11-20', autoRenew: true },
    });
    const found = overLimits([netflix, crave], [tight], limitMonths(today), context);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      cardId: tight.id,
      month: '2026-11',
      limit: 100,
      days: ['2026-11-20'],
    });
    expect(found[0].posted).toBeCloseTo(netflixMonth + 119.99 * 1.13);
    // A card with no limit is never over it.
    expect(
      overLimits([netflix, crave], [{ ...tight, monthlyLimit: undefined }], ['2026-11'], context),
    ).toEqual([]);
  });
});

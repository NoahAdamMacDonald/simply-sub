import { describe, expect, it } from 'vitest';
import { costBreakdown, itemCharges, monthRange, resolveItem, type ListItem } from '../../src';
import { catalog, fx, item, today } from '../optimizer/fixtures';

// What a budget bar adds up (M10.30): a period's charges by subscription, with price, tax, FX fee and rate.

const place = { country: 'CA', subdivision: 'CA-AB' };
const cards = new Map([
  ['fx', { network: 'visa' as const, currency: 'CAD', cashbackPercent: 0, fxFeePercent: 2.5 }],
]);

function charges(listItem: ListItem) {
  const result = resolveItem(listItem, {
    catalog,
    customSubs: new Map(),
    country: 'CA',
    currency: 'CAD',
    fx,
    today,
    profileRanks: new Map(),
    taxPlace: place,
    cards,
  });
  if (!result.ok) throw new Error(result.unresolved.reason);
  return itemCharges(result.resolved, monthRange('2026-11'), place);
}

describe('costBreakdown', () => {
  const mullvad = item('mullvad.vpn', {}, { cardId: 'fx' });
  const netflix = item('netflix.standard');
  const breakdown = costBreakdown([...charges(mullvad), ...charges(netflix)], 'CAD');

  it('splits each subscription into price, tax and FX fee, biggest first', () => {
    const [first, second] = breakdown.lines;
    expect(first).toMatchObject({ itemId: netflix.id, count: 1, fxFee: 0, converted: false });
    expect(first.price).toBeCloseTo(18.99, 4);
    expect(first.tax).toBeCloseTo(0.9495, 4);
    expect(first.charged).toBeUndefined();
    // Mullvad's €5 includes VAT, so no tax is added; at 0.64 €/$ it's $7.81, and 2.5% of that is the card's fee.
    expect(second.itemId).toBe(mullvad.id);
    expect(second.price).toBeCloseTo(7.8125, 4);
    expect(second.tax).toBe(0);
    expect(second.fxFee).toBeCloseTo(0.1953, 4);
    expect(second.charged?.amount).toBe(5);
    expect(second.charged?.currency).toBe('EUR');
    expect(second.charged?.rate).toBeCloseTo(1.5625, 4);
  });

  it('adds up to the charges’ total', () => {
    expect(breakdown.price + breakdown.tax + breakdown.fxFee).toBeCloseTo(breakdown.total, 6);
    expect(breakdown.total).toBeCloseTo(19.9395 + 8.0078, 3);
    expect(breakdown.converted).toBe(true);
  });
});

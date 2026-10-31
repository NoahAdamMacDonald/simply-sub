import { describe, expect, it } from 'vitest';
import {
  itemCharges,
  itemLedger,
  itemOnCard,
  listMetrics,
  monthRange,
  resolveItem,
  type CardTerms,
  type ListItem,
  type ResolvedItem,
} from '../../src';
import { catalog, fx, item, today } from '../optimizer/fixtures';

// Card fees in the budgets (BLUEPRINT §9.3, M10.29): a charge paid with a card includes its FX fee, which every total
// counts; its cash back is carried, added up for the year, and never taken off.

const place = { country: 'CA', subdivision: 'CA-AB' };
const fxCard: CardTerms = {
  network: 'visa',
  currency: 'CAD',
  cashbackPercent: 0,
  fxFeePercent: 2.5,
};
const cashCard: CardTerms = {
  network: 'visa',
  currency: 'CAD',
  cashbackPercent: 2,
  fxFeePercent: 0,
};
const cards = new Map([
  ['fx', fxCard],
  ['cash', cashCard],
]);

function resolved(listItem: ListItem): ResolvedItem {
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
  return result.resolved;
}

// Mullvad: €5 a month, tax included, ≈ $7.81 at 0.64 €/$.
const mullvad = (cardId?: string) =>
  resolved(item('mullvad.vpn', {}, cardId === undefined ? {} : { cardId: cardId }));

describe('a charge paid with a card', () => {
  it('includes the card’s FX fee on a charge in another currency', () => {
    const [plain] = itemCharges(mullvad(), monthRange('2026-11'), place);
    const [paid] = itemCharges(mullvad('fx'), monthRange('2026-11'), place);
    expect(plain.amount).toBeCloseTo(7.8125, 4);
    expect(paid.fxFee).toBeCloseTo(0.1953, 4);
    expect(paid.amount).toBeCloseTo(8.0078, 4);
    expect(paid.cashback).toBeUndefined();
    // What the provider charges stays as it was: the card maths start from it.
    expect(paid.charged).toEqual(plain.charged);
  });

  it('has no fee in the card’s own currency, and carries its cash back', () => {
    const [netflix] = itemCharges(
      resolved(item('netflix.standard', {}, { cardId: 'cash' })),
      monthRange('2026-11'),
      place,
    );
    // $18.99 with Alberta's 5%: $19.94, 2% back.
    expect(netflix.fxFee).toBeUndefined();
    expect(netflix.amount).toBeCloseTo(19.9395, 4);
    expect(netflix.cashback).toBeCloseTo(0.3988, 4);
  });

  it('counts in the totals and the budget checks, and the year’s cash back is shown apart', () => {
    const items = [mullvad('fx'), resolved(item('netflix.standard', {}, { cardId: 'cash' }))];
    const metrics = listMetrics(
      { resolved: items, unresolved: [] },
      { today, currency: 'CAD', place, registry: catalog.features, monthlyBudget: 27.9 },
    );
    // This month: Mullvad ≈ $8.01 with its fee and Netflix $19.94, over a $27.90 budget only with the fee.
    expect(metrics.warnings.month?.month).toBe('2026-10');
    expect(metrics.warnings.month?.amount).toBeCloseTo(27.9473, 3);
    // With no start date, both are charged on the 10th of every month this year: 2% of Netflix's each time.
    expect(metrics.cashback.thisYear).toBeCloseTo(12 * 0.3988, 3);
    expect(metrics.thisYear).toBeCloseTo(12 * 27.9473, 2);
  });

  it('isn’t counted twice when the item is weighed on another card', () => {
    const ledger = itemLedger(mullvad('fx'), { today, currency: 'CAD', place, fx });
    const noCard = itemOnCard(ledger, undefined, { today, currency: 'CAD', place, fx });
    const onFx = itemOnCard(ledger, fxCard, { today, currency: 'CAD', place, fx });
    expect(noCard.gross).toBeCloseTo(12 * 7.8125, 3);
    expect(onFx.net).toBeCloseTo(12 * 8.0078, 3);
  });
});

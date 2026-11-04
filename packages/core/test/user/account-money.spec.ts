import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  chargesIn,
  interestAYear,
  listMetrics,
  netCostAYear,
  next12Range,
  readCatalogSource,
  resolveItem,
  waiverMet,
  type Account,
  type ItemAccount,
  type ListItem,
  type ResolveContext,
  type ResolvedItem,
} from '../../src';
import { bank, chequing, fintech, rates, withFinance } from '../catalog/finance-files';

// An account's money terms (PROJECT-PLAN §3.1, M11.12): the fee after waivers, interest a year, and net cost, on the
// finance fixtures: Example Bank's $17.95 chequing that a $4,000 balance waives, Example Fintech's savings at 2% free
// or 3.5% for $22 a month.

const today = '2026-11-04';
const facts = (amount: number, changes: Partial<ItemAccount> = {}): ItemAccount => ({
  balance: { amount, currency: 'CAD' },
  asOf: today,
  ...changes,
});

describe('waiverMet', () => {
  it('is the first waiver the facts meet, and none when they meet none or can’t tell', () => {
    const either: Account = {
      ...chequing,
      waivers: [{ minBalance: 4000 }, { directDeposit: true }],
    };
    expect(waiverMet(either, facts(4000), today)).toEqual({ minBalance: 4000 });
    expect(waiverMet(either, facts(100, { directDeposit: 1500 }), today)).toEqual({
      directDeposit: true,
    });
    expect(waiverMet(either, facts(3999), today)).toBeUndefined();
    expect(waiverMet({ ...chequing, waivers: undefined }, facts(9000), today)).toBeUndefined();
  });
});

describe('interestAYear', () => {
  const tiered = (applies: 'whole' | 'portion'): Account => ({
    ...chequing,
    rates: { ...rates({ from: 0, rate: 1.25 }, { from: 5000, rate: 2 }), applies },
  });

  it('pays the whole balance the rate of the highest tier it reaches', () => {
    expect(interestAYear(tiered('whole'), facts(4000), today)).toEqual({
      amount: 50,
      currency: 'CAD',
      rate: 1.25,
    });
    expect(interestAYear(tiered('whole'), facts(8000), today)).toEqual({
      amount: 160,
      currency: 'CAD',
      rate: 2,
    });
  });

  it('pays each part of the balance its own tier’s rate', () => {
    // $5,000 at 1.25% and $3,000 at 2%: $62.50 + $60.
    const interest = interestAYear(tiered('portion'), facts(8000), today);
    expect(interest?.amount).toBeCloseTo(122.5, 10);
    expect(interest?.rate).toBeCloseTo(1.53125, 10);
    expect(interestAYear(tiered('portion'), facts(0), today)).toEqual({
      amount: 0,
      currency: 'CAD',
      rate: 1.25,
    });
  });

  it('pays the bonus rate on the whole balance when the facts earn it, and the tiers when they can’t tell', () => {
    const bonus: Account = {
      ...tiered('portion'),
      rates: { ...tiered('portion').rates!, bonus: { rate: 3, when: { directDeposit: 2000 } } },
    };
    expect(interestAYear(bonus, facts(8000, { directDeposit: 2000 }), today)).toEqual({
      amount: 240,
      currency: 'CAD',
      rate: 3,
      bonus: true,
    });
    expect(interestAYear(bonus, facts(8000), today)?.amount).toBeCloseTo(122.5, 10);
  });

  it('is none without posted rates', () => {
    expect(interestAYear(chequing, facts(8000), today)).toBeUndefined();
  });
});

describe('an account item, resolved (M11.12)', () => {
  const data = buildCatalogData(
    readCatalogSource(withFinance([bank, fintech])),
    'https://sub.simplely.ca/icons/',
  );
  const context: ResolveContext = {
    catalog: data,
    customSubs: new Map(),
    country: 'CA',
    currency: 'CAD',
    fx: {
      base: 'CAD',
      date: '2026-11-03',
      source: 'European Central Bank via Frankfurter',
      rates: { USD: 0.72 },
    },
    today,
    profileRanks: new Map(),
    taxPlace: { country: 'CA', subdivision: 'CA-ON' },
  };
  const place = { country: 'CA', subdivision: 'CA-ON' };

  function account(planId: string, extra: Partial<ListItem> = {}): ResolvedItem {
    const result = resolveItem(
      {
        id: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c70',
        listId: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d',
        source: { kind: 'catalog', planId },
        billing: {
          mode: 'recurring',
          interval: 'month',
          intervalCount: 1,
          anchorDate: '2026-11-20',
          autoRenew: true,
        },
        tagIds: [],
        rankOverrides: {},
        pinned: false,
        createdAt: '2026-10-20T12:00:00.000Z',
        updatedAt: '2026-10-20T12:00:00.000Z',
        ...extra,
      },
      context,
    );
    if (!result.ok) throw new Error(result.unresolved.reason);
    return result.resolved;
  }
  const year = next12Range(today);

  it('waives the fee when the balance meets a waiver: no charges, its fee kept for its card', () => {
    const waived = account('example-bank.unlimited', { account: facts(4000) });
    expect(waived.account).toEqual(chequing);
    expect(waived.feeWaived).toMatchObject({ by: { minBalance: 4000 }, fee: { amount: 17.95 } });
    expect(waived.price).toMatchObject({ amount: 0, monthlyEquivalent: 0, native: true });
    expect(waived.monthlyEquivalent).toBe(0);
    expect(waived.nextCharge).toBeUndefined();
    expect(chargesIn([waived], year, place)).toEqual([]);
    expect(waived.status.kind).toBe('active');
  });

  it('adds no sales tax to an account’s fee, which its price says (the owner’s choice)', () => {
    const fee = account('example-bank.unlimited', { account: facts(100) });
    expect(fee.price).toMatchObject({ amount: 17.95, taxIncluded: true, taxFree: true });
    expect(chargesIn([fee], year, place).map(({ amount, tax }) => [amount, tax])[0]).toEqual([
      17.95, 0,
    ]);
  });

  it('charges the fee when the facts meet no waiver, or there are none', () => {
    for (const charged of [
      account('example-bank.unlimited', { account: facts(3999) }),
      account('example-bank.unlimited'),
    ]) {
      expect(charged.feeWaived).toBeUndefined();
      expect(charged.price.amount).toBe(17.95);
      expect(chargesIn([charged], year, place)).toHaveLength(12);
    }
  });

  it('ignores a price the user typed while the fee is waived', () => {
    const waived = account('example-bank.unlimited', {
      account: facts(5000),
      priceOverride: { amount: 9.95, currency: 'CAD' },
    });
    expect(waived.override).toBeUndefined();
    expect(waived.overridePrice).toBeUndefined();
    expect(chargesIn([waived], year, place)).toEqual([]);
  });

  it('earns interest a year on the balance while it’s active, converted into the user’s currency', () => {
    expect(account('example-fintech.everything', { account: facts(10_000) }).interest).toEqual({
      amount: 350,
      currency: 'CAD',
      rate: 3.5,
      converted: false,
    });
    const inUsd = account('example-fintech.essential', {
      account: { balance: { amount: 7200, currency: 'USD' }, asOf: today },
    }).interest;
    // $144 US at 0.72 a Canadian dollar.
    expect(inUsd?.amount).toBeCloseTo(200, 10);
    expect(inUsd).toMatchObject({ currency: 'CAD', rate: 2, converted: true });
    // Ended: no interest.
    const ended = account('example-fintech.everything', {
      account: facts(10_000),
      billing: {
        mode: 'recurring',
        interval: 'month',
        intervalCount: 1,
        anchorDate: '2026-10-20',
        endDate: '2026-11-01',
        autoRenew: true,
      },
    });
    expect(ended.status.kind).toBe('inactive');
    expect(ended.interest).toBeUndefined();
    expect(account('example-fintech.everything').interest).toBeUndefined();
  });

  it('counts interest beside the totals, never in them, and nets it against the fees', () => {
    const essential = account('example-fintech.essential', { account: facts(5000) });
    const everything = account('example-fintech.everything', { account: facts(10_000) });
    const metrics = listMetrics(
      { resolved: [essential, everything], unresolved: [] },
      { today, currency: 'CAD', place, registry: [] },
    );
    // $100 at 2% and $350 at 3.5%; only Everything's $22 a month is spent, with no sales tax on an account's fee.
    expect(metrics.interest).toEqual({ amount: 450, approx: false });
    expect(metrics.next12).toBeCloseTo(22 * 12, 10);

    const money = { today, currency: 'CAD', place };
    expect(netCostAYear(essential, money)).toEqual({ amount: -100, approx: false });
    expect(netCostAYear(everything, money)?.amount).toBeCloseTo(22 * 12 - 350, 10);
    expect(netCostAYear(account('example-bank.unlimited', { account: facts(4000) }), money)).toBe(
      undefined,
    );
  });
});

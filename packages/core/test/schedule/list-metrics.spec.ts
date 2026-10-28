import { describe, expect, it } from 'vitest';
import {
  chargeTotal,
  itemStatus,
  listMetrics,
  monthRange,
  next12Range,
  yearRange,
  type Billing,
  type Charge,
  type ListItem,
  type MetricsContext,
  type PickedPrice,
  type ResolvedItem,
} from '../../src';

// Totals, budget checks and statuses (PROJECT-PLAN §3.1, §3.3), with today fixed.

const today = '2026-10-28';
const listId = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const context: MetricsContext = {
  today,
  currency: 'CAD',
  place: { country: 'CA', subdivision: 'CA-AB' },
  registry: [],
};

let nextId = 0;
function picked(amount: number, extra: Partial<PickedPrice> = {}): PickedPrice {
  return {
    interval: 'month',
    intervalCount: 1,
    amount,
    currency: 'CAD',
    monthlyEquivalent: amount,
    autoRenew: true,
    native: true,
    source: { region: 'CA', amount, currency: 'CAD' },
    ...extra,
  };
}

/** A resolved item with only what totals read. */
function resolved(
  billing: Partial<Billing>,
  price: PickedPrice,
  extra: Partial<ListItem> = {},
): ResolvedItem {
  const item: ListItem = {
    id: `0192f1c5-1c2d-7e3f-8a4b-${String(nextId++).padStart(12, '0')}`,
    listId,
    source: { kind: 'catalog', planId: 'netflix.standard' },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-11-12',
      autoRenew: true,
      ...billing,
    } as Billing,
    tagIds: [],
    rankOverrides: {},
    pinned: false,
    createdAt: '2026-10-20T12:00:00.000Z',
    updatedAt: '2026-10-20T12:00:00.000Z',
    ...extra,
  };
  return {
    item,
    listId,
    name: 'Netflix',
    planName: 'Standard',
    region: 'CA',
    price,
    addOns: [],
    monthlyEquivalent: price.monthlyEquivalent,
    features: {},
    categories: [],
    providedKeys: [],
    effectiveRanks: {},
    status: { kind: 'active', manual: false },
  };
}

const round = (amount: number) => Math.round(amount * 1e6) / 1e6;

describe('ranges', () => {
  it('cover this month, this year and the next 12 months', () => {
    expect(monthRange('2026-10')).toEqual({ from: '2026-10-01', to: '2026-11-01' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
    expect(yearRange(today)).toEqual({ from: '2026-01-01', to: '2027-01-01' });
    // Up to, not including, the same day next year; Feb 29's is Feb 28.
    expect(next12Range(today)).toEqual({ from: today, to: '2027-10-28' });
    expect(next12Range('2028-02-29')).toEqual({ from: '2028-02-29', to: '2029-02-28' });
  });
});

describe('chargeTotal', () => {
  const charge = (amount: number, extra: Partial<Charge> = {}): Charge => ({
    date: today,
    amount,
    tax: 0,
    currency: 'CAD',
    itemId: '',
    listId,
    converted: false,
    manual: false,
    charged: { amount, currency: 'CAD' },
    ...extra,
  });

  it('adds the charges in the currency, marking a total with a converted one', () => {
    expect(chargeTotal([charge(10), charge(2.5)], 'CAD')).toEqual({ amount: 12.5, approx: false });
    expect(chargeTotal([charge(10), charge(2.5, { converted: true })], 'CAD')).toEqual({
      amount: 12.5,
      approx: true,
    });
  });

  it('leaves out one in another currency, which there was no rate to convert', () => {
    expect(chargeTotal([charge(10), charge(5, { currency: 'EUR' })], 'CAD')).toEqual({
      amount: 10,
      approx: false,
    });
  });
});

describe('listMetrics', () => {
  it('adds up this month, this year (earlier charges too, with no start date) and the next 12 months, with tax', () => {
    // Netflix monthly on the 12th at $18.99, 5% in Alberta.
    const netflix = resolved({}, picked(18.99));
    const metrics = listMetrics({ resolved: [netflix], unresolved: [] }, context);
    expect(round(metrics.thisMonth)).toBe(round(18.99 * 1.05));
    expect(round(metrics.thisYear)).toBe(round(12 * 18.99 * 1.05));
    expect(round(metrics.next12)).toBe(round(12 * 18.99 * 1.05));
    expect(metrics.approx).toBe(false);
    expect(metrics.notCounted).toBe(0);
  });

  it('counts a yearly charge once in the next 12 months, even on the day it renews', () => {
    const yearly = resolved(
      { interval: 'year', anchorDate: today },
      picked(120, { interval: 'year' }),
    );
    const metrics = listMetrics({ resolved: [yearly], unresolved: [] }, context);
    expect(round(metrics.next12)).toBe(126);
    expect(round(metrics.thisMonth)).toBe(126);
    expect(round(metrics.thisYear)).toBe(126);
  });

  it('counts both charges of a 30-day plan in a month that has two', () => {
    const thirty = resolved(
      { interval: 'day', intervalCount: 30, anchorDate: '2026-10-01' },
      picked(10, { interval: 'day', intervalCount: 30 }),
    );
    expect(round(listMetrics({ resolved: [thirty], unresolved: [] }, context).thisMonth)).toBe(21);
  });

  it('counts every item, duplicates too, and says how many it left out', () => {
    const netflix = resolved({}, picked(10));
    const again = resolved({}, picked(10));
    const noRate = resolved({}, picked(5, { currency: 'EUR', native: false }));
    const metrics = listMetrics({ resolved: [netflix, again, noRate], unresolved: [{}] }, context);
    expect(round(metrics.thisMonth)).toBe(21);
    // The unresolved item and the one with no rate.
    expect(metrics.notCounted).toBe(2);
  });

  it('marks totals with a converted charge as approximate, each on its own', () => {
    const converted = resolved(
      {},
      picked(13.79, { native: false, fx: { rate: 1.38, date: today, source: 'ECB' } }),
    );
    expect(listMetrics({ resolved: [converted], unresolved: [] }, context).approx).toBe(true);
    // Converted, but charged in March only: this month's total is exact.
    const yearly = resolved(
      { interval: 'year', anchorDate: '2027-03-01', startDate: '2027-03-01' },
      picked(50, {
        interval: 'year',
        native: false,
        fx: { rate: 1.38, date: today, source: 'ECB' },
      }),
    );
    const native = resolved({}, picked(10));
    expect(listMetrics({ resolved: [yearly, native], unresolved: [] }, context).converted).toEqual({
      thisMonth: false,
      thisYear: false,
      next12: true,
    });
  });

  it('gives each item its share of the next 12 months', () => {
    const big = resolved({}, picked(30));
    const small = resolved({}, picked(10));
    const free = resolved({}, picked(0));
    const { shares } = listMetrics({ resolved: [big, small, free], unresolved: [] }, context);
    expect(round(shares.get(big.item.id) ?? 0)).toBe(0.75);
    expect(round(shares.get(small.item.id) ?? 0)).toBe(0.25);
    expect(shares.has(free.item.id)).toBe(false);
  });

  it('says what share of each budget this month and this year use', () => {
    const netflix = resolved({}, picked(20, { taxIncluded: true }));
    const metrics = listMetrics(
      { resolved: [netflix], unresolved: [] },
      { ...context, monthlyBudget: 40, annualBudget: 480 },
    );
    expect(metrics.monthlyBudgetShare).toBe(0.5);
    expect(metrics.annualBudgetShare).toBe(0.5);
    expect(listMetrics({ resolved: [netflix], unresolved: [] }, context)).not.toHaveProperty(
      'monthlyBudgetShare',
    );
  });

  describe('budget checks', () => {
    it('names the first of the next 12 months whose charges go over the monthly budget', () => {
      // $20 a month, and a yearly $50 in March: March 2027 comes to $70.
      const monthly = resolved({}, picked(20, { taxIncluded: true }));
      const yearly = resolved(
        { interval: 'year', anchorDate: '2027-03-01' },
        picked(50, { interval: 'year', taxIncluded: true }),
      );
      const { warnings } = listMetrics(
        { resolved: [monthly, yearly], unresolved: [] },
        { ...context, monthlyBudget: 60 },
      );
      expect(warnings.month).toEqual({ month: '2027-03', amount: 70, approx: false });
    });

    it('counts this month, and looks no further than 12 months on', () => {
      const now = resolved({}, picked(100, { taxIncluded: true }));
      expect(
        listMetrics({ resolved: [now], unresolved: [] }, { ...context, monthlyBudget: 50 }).warnings
          .month?.month,
      ).toBe('2026-10');
      // It starts in 13 months: with no start date it would have been charged on Oct 1 this year.
      const late = resolved(
        { interval: 'year', anchorDate: '2027-10-01', startDate: '2027-10-01' },
        picked(100, { interval: 'year', taxIncluded: true }),
      );
      expect(
        listMetrics({ resolved: [late], unresolved: [] }, { ...context, monthlyBudget: 50 })
          .warnings,
      ).toEqual({});
    });

    it('warns when this year’s charges, past and projected, go over the annual budget', () => {
      const monthly = resolved({}, picked(20, { taxIncluded: true }));
      expect(
        listMetrics({ resolved: [monthly], unresolved: [] }, { ...context, annualBudget: 200 })
          .warnings.year,
      ).toEqual({ year: 2026, amount: 240, approx: false });
      expect(
        listMetrics({ resolved: [monthly], unresolved: [] }, { ...context, annualBudget: 240 })
          .warnings,
      ).toEqual({});
    });
  });
});

describe('itemStatus', () => {
  const item = (billing: Partial<Billing>): ListItem => resolved(billing, picked(10)).item;
  const charge = (manual: boolean): Charge => ({
    date: '2026-11-12',
    amount: 10,
    tax: 0,
    currency: 'CAD',
    itemId: '',
    listId,
    converted: false,
    manual,
    charged: { amount: 10, currency: 'CAD' },
  });

  it('is active or inactive from its dates, with when it starts again', () => {
    expect(itemStatus(item({}), today, charge(false))).toEqual({ kind: 'active', manual: false });
    expect(itemStatus(item({ startDate: '2026-12-01' }), today, charge(false))).toEqual({
      kind: 'inactive',
      activeFrom: '2026-12-01',
      manual: false,
    });
  });

  it('ends within the next 30 days, not further, and not once it has ended', () => {
    expect(itemStatus(item({ endDate: '2026-11-27' }), today, undefined).endsOn).toBe('2026-11-27');
    expect(itemStatus(item({ endDate: '2026-11-28' }), today, undefined).endsOn).toBeUndefined();
    expect(itemStatus(item({ endDate: today }), today, undefined)).toEqual({
      kind: 'inactive',
      manual: false,
    });
  });

  it('is a manual renewal when its next charge is', () => {
    expect(itemStatus(item({ autoRenew: false }), today, charge(true)).manual).toBe(true);
    expect(itemStatus(item({ autoRenew: false }), today, undefined).manual).toBe(false);
  });
});

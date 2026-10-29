import { describe, expect, it } from 'vitest';
import {
  priceChangesBetween,
  withPriceChanges,
  type CatalogData,
  type PriceChange,
} from '../../src';
import { catalog, fx, item, today } from '../optimizer/fixtures';

// Price changes for Home (M7.10): what a catalog update changed in the prices of the lists' plans.

const context = {
  customSubs: new Map(),
  country: 'CA',
  currency: 'CAD',
  fx,
  today,
  profileRanks: new Map(),
};

/** The catalog with one plan's prices changed by `delta`. */
function withPrice(planId: string, delta: number): CatalogData {
  return {
    ...catalog,
    providers: catalog.providers.map((provider) => ({
      ...provider,
      plans: provider.plans.map((plan) =>
        plan.id === planId
          ? {
              ...plan,
              prices: plan.prices.map((price) => ({ ...price, amount: price.amount + delta })),
            }
          : plan,
      ),
    })),
  };
}

describe('priceChangesBetween', () => {
  it('finds a listed plan whose price changed, for its period, and nothing for the rest', () => {
    const netflix = item('netflix.standard');
    const crave = item('crave.premium');
    const changes = priceChangesBetween(
      [netflix, crave],
      catalog,
      withPrice('netflix.standard', 1),
      context,
    );
    expect(changes).toEqual([
      expect.objectContaining({
        planId: 'netflix.standard',
        title: 'Netflix Standard',
        currency: 'CAD',
        interval: 'month',
        intervalCount: 1,
        date: today,
      }),
    ]);
    expect(changes[0].to - changes[0].from).toBeCloseTo(1, 5);
  });
});

describe('withPriceChanges', () => {
  const change = (planId: string, date: string): PriceChange => ({
    planId,
    title: planId,
    currency: 'CAD',
    interval: 'month',
    intervalCount: 1,
    from: 1,
    to: 2,
    date,
  });

  it('puts the new ones first, replaces an older one of the same plan, and drops what’s a month old', () => {
    const kept = [change('netflix.standard', '2026-10-20'), change('crave.premium', '2026-09-01')];
    const merged = withPriceChanges(kept, [change('netflix.standard', today)], today);
    expect(merged.map((entry) => `${entry.planId} ${entry.date}`)).toEqual([
      `netflix.standard ${today}`,
    ]);
  });
});

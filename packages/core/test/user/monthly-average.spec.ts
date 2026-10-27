import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  monthlyAverage,
  readCatalogSource,
  resolveItem,
  type ListItem,
  type ResolveContext,
  type ResolvedItem,
} from '../../src';
import { catalog } from '../catalog/catalog-files';
import { listId } from './fixtures';

const canadian: ResolveContext = {
  catalog: buildCatalogData(readCatalogSource(catalog()), 'https://sub.simplely.ca/icons/'),
  customSubs: new Map(),
  country: 'CA',
  currency: 'CAD',
  fx: {
    base: 'CAD',
    date: '2026-10-21',
    source: 'European Central Bank via Frankfurter',
    rates: { EUR: 0.664, USD: 0.7243 },
  },
  today: '2026-10-26',
  profileRanks: new Map(),
};
const noRates: ResolveContext = { ...canadian, fx: undefined };

function resolved(
  planId: string,
  extra: Partial<ListItem> = {},
  context: ResolveContext = canadian,
): ResolvedItem {
  const result = resolveItem(
    {
      id: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c60',
      listId,
      source: { kind: 'catalog', planId },
      billing: {
        mode: 'recurring',
        interval: 'month',
        intervalCount: 1,
        anchorDate: '2026-11-12',
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

const yearly: ListItem['billing'] = {
  mode: 'recurring',
  interval: 'year',
  intervalCount: 1,
  anchorDate: '2026-11-12',
  autoRenew: false,
};

describe('monthlyAverage', () => {
  it('is nothing for no items', () => {
    expect(monthlyAverage([], 'CAD')).toEqual({
      amount: 0,
      currency: 'CAD',
      approx: false,
      leftOut: 0,
    });
  });

  it('adds the items’ monthly equivalents, exact while every price is in the user’s currency', () => {
    const netflix = resolved('netflix.standard');
    const crave = resolved('crave.standard', { billing: { ...yearly, autoRenew: true } });
    const average = monthlyAverage([netflix, crave], 'CAD');
    expect(average.amount).toBeCloseTo(18.99 + 119.99 / 12);
    expect(average.approx).toBe(false);
  });

  it('is approximate with a converted price', () => {
    const mullvad = resolved('mullvad.vpn', { billing: yearly });
    const average = monthlyAverage([resolved('netflix.standard'), mullvad], 'CAD');
    expect(average.amount).toBeCloseTo(18.99 + 60 / 0.664 / 12);
    expect(average).toMatchObject({ approx: true, leftOut: 0 });
  });

  it('leaves out and counts an item priced in another currency for want of a rate', () => {
    const mullvad = resolved('mullvad.vpn', { billing: yearly }, noRates);
    expect(monthlyAverage([resolved('netflix.standard'), mullvad], 'CAD')).toEqual({
      amount: 18.99,
      currency: 'CAD',
      approx: false,
      leftOut: 1,
    });
  });

  it('counts a price override in place of the plan and its add-ons', () => {
    const netflix = resolved('netflix.standard', {
      source: {
        kind: 'catalog',
        planId: 'netflix.standard',
        addOns: [{ id: 'netflix.extra-member', quantity: 2 }],
      },
      priceOverride: { amount: 15.99, currency: 'CAD' },
    });
    expect(monthlyAverage([netflix], 'CAD')).toMatchObject({ amount: 15.99, approx: false });
    const inDollars = resolved('netflix.standard', {
      priceOverride: { amount: 10, currency: 'USD' },
    });
    expect(monthlyAverage([inDollars], 'CAD').approx).toBe(true);
    expect(
      monthlyAverage([resolved('netflix.standard', inDollars.item, noRates)], 'CAD'),
    ).toMatchObject({ amount: 0, leftOut: 1 });
  });
});

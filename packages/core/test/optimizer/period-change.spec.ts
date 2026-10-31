import { describe, expect, it } from 'vitest';
import {
  formatCatalogIssue,
  itemCharges,
  missingIdIssue,
  missingIds,
  next12Range,
  pickPrice,
  priceSchema,
  publishedIds,
  resolveItem,
  validateCatalog,
  type CatalogData,
  type ListItem,
  type Price,
  type ResolvedItem,
} from '../../src';
import { catalog as files, edited, today as catalogToday } from '../catalog/catalog-files';
import { issues } from '../catalog/helpers';
import { catalog, fx, item, today } from './fixtures';

// A billing period no longer sold (BLUEPRINT §4.3, M10.28): its price stays, retired. Nothing sells it, but an item
// billed that way keeps it until its next renewal on or after the date, then switches to the closest period still sold,
// unless the user keeps it (grandfathered).

const place = { country: 'CA', subdivision: 'CA-AB' };

/** The fixture catalog with Disney+ Standard's monthly price retired (and `extra` on it). */
function monthlyRetired(extra: Partial<Price> = { retired: '2026-10-20' }): CatalogData {
  return {
    ...catalog,
    providers: catalog.providers.map((provider) => ({
      ...provider,
      plans: provider.plans.map((plan) =>
        plan.id === 'disney-plus.standard'
          ? {
              ...plan,
              prices: plan.prices.map((price) =>
                price.interval === 'month' ? { ...price, ...extra } : price,
              ),
            }
          : plan,
      ),
    })),
  };
}

function resolved(data: CatalogData, listItem: ListItem): ResolvedItem {
  const result = resolveItem(listItem, {
    catalog: data,
    customSubs: new Map(),
    country: 'CA',
    currency: 'CAD',
    fx,
    today,
    profileRanks: new Map(),
    taxPlace: place,
  });
  if (!result.ok) throw new Error(result.unresolved.reason);
  return result.resolved;
}

const monthly = item('disney-plus.standard');

describe('a retired price', () => {
  it('is sold to no one, but an item billed on it keeps it until it switches', () => {
    const data = monthlyRetired();
    const plan = data.providers
      .find(({ id }) => id === 'disney-plus')
      ?.plans.find(({ id }) => id === 'disney-plus.standard');
    const prices = plan?.prices ?? [];
    const context = { region: 'CA', currency: 'CAD' };
    expect(pickPrice(prices, context).map(({ interval }) => interval)).toEqual(['year']);
    expect(pickPrice(prices, { ...context, withRetired: true })).toHaveLength(2);

    const disney = resolved(data, monthly);
    expect(disney.price.amount).toBe(12.99);
    expect(disney.periodChange).toEqual({
      retired: '2026-10-20',
      on: '2026-11-10',
      to: expect.objectContaining({ interval: 'year', amount: 129.99 }),
    });
  });

  it('switches at the renewal: the old period before, the closest one sold from then', () => {
    const disney = resolved(monthlyRetired(), monthly);
    const charges = itemCharges(disney, next12Range(today), place);
    expect(charges.map(({ date, charged }) => `${date} ${charged.amount.toFixed(2)}`)).toEqual([
      // The renewal is the switch: billed a year from Nov 10, with Alberta's 5%.
      '2026-11-10 136.49',
    ]);
    expect(charges.some((charge) => charge.ends)).toBe(false);
    expect(disney.nextCharge?.date).toBe('2026-11-10');
    expect(disney.nextCharge?.charged.amount).toBeCloseTo(136.49, 2);
  });

  it('waits for endsOn when existing subscribers keep it longer', () => {
    const disney = resolved(
      monthlyRetired({ retired: '2026-10-20', endsOn: '2027-01-01' }),
      monthly,
    );
    expect(disney.periodChange?.on).toBe('2027-01-10');
    const dates = itemCharges(disney, next12Range(today), place).map(
      ({ date, charged }) => `${date} ${charged.amount.toFixed(2)}`,
    );
    expect(dates).toEqual(['2026-11-10 13.64', '2026-12-10 13.64', '2027-01-10 136.49']);
  });

  it('stays as it is for an item grandfathered, or one that ends first', () => {
    const kept = resolved(monthlyRetired(), { ...monthly, grandfathered: true });
    expect(kept.periodChange).toBeUndefined();
    expect(itemCharges(kept, next12Range(today), place)).toHaveLength(12);
    const ending = resolved(
      monthlyRetired(),
      item('disney-plus.standard', { endDate: '2026-11-01' }),
    );
    expect(ending.periodChange).toBeUndefined();
  });

  it('keeps its last price when its price list sells nothing more', () => {
    const data: CatalogData = {
      ...catalog,
      providers: catalog.providers.map((provider) => ({
        ...provider,
        plans: provider.plans.map((plan) =>
          plan.id === 'crave.premium'
            ? { ...plan, prices: plan.prices.map((price) => ({ ...price, retired: '2026-10-20' })) }
            : plan,
        ),
      })),
    };
    const crave = resolved(data, item('crave.premium'));
    expect(crave.periodChange).toEqual({ retired: '2026-10-20', on: '2026-11-10' });
    expect(itemCharges(crave, next12Range(today), place)).toHaveLength(12);
  });
});

describe('a retired price in the catalog files', () => {
  const netflix = 'data/providers/netflix.yaml';
  const price = {
    region: 'CA',
    currency: 'CAD',
    amount: 18.99,
    interval: 'month',
    intervalCount: 1,
    autoRenew: true,
    lastVerified: '2026-10-20',
  };

  it('needs endsOn on or after retired, retired for endsOn, and retired by today', () => {
    expect(issues(priceSchema, { ...price, retired: '2026-10-20', endsOn: '2027-01-01' })).toEqual(
      [],
    );
    expect(issues(priceSchema, { ...price, endsOn: '2027-01-01' })).toEqual([
      'endsOn: endsOn needs retired',
    ]);
    expect(issues(priceSchema, { ...price, retired: '2026-10-20', endsOn: '2026-10-01' })).toEqual([
      'endsOn: Must be on or after retired (2026-10-20)',
    ]);
    const later = edited(files(), netflix, ['plans', 1, 'prices', 0, 'retired'], '2099-01-01');
    expect(validateCatalog(later, catalogToday).map((issue) => formatCatalogIssue(issue))).toEqual([
      `${netflix} plans.1.prices.0.retired: 2099-01-01 is after today (${catalogToday}): use the day the provider stopped selling it`,
    ]);
  });

  it('keeps the guard happy, where a period removed fails', () => {
    const main = files();
    const retired = edited(main, netflix, ['plans', 1, 'prices', 0, 'retired'], '2026-10-20');
    expect(missingIds(publishedIds(main), publishedIds(retired), [])).toEqual([]);
    const source = main.find(({ file }) => file === netflix);
    const plans = (
      source && 'data' in source
        ? (source.data as { plans: { prices: unknown[] }[] })
        : { plans: [] }
    ).plans;
    const removed = edited(main, netflix, ['plans', 1, 'prices'], plans[1].prices.slice(1));
    const lost = missingIds(publishedIds(main), publishedIds(removed), []);
    expect(lost.map((id) => formatCatalogIssue(missingIdIssue(id)))).toEqual([
      `${netflix}: netflix.standard's month/1 price in CA is published on main and gone here. Items are billed on it (BLUEPRINT §4.3): keep the price with retired: <date>, the day it stopped being sold (and endsOn when existing subscribers keep it longer), so their items switch at renewal`,
    ]);
  });
});

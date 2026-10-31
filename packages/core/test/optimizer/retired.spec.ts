import { describe, expect, it } from 'vitest';
import {
  itemCharges,
  next12Range,
  optimize,
  planNoticesBetween,
  resolveItem,
  type CatalogData,
  type ListItem,
  type Plan,
  type ProfileRank,
  type ResolvedItem,
} from '../../src';
import { catalog, fx, item, today } from './fixtures';

// A plan no longer sold is retired, never deleted (BLUEPRINT §4.3, M10.27): items on it still resolve and count, until
// its endsOn; nothing offers it; and before it ends, Optimizations lists plans that keep the item's Needed keys.

/** The fixture catalog with some plans changed. */
function catalogWith(changes: Record<string, Partial<Plan>>): CatalogData {
  return {
    ...catalog,
    providers: catalog.providers.map((provider) => ({
      ...provider,
      plans: provider.plans.map((plan) => ({ ...plan, ...changes[plan.id] })),
    })),
  };
}

const place = { country: 'CA', subdivision: 'CA-AB' };

function context(data: CatalogData, ranks: Record<string, ProfileRank> = {}) {
  return {
    today,
    country: 'CA',
    currency: 'CAD',
    fx,
    place,
    profileRanks: new Map(Object.entries(ranks)),
  };
}

function resolved(
  data: CatalogData,
  items: readonly ListItem[],
  ranks: Record<string, ProfileRank> = {},
): ResolvedItem[] {
  return items.map((listItem) => {
    const result = resolveItem(listItem, {
      catalog: data,
      customSubs: new Map(),
      ...context(data, ranks),
      taxPlace: place,
    });
    if (!result.ok) throw new Error(result.unresolved.reason);
    return result.resolved;
  });
}

function run(
  data: CatalogData,
  items: readonly ListItem[],
  ranks: Record<string, ProfileRank> = {},
) {
  return optimize({
    items: resolved(data, items, ranks),
    catalogs: new Map([['CA', data]]),
    context: context(data, ranks),
  });
}

describe('an item on a retired plan', () => {
  it('still resolves and counts, and says since when it isn’t sold', () => {
    const data = catalogWith({ 'netflix.standard': { retired: '2026-10-01' } });
    const [standard] = resolved(data, [item('netflix.standard')]);
    expect(standard.retired).toEqual({ since: '2026-10-01' });
    expect(standard.planEnds).toBeUndefined();
    expect(standard.monthlyEquivalent).toBeCloseTo(18.99, 5);
    expect(itemCharges(standard, next12Range(today), place)).toHaveLength(12);
  });

  it('isn’t retired before its date', () => {
    const data = catalogWith({ 'netflix.standard': { retired: '2026-12-01' } });
    expect(resolved(data, [item('netflix.standard')])[0].retired).toBeUndefined();
  });

  it('takes its provider’s retirement', () => {
    const data: CatalogData = {
      ...catalog,
      providers: catalog.providers.map((provider) =>
        provider.id === 'crave'
          ? { ...provider, retired: '2026-09-01', endsOn: '2027-01-31' }
          : provider,
      ),
    };
    const [crave] = resolved(data, [item('crave.premium')]);
    expect(crave.retired).toEqual({ since: '2026-09-01', endsOn: '2027-01-31' });
  });

  it('with endsOn, stops counting that day, and its status ends then', () => {
    const data = catalogWith({
      'netflix.standard': { retired: '2026-10-01', endsOn: '2026-11-20' },
    });
    const [standard] = resolved(data, [item('netflix.standard')]);
    expect(standard.planEnds).toBe('2026-11-20');
    expect(itemCharges(standard, next12Range(today), place).map(({ date }) => date)).toEqual([
      '2026-11-10',
    ]);
    expect(standard.status.endsOn).toBe('2026-11-20');
    // The item itself keeps its own dates: nothing is written to it.
    expect(standard.item.billing).not.toHaveProperty('endDate');
  });

  it('with endsOn after the item’s own end date, ends on its own', () => {
    const data = catalogWith({
      'netflix.standard': { retired: '2026-10-01', endsOn: '2027-06-01' },
    });
    const [standard] = resolved(data, [item('netflix.standard', { endDate: '2027-01-01' })]);
    expect(itemCharges(standard, next12Range(today), place).at(-1)?.date).toBe('2026-12-10');
  });
});

describe('the optimizer and retired plans', () => {
  it('never suggests one: a downgrade to it, its other period, a bundle or a suite with it', () => {
    const before = run(catalog, [
      item('netflix.premium'),
      item('disney-plus.premium'),
      item('crave.premium'),
    ]);
    const plans = (result: ReturnType<typeof run>) =>
      result.suggestions.flatMap((suggestion) =>
        suggestion.actions.flatMap((action) =>
          'planId' in action ? [action.planId] : 'bundleId' in action ? [action.bundleId] : [],
        ),
      );
    expect(plans(before)).toEqual(
      expect.arrayContaining(['netflix.standard-ads', 'bundle.disney-crave-premium']),
    );
    const after = run(
      catalogWith({
        'netflix.standard': { retired: '2026-10-01' },
        'netflix.standard-ads': { retired: '2026-10-01' },
        'crave.premium': { retired: '2026-10-01' },
      }),
      [item('netflix.premium'), item('disney-plus.premium'), item('crave.premium')],
    );
    expect(plans(after)).not.toEqual(expect.arrayContaining(['netflix.standard']));
    expect(plans(after)).not.toContain('netflix.standard-ads');
    expect(plans(after)).not.toContain('bundle.disney-crave-premium');
  });

  it('lists plans that keep an ending item’s Needed keys, cheapest first', () => {
    const data = catalogWith({
      'netflix.premium': { retired: '2026-10-01', endsOn: '2027-03-01' },
    });
    const result = run(data, [item('netflix.premium')], { 'video.quality=4k': 'needed' });
    expect(result.replacements).toEqual([
      expect.objectContaining({
        title: 'Netflix Premium',
        endsOn: '2027-03-01',
        keys: ['video.quality=4k'],
      }),
    ]);
    expect(result.replacements[0].plans.map(({ planId }) => planId)).toEqual([
      'disney-plus.premium',
      'crave.premium',
    ]);
  });

  it('keeps a Critical key with the same provider', () => {
    const data = catalogWith({
      'netflix.premium': { retired: '2026-10-01', endsOn: '2027-03-01' },
    });
    const result = run(data, [
      item('netflix.premium', {}, { rankOverrides: { 'streaming.ad-free': 'critical' } }),
    ]);
    expect(result.replacements[0].plans.map(({ planId }) => planId)).toEqual(['netflix.standard']);
  });

  it('lists nothing for a plan that doesn’t end in the next 12 months', () => {
    const data = catalogWith({
      'netflix.premium': { retired: '2026-10-01', endsOn: '2028-03-01' },
    });
    expect(run(data, [item('netflix.premium')]).replacements).toEqual([]);
    expect(run(catalog, [item('netflix.premium')]).replacements).toEqual([]);
  });
});

describe('Home’s notice of a plan that ends', () => {
  it('is recorded once, when the update brings endsOn', () => {
    const after = catalogWith({
      'netflix.premium': { retired: '2026-10-01', endsOn: '2027-03-01' },
    });
    expect(planNoticesBetween([item('netflix.premium')], catalog, after, today)).toEqual([
      {
        kind: 'ends',
        planId: 'netflix.premium',
        title: 'Netflix Premium',
        on: '2027-03-01',
        date: today,
      },
    ]);
    expect(planNoticesBetween([item('netflix.premium')], after, after, today)).toEqual([]);
  });
});

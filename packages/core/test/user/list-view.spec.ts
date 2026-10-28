import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  listFilterCount,
  listFilterOptions,
  listPriceRange,
  listView,
  readCatalogSource,
  resolveItem,
  type Interval,
  type ListItem,
  type ListView,
  type ListViewContext,
  type ResolveContext,
  type ResolvedItem,
  type Tag,
  type UnresolvedItem,
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

const family: Tag = {
  id: '0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2d',
  name: 'Family',
  color: '#1e88e5',
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};
const work: Tag = { ...family, id: '0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2e', name: 'Work' };
const unused: Tag = { ...family, id: '0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2f', name: 'Unused' };

const context: ListViewContext = {
  tags: new Map([family, work, unused].map((tag) => [tag.id, tag])),
  registry: canadian.catalog?.features ?? [],
  currency: 'CAD',
  today: '2026-10-26',
};

let nextId = 0;

function resolved(
  planId: string,
  extra: Partial<ListItem> = {},
  resolveContext: ResolveContext = canadian,
): ResolvedItem {
  const result = resolveItem(
    {
      id: `0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c${String(nextId++).padStart(2, '0')}`,
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
    resolveContext,
  );
  if (!result.ok) throw new Error(result.unresolved.reason);
  return result.resolved;
}

// Netflix Standard (CA$18.99), pinned and tagged Family; Mullvad (€5, converted) tagged Work; Crave Premium (CA$22)
// starting next month; Crave Standard With Ads billed yearly (CA$119.99), tagged both.
const netflix = resolved('netflix.standard', { pinned: true, tagIds: [family.id] });
const mullvad = resolved('mullvad.vpn', { tagIds: [work.id] });
const cravePremium = resolved('crave.premium', {
  billing: {
    mode: 'recurring',
    interval: 'month',
    intervalCount: 1,
    anchorDate: '2026-11-20',
    startDate: '2026-11-20',
    autoRenew: true,
  },
});
const craveYearly = resolved('crave.standard', {
  billing: {
    mode: 'recurring',
    interval: 'year',
    intervalCount: 1,
    anchorDate: '2027-03-01',
    autoRenew: true,
  },
  tagIds: [family.id, work.id],
});
const gone: UnresolvedItem = { item: netflix.item, listId, reason: 'plan-gone' };
const items = { resolved: [mullvad, cravePremium, netflix, craveYearly], unresolved: [gone] };

const plans = (shown: readonly ResolvedItem[]) => shown.map((resolved) => resolved.planId);
const both = (view: ListView) => [...plans(view.pinned), ...plans(view.others)];

describe('listView', () => {
  it('puts the pinned items first, then the rest by what they cost a month, highest first', () => {
    const view = listView(items, {}, context);
    expect(plans(view.pinned)).toEqual(['netflix.standard']);
    expect(plans(view.others)).toEqual(['crave.premium', 'crave.standard', 'mullvad.vpn']);
    expect(view.unresolved).toEqual([gone]);
    expect(view).toMatchObject({ total: 5, shown: 5 });
  });

  it.each([
    ['its name', 'netf', ['netflix.standard']],
    ['its plan', 'standard', ['netflix.standard', 'crave.standard']],
    ['a tag', 'work', ['crave.standard', 'mullvad.vpn']],
    ['a feature', 'unlimited', ['mullvad.vpn']],
    ['a feature value', '4k', ['crave.premium']],
    ['a set value', 'sports', ['crave.premium', 'crave.standard']],
  ])('finds an item by %s, and lists nothing it can’t match', (_, q, expected) => {
    const view = listView(items, { q, sort: 'name' }, context);
    expect(both(view)).toEqual(expected);
    expect(view.unresolved).toEqual([]);
    expect(view).toMatchObject({ total: 5, shown: expected.length });
  });

  it('keeps every item for text with no words in it', () => {
    expect(listView(items, { q: ' - ' }, context).shown).toBe(5);
  });

  it('filters by Active only and Inactive only, today', () => {
    const active = listView(items, { activity: 'active', sort: 'name' }, context);
    expect(both(active)).toEqual(['netflix.standard', 'crave.standard', 'mullvad.vpn']);
    const inactive = listView(items, { activity: 'inactive' }, context);
    expect(both(inactive)).toEqual(['crave.premium']);
    expect(inactive.unresolved).toEqual([]);
  });

  it('filters by the monthly equivalent in the user’s currency, both ends included', () => {
    const view = listView(
      items,
      { minPrice: mullvad.monthlyEquivalent, maxPrice: netflix.monthlyEquivalent, sort: 'name' },
      context,
    );
    expect(both(view)).toEqual(['netflix.standard', 'crave.standard', 'mullvad.vpn']);
    expect(both(listView(items, { minPrice: 20 }, context))).toEqual(['crave.premium']);
    expect(listView(items, { maxPrice: 0 }, context).shown).toBe(0);
  });

  it('leaves out of a price filter, and sorts last by price, an item it has no rate for', () => {
    const euros = resolved('mullvad.vpn', {}, { ...canadian, fx: undefined });
    expect(euros.price.currency).toBe('EUR');
    const withEuros = { resolved: [euros, craveYearly], unresolved: [] };
    expect(plans(listView(withEuros, { minPrice: 0 }, context).others)).toEqual(['crave.standard']);
    expect(plans(listView(withEuros, {}, context).others)).toEqual([
      'crave.standard',
      'mullvad.vpn',
    ]);
  });

  it('keeps items that provide every feature chosen, a higher value providing a lower one', () => {
    const fullHd = listView(items, { features: ['video.quality=1080p'], sort: 'name' }, context);
    expect(both(fullHd)).toEqual(['netflix.standard', 'crave.premium']);
    const adFree = ['video.quality=1080p', 'streaming.ad-free'];
    expect(both(listView(items, { features: adFree }, context))).toEqual(['netflix.standard']);
    const none = listView(items, { features: ['vpn.included', 'video.quality=4k'] }, context);
    expect(none.shown).toBe(0);
  });

  it('keeps items with any tag chosen', () => {
    const view = listView(items, { tags: [family.id, work.id], sort: 'name' }, context);
    expect(both(view)).toEqual(['netflix.standard', 'crave.standard', 'mullvad.vpn']);
    expect(listView(items, { tags: [unused.id] }, context).shown).toBe(0);
  });

  it('sorts A–Z by name then plan, active first, or by billing period, ties A–Z', () => {
    const all = { resolved: [mullvad, craveYearly, cravePremium], unresolved: [] };
    expect(plans(listView(all, { sort: 'name' }, context).others)).toEqual([
      'crave.premium',
      'crave.standard',
      'mullvad.vpn',
    ]);
    expect(plans(listView(all, { sort: 'active' }, context).others)).toEqual([
      'crave.standard',
      'mullvad.vpn',
      'crave.premium',
    ]);
    expect(plans(listView(all, { sort: 'interval' }, context).others)).toEqual([
      'crave.premium',
      'mullvad.vpn',
      'crave.standard',
    ]);
  });

  it('sorts 2 weeks before a month, and 3 months before a year', () => {
    const billed = (resolved: ResolvedItem, interval: Interval, intervalCount: number) => ({
      ...resolved,
      item: { ...resolved.item, billing: { ...resolved.item.billing, interval, intervalCount } },
    });
    const all = {
      resolved: [
        craveYearly,
        billed(cravePremium, 'month', 3),
        mullvad,
        billed(netflix, 'week', 2),
      ],
      unresolved: [],
    };
    expect(both(listView(all, { sort: 'interval' }, context))).toEqual([
      'netflix.standard',
      'mullvad.vpn',
      'crave.premium',
      'crave.standard',
    ]);
  });
});

describe('listFilterCount', () => {
  it('counts the filters set, not the text or the sort, and a price range once', () => {
    expect(listFilterCount({})).toBe(0);
    expect(listFilterCount({ q: 'netflix', sort: 'name', features: [], tags: [] })).toBe(0);
    expect(
      listFilterCount({
        activity: 'active',
        minPrice: 5,
        maxPrice: 20,
        features: ['vpn.included'],
        tags: [family.id],
      }),
    ).toBe(4);
    expect(listFilterCount({ maxPrice: 0 })).toBe(1);
  });
});

describe('listFilterOptions', () => {
  it('offers the keys the items provide and the tags they have, each by name', () => {
    const options = listFilterOptions([netflix, mullvad], context);
    const labels = options.features.map((option) => option.label);
    expect(labels).toContain('VPN');
    expect(labels).toContain('Video quality: 1080p (Full HD)');
    expect(labels).not.toContain('Video quality: 4K (Ultra HD)');
    const sorted = [...labels].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
    expect(labels).toEqual(sorted);
    expect(options.tags.map((tag) => tag.name)).toEqual(['Family', 'Work']);
  });

  it('offers nothing for no items', () => {
    expect(listFilterOptions([], context)).toEqual({ features: [], tags: [] });
  });
});

describe('listPriceRange', () => {
  it('reads amounts, and empty fields as no limit', () => {
    expect(listPriceRange({ min: '', max: '  ' })).toEqual({ issues: [] });
    expect(listPriceRange({ min: '5', max: '19.99' })).toEqual({
      minPrice: 5,
      maxPrice: 19.99,
      issues: [],
    });
    expect(listPriceRange({ min: '0', max: '0' })).toEqual({
      minPrice: 0,
      maxPrice: 0,
      issues: [],
    });
  });

  it('sets no limit for a field that isn’t an amount, and says so there', () => {
    expect(listPriceRange({ min: '$5', max: '20' })).toEqual({
      maxPrice: 20,
      issues: [{ path: ['min'], message: 'Enter an amount, like 9.99' }],
    });
  });

  it('keeps the lowest and drops a highest below it', () => {
    expect(listPriceRange({ min: '20', max: '5' })).toEqual({
      minPrice: 20,
      issues: [{ path: ['max'], message: 'Must be at least the lowest price' }],
    });
  });
});

describe('listView: nicknames and notes', () => {
  const moms = {
    ...netflix,
    item: { ...netflix.item, pinned: false, nickname: "Mom's", note: 'Paid by Dad' },
  };
  const mine = { ...netflix, item: { ...netflix.item, pinned: false, nickname: 'Mine' } };
  const both = { resolved: [mine, moms, mullvad], unresolved: [] };

  it('finds an item by its nickname or its note', () => {
    expect(listView(both, { q: 'mom' }, context).others).toEqual([moms]);
    expect(listView(both, { q: 'dad' }, context).others).toEqual([moms]);
  });

  it('sorts two of the same plan by their nicknames', () => {
    expect(
      listView(both, { sort: 'name' }, context).others.map(({ item }) => item.nickname),
    ).toEqual([undefined, 'Mine', "Mom's"]);
  });
});

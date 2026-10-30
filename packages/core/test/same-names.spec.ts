import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  buildCatalogMeta,
  calendarEvents,
  customSubChange,
  customSubUsage,
  isDuplicate,
  itemTable,
  listFile,
  listView,
  mergedRecords,
  mergeSync,
  optimize,
  providerActivity,
  rankSiblings,
  readCatalogSource,
  regionSnapshot,
  resolveItem,
  searchCatalog,
  sharedSettings,
  syncSchemaVersion,
  syncTables,
  tagNameIssue,
  typeCounts,
  type CustomSubscription,
  type ExportContext,
  type ListItem,
  type ProfileRank,
  type ResolveContext,
  type ResolvedItem,
  type Settings,
  type SubscriptionList,
  type SyncData,
  type Tag,
} from '../src';
import { catalog } from './catalog/catalog-files';
import { format } from './export/fixtures';
import { catalog as streaming } from './optimizer/fixtures';
import { settings } from './user/fixtures';

// Things named alike stay apart (the feedback after M10, part 2): the user's custom subscriptions are told apart from
// each other and from the catalog by id, never by name. One list has the catalog's Netflix Standard, a custom
// subscription called Netflix with a plan called Standard, and two custom subscriptions called Gym, each with a plan
// called Basic. For an Albertan (5% GST) on Oct 28, 2026, with the test catalog (catalog-files.ts).

const today = '2026-10-28';
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };
const id = (n: number) => `0192f1c6-2d3e-7f40-9b5c-${String(n).padStart(12, '0')}`;

const data = buildCatalogData(readCatalogSource(catalog()), 'https://sub.simplely.ca/icons/');
const canada = regionSnapshot(
  { data, meta: buildCatalogMeta(data, { catalogVersion: '1234567', generatedAt: today }) },
  'CA',
).data;

const family: SubscriptionList = { id: id(1), name: 'Family', ...stamps };
const otherList: SubscriptionList = { id: id(2), name: 'Family', ...stamps };

function customSub(
  subId: string,
  name: string,
  plan: {
    id: string;
    name: string;
    amount: number;
    features?: Record<string, boolean | number | string>;
  },
  link?: string,
): CustomSubscription {
  return {
    id: subId,
    name,
    ...(link !== undefined && { link }),
    plans: [
      {
        id: plan.id,
        name: plan.name,
        features: plan.features ?? {},
        price: {
          amount: plan.amount,
          currency: 'CAD',
          interval: 'month',
          intervalCount: 1,
          plusTax: true,
        },
        autoRenewAvailable: true,
      },
    ],
    ...stamps,
  };
}

/** Netflix Standard's features, at a price of its own and with no website: the user's own copy of it. */
const lookalike = customSub(id(10), 'Netflix', {
  id: id(11),
  name: 'Standard',
  amount: 16.49,
  features: {
    'video.quality': '1080p',
    'streaming.ad-free': true,
    'streaming.concurrent-streams': 2,
  },
});
const gymA = customSub(
  id(20),
  'Gym',
  { id: id(21), name: 'Basic', amount: 30 },
  'https://gym-a.example.com',
);
const gymB = customSub(
  id(30),
  'Gym',
  { id: id(31), name: 'Basic', amount: 45 },
  'https://gym-b.example.com',
);
const customSubs = new Map([lookalike, gymA, gymB].map((sub) => [sub.id, sub]));

let next = 100;

const monthly = {
  mode: 'recurring',
  interval: 'month',
  intervalCount: 1,
  anchorDate: '2026-11-12',
  autoRenew: true,
} as const;

function item(source: ListItem['source'], extra: Partial<ListItem> = {}): ListItem {
  return {
    id: id(++next),
    listId: family.id,
    source,
    billing: monthly,
    tagIds: [],
    rankOverrides: {},
    pinned: false,
    ...stamps,
    ...extra,
  };
}

const custom = (sub: CustomSubscription): ListItem['source'] => ({
  kind: 'custom',
  customSubId: sub.id,
  customPlanId: sub.plans[0].id,
});

const netflix = item({ kind: 'catalog', planId: 'netflix.standard' });
const ownNetflix = item(custom(lookalike));
const gymAItem = item(custom(gymA));
const gymBItem = item(custom(gymB));
const items = [netflix, ownNetflix, gymAItem, gymBItem];

const resolveContext: ResolveContext = {
  catalog: canada,
  customSubs,
  country: 'CA',
  currency: 'CAD',
  today,
  profileRanks: new Map(),
  taxPlace: { country: 'CA', subdivision: 'CA-AB' },
};

function resolveAll(list: readonly ListItem[], context = resolveContext): ResolvedItem[] {
  return list.map((one) => {
    const resolution = resolveItem(one, context);
    if (!resolution.ok) throw new Error(`${one.id}: ${resolution.unresolved.reason}`);
    return resolution.resolved;
  });
}

const resolved = resolveAll(items);

describe('things named alike stay apart, by id', () => {
  it('resolves each item to its own plan, price and icon: a custom Netflix isn’t the catalog’s, and two Gyms are two', () => {
    expect(
      resolved.map((one) => [
        one.name,
        one.planName,
        one.providerId ?? one.customSubId,
        one.price.amount,
        one.iconUrl,
      ]),
    ).toEqual([
      ['Netflix', 'Standard', 'netflix', 18.99, 'icons/netflix.webp'],
      // No website, so no icon: its card shows its letter, never the catalog's Netflix logo.
      ['Netflix', 'Standard', lookalike.id, 16.49, undefined],
      ['Gym', 'Basic', gymA.id, 30, 'api/v1/icon?domain=gym-a.example.com'],
      ['Gym', 'Basic', gymB.id, 45, 'api/v1/icon?domain=gym-b.example.com'],
    ]);
  });

  describe('the list editor', () => {
    it('asks before adding a plan the list has only when it’s the same plan by id', () => {
      expect(isDuplicate(netflix.source, [ownNetflix])).toBe(false);
      expect(isDuplicate(ownNetflix.source, [netflix])).toBe(false);
      expect(isDuplicate(custom(gymB), [gymAItem])).toBe(false);
      expect(isDuplicate(custom(gymA), [gymAItem])).toBe(true);
      expect(isDuplicate(netflix.source, [netflix, ownNetflix])).toBe(true);
    });

    it('takes a custom plan as its own subscription’s: the same plan id in another one isn’t the same plan', () => {
      // A plan id is unique when the app makes it, but a backup file can be edited by hand.
      const sameId = { ...custom(gymB), customPlanId: gymA.plans[0].id };
      expect(isDuplicate(sameId, [gymAItem])).toBe(false);

      const removed = customSubChange(gymA, { plans: [] }, [
        gymAItem,
        item(sameId, { listId: otherList.id }),
      ]);
      expect(removed).toEqual({ changed: 0, removed: 1, removedLists: 1 });
    });

    it('counts a custom subscription’s own items, not its namesake’s, before it’s changed or deleted', () => {
      const usage = customSubUsage(gymA.id, [
        ...items,
        item(custom(gymB), { listId: otherList.id }),
      ]);
      expect(usage).toEqual({ items: 1, lists: 1, plans: new Map([[gymA.plans[0].id, 1]]) });
    });

    it('shares ranks only among one subscription’s plans', () => {
      const siblings = resolved.map((one) => ({ item: one.item, providedKeys: one.providedKeys }));
      expect(rankSiblings(netflix, siblings)).toEqual([]);
      expect(rankSiblings(gymAItem, siblings)).toEqual([]);

      const samsGym = item(custom(gymA), { nickname: "Sam's" });
      const withSams = [...siblings, { item: samsGym, providedKeys: [] }];
      expect(rankSiblings(gymAItem, withSams).map((one) => one.item.id)).toEqual([samsGym.id]);
    });
  });

  describe('lists', () => {
    it('counts the custom Netflix as Custom, not Streaming video', () => {
      expect(typeCounts(resolved, canada.categories.service)).toEqual([
        { id: 'custom', name: 'Custom', icon: 'edit_note', count: 3 },
        { id: 'streaming', name: 'Streaming video', icon: 'live_tv', count: 1 },
      ]);
    });

    it('filters by a tag’s id: a tag called Netflix shows its own items, and the text finds every Netflix', () => {
      const netflixTag: Tag = { id: id(40), name: 'Netflix', color: '#e53935', ...stamps };
      // A tag can share a name with a service; only two tags can't share one.
      expect(tagNameIssue('Netflix', [])).toBeUndefined();
      expect(tagNameIssue('netflix ', [netflixTag])).toBe("There's a tag called “Netflix” already");

      const tagged = resolveAll([
        ...items.slice(0, 2),
        { ...gymAItem, tagIds: [netflixTag.id] },
        gymBItem,
      ]);
      const context = {
        tags: new Map([[netflixTag.id, netflixTag]]),
        registry: canada.features,
        currency: 'CAD',
        today,
      };
      const shown = (query: Parameters<typeof listView>[1]) =>
        listView({ resolved: tagged, unresolved: [] }, query, context).others.map(
          ({ item: one }) => one.id,
        );

      expect(shown({ tags: [netflixTag.id] })).toEqual([gymAItem.id]);
      expect(shown({ q: 'netflix' }).sort()).toEqual(
        [netflix.id, ownNetflix.id, gymAItem.id].sort(),
      );
    });
  });

  describe('Search', () => {
    it('lists the catalog’s Netflix only from its own items, never from a custom subscription called Netflix', () => {
      expect(providerActivity([ownNetflix, gymAItem, gymBItem], canada.bundles, today)).toEqual(
        new Map(),
      );
      const activity = providerActivity(items, canada.bundles, today);
      expect([...activity.keys()]).toEqual(['netflix']);
      expect(activity.get('netflix')).toMatchObject({
        kind: 'active',
        lists: 1,
        plans: [{ planId: 'netflix.standard', kind: 'active' }],
      });

      const results = searchCatalog(
        { q: 'netflix' },
        {
          catalog: canada,
          settings: { country: 'CA', subdivision: 'CA-AB', currency: 'CAD' },
          items: [ownNetflix],
          today,
        },
      );
      expect(results.map((result) => [result.provider.id, result.activity])).toEqual([
        ['netflix', undefined],
      ]);
    });
  });

  describe('the optimizer', () => {
    // On the optimizer's own catalog (optimizer/fixtures.ts), whose Netflix Standard takes an extra member that gets
    // Standard, with Ad free ranked as each test says.
    function kinds(list: readonly ListItem[], adFree: ProfileRank): string[] {
      const profileRanks = new Map([['streaming.ad-free', adFree]]);
      const result = optimize({
        items: resolveAll(list, { ...resolveContext, catalog: streaming, profileRanks }),
        catalogs: new Map([['CA', streaming]]),
        context: {
          today,
          country: 'CA',
          currency: 'CAD',
          place: resolveContext.taxPlace!,
          profileRanks,
        },
      });
      return result.suggestions.flatMap((suggestion) =>
        suggestion.actions.map((action) => action.kind),
      );
    }
    const onThe20th: ListItem['billing'] = { ...monthly, anchorDate: '2026-11-20' };

    it('never makes a custom Netflix an extra member on the catalog’s, as it does a second account of it', () => {
      const samsNetflix = item(
        { kind: 'catalog', planId: 'netflix.standard' },
        { billing: onThe20th },
      );
      expect(kinds([netflix, samsNetflix], 'wanted')).toContain('extra-member');
      expect(kinds([netflix, { ...ownNetflix, billing: onThe20th }], 'wanted')).not.toContain(
        'extra-member',
      );
    });

    it('takes a custom Netflix and the catalog’s as two services, but one custom subscription twice as two accounts', () => {
      // Either service gives Ad free, so one can go, as one of two VPNs can; two accounts of one never go for each other.
      expect(kinds([netflix, ownNetflix], 'needed')).toContain('remove');
      expect(kinds([ownNetflix, item(custom(lookalike), { nickname: "Sam's" })], 'needed')).toEqual(
        [],
      );
    });
  });

  describe('exports', () => {
    const exportContext: ExportContext = {
      today,
      currency: 'CAD',
      place: { country: 'CA', subdivision: 'CA-AB' },
      tags: new Map(),
    };
    const lists = [{ list: family, resolved, unresolved: [] }];

    it('has a row for each item, with its own price', () => {
      expect(itemTable(lists, exportContext).rows.map((row) => row.slice(0, 5))).toEqual([
        ['Family', 'Netflix', 'Standard', null, 19.94],
        ['Family', 'Netflix', 'Standard', null, 17.31],
        ['Family', 'Gym', 'Basic', null, 31.5],
        ['Family', 'Gym', 'Basic', null, 47.25],
      ]);
    });

    it('gives each item’s calendar events UIDs of their own, from its id', () => {
      const events = calendarEvents(lists, exportContext, format);
      expect(events.map((event) => event.title)).toEqual([
        'Netflix: $19.94',
        'Netflix: $17.31',
        'Gym: $31.50',
        'Gym: $47.25',
      ]);
      expect(events.map((event) => event.uid.slice(0, 36))).toEqual(items.map((one) => one.id));
      expect(new Set(events.map((event) => event.uid)).size).toBe(events.length);
    });

    it('puts each custom subscription its items are in a list file once, by id, and never the catalog’s', () => {
      const file = listFile(
        family,
        [...items, item(custom(gymA))],
        { tags: new Map(), customSubs },
        today,
      );
      expect(file.customSubs).toEqual([lookalike, gymA, gymB]);
    });
  });

  describe('backups and sync', () => {
    it('keeps both of two devices’ Gyms when a backup merges, by id', () => {
      expect(mergedRecords('customSubs', [gymA], [gymB])).toEqual([gymB]);
      expect(mergedRecords('customSubs', [gymA], [{ ...gymA, name: 'Gym' }])).toEqual([]);
    });

    it('keeps both of two devices’ Gyms when they sync, by id', () => {
      const empty = Object.fromEntries(
        syncTables.map((table) => [table, []]),
      ) as unknown as SyncData;
      const shared = sharedSettings(settings as Settings);
      const device = { id: '0192f1d0-0000-7000-8000-00000000000a', name: 'Edge on Windows' };
      const merge = mergeSync(
        { settings: shared, data: { ...empty, customSubs: [gymA], items: [gymAItem] } },
        {
          schemaVersion: syncSchemaVersion,
          settings: shared,
          data: { ...empty, customSubs: [gymB], items: [gymBItem] },
          devices: [],
        },
        device,
        '2026-10-29T18:00:00.000Z',
      );
      expect(merge.writes).toEqual({ customSubs: [gymB], items: [gymBItem] });
      expect(merge.copy.data.customSubs).toEqual([gymB, gymA]);
      expect(merge.copy.data.items).toEqual([gymBItem, gymAItem]);
    });
  });
});

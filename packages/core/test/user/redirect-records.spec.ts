import { describe, expect, it } from 'vitest';
import {
  dueRedirectMap,
  movedNotices,
  redirectedRecords,
  resolveItem,
  type CatalogData,
  type ListDraft,
  type ListItem,
  type ProfileRanking,
  type Redirect,
} from '../../src';
import { catalog, fx, item, today } from '../optimizer/fixtures';

// Ids that changed (BLUEPRINT §4.3, M10.27): resolution follows data/redirects.yaml before calling an item gone, and
// the app rewrites the user's records to the new ids once.

const now = '2026-10-28T12:00:00.000Z';

/** The fixture catalog with Netflix Standard's id changed to netflix.standard-hd, and these redirects. */
function moved(redirects: Redirect[], change = true): CatalogData {
  return {
    ...catalog,
    providers: catalog.providers.map((provider) => ({
      ...provider,
      plans: provider.plans.map((plan) =>
        change && plan.id === 'netflix.standard' ? { ...plan, id: 'netflix.standard-hd' } : plan,
      ),
    })),
    redirects,
  };
}

const renamed: Redirect = {
  kind: 'plan',
  from: 'netflix.standard',
  to: 'netflix.standard-hd',
  on: '2026-10-20',
};
const adFree: Redirect = {
  kind: 'feature',
  from: 'streaming.no-ads',
  to: 'streaming.ad-free',
  on: '2026-10-20',
};

const context = {
  customSubs: new Map(),
  country: 'CA',
  currency: 'CAD',
  fx,
  today,
  profileRanks: new Map(),
};

describe('resolveItem through redirects', () => {
  it('follows a plan, an add-on and a bundle id that changed', () => {
    const data: CatalogData = {
      ...moved([
        renamed,
        { kind: 'add-on', from: 'netflix.member', to: 'netflix.extra-member', on: '2026-10-20' },
        {
          kind: 'bundle',
          from: 'bundle.disney-crave',
          to: 'bundle.disney-crave-premium',
          on: '2026-10-20',
        },
      ]),
    };
    const standard = item(
      'netflix.standard',
      {},
      {
        source: {
          kind: 'catalog',
          planId: 'netflix.standard',
          addOns: [{ id: 'netflix.member', quantity: 1 }],
        },
      },
    );
    const result = resolveItem(standard, { ...context, catalog: data });
    expect(result.ok && [result.resolved.planId, result.resolved.addOns[0].id]).toEqual([
      'netflix.standard-hd',
      'netflix.extra-member',
    ]);
    const bundle = resolveItem(item('bundle.disney-crave'), { ...context, catalog: data });
    expect(bundle.ok && bundle.resolved.bundleId).toBe('bundle.disney-crave-premium');
  });

  it('calls a plan gone only when neither the catalog nor a redirect has it', () => {
    const result = resolveItem(item('netflix.standard'), { ...context, catalog: moved([]) });
    expect(!result.ok && result.unresolved.reason).toBe('plan-gone');
  });

  it('keeps a retired plan until its subscribers’ move, then follows it', () => {
    const move: Redirect = {
      kind: 'plan',
      from: 'netflix.standard',
      to: 'netflix.premium',
      on: '2026-12-01',
    };
    const data: CatalogData = {
      ...moved([move], false),
      providers: catalog.providers.map((provider) => ({
        ...provider,
        plans: provider.plans.map((plan) =>
          plan.id === 'netflix.standard' ? { ...plan, retired: '2026-10-01' } : plan,
        ),
      })),
    };
    const before = resolveItem(item('netflix.standard'), { ...context, catalog: data });
    expect(before.ok && [before.resolved.planId, before.resolved.retired]).toEqual([
      'netflix.standard',
      {
        since: '2026-10-01',
        movesTo: { planId: 'netflix.premium', title: 'Netflix Premium', on: '2026-12-01' },
      },
    ]);
    const after = resolveItem(item('netflix.standard'), {
      ...context,
      catalog: data,
      today: '2026-12-01',
    });
    expect(after.ok && after.resolved.planId).toBe('netflix.premium');
  });

  it('applies a rank given under a feature key that changed', () => {
    const result = resolveItem(
      item('netflix.standard', {}, { rankOverrides: { 'streaming.no-ads': 'needed' } }),
      { ...context, catalog: moved([adFree], false) },
    );
    expect(result.ok && result.resolved.effectiveRanks['streaming.ad-free']).toBe('needed');
  });
});

describe('redirectedRecords', () => {
  const ranking = (rankKey: string, rank: ProfileRanking['rank'], extra = {}): ProfileRanking => ({
    rankKey,
    rank,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    ...extra,
  });

  it('moves items, ranks and drafts to the new ids, and nothing else', () => {
    const moves = dueRedirectMap(moved([renamed, adFree]), today);
    const standard = item(
      'netflix.standard',
      {},
      { rankOverrides: { 'streaming.no-ads': 'needed' } },
    );
    const crave = item('crave.premium');
    const draft: ListDraft = {
      listId: standard.listId,
      isNew: false,
      name: 'Mine',
      startName: 'Mine',
      items: [
        { item: { ...standard, pinned: true }, saved: standard },
        { item: crave, saved: crave },
      ],
      startedAt: '2026-10-27T12:00:00.000Z',
    };
    const result = redirectedRecords(
      moves,
      {
        items: [standard, crave],
        rankings: [ranking('streaming.no-ads', 'wanted'), ranking('video.hdr', 'unused')],
        drafts: [draft],
      },
      now,
    );
    expect(result.items).toEqual([
      {
        ...standard,
        source: { kind: 'catalog', planId: 'netflix.standard-hd' },
        rankOverrides: { 'streaming.ad-free': 'needed' },
        updatedAt: now,
      },
    ]);
    expect(result.rankings).toEqual([
      ranking('streaming.no-ads', 'wanted', { updatedAt: now, deletedAt: now }),
      ranking('streaming.ad-free', 'wanted', { updatedAt: now }),
    ]);
    const [entry, untouched] = result.drafts[0].items;
    expect([entry.item.source, entry.saved?.source, entry.item.pinned]).toEqual([
      { kind: 'catalog', planId: 'netflix.standard-hd' },
      { kind: 'catalog', planId: 'netflix.standard-hd' },
      true,
    ]);
    expect(untouched.item).toBe(crave);
    expect(result.moved).toEqual([{ from: 'netflix.standard', to: 'netflix.standard-hd' }]);

    // Once moved, there's nothing left to move.
    const again = redirectedRecords(
      moves,
      { items: result.items, rankings: result.rankings, drafts: result.drafts },
      now,
    );
    expect(again).toEqual({ items: [], rankings: [], drafts: [], moved: [] });
  });

  it('keeps a rank the user gave the new key already', () => {
    const moves = dueRedirectMap(moved([adFree], false), today);
    const result = redirectedRecords(
      moves,
      {
        items: [],
        rankings: [ranking('streaming.no-ads', 'wanted'), ranking('streaming.ad-free', 'needed')],
        drafts: [],
      },
      now,
    );
    expect(result.rankings).toEqual([
      ranking('streaming.no-ads', 'wanted', { updatedAt: now, deletedAt: now }),
    ]);
  });

  it('writes nothing without redirects', () => {
    const result = redirectedRecords(
      dueRedirectMap(catalog, today),
      { items: [item('netflix.standard')], rankings: [], drafts: [] },
      now,
    );
    expect(result).toEqual({ items: [], rankings: [], drafts: [], moved: [] });
  });
});

describe('movedNotices', () => {
  it('tells the users of a retired plan where its subscribers moved, once per plan', () => {
    const move: Redirect = {
      kind: 'plan',
      from: 'netflix.standard',
      to: 'netflix.premium',
      on: '2026-10-20',
    };
    const data = moved([move], false);
    const pair = { from: 'netflix.standard', to: 'netflix.premium' };
    expect(movedNotices([pair, pair], data, today)).toEqual([
      {
        kind: 'moved',
        planId: 'netflix.premium',
        title: 'Netflix Standard',
        to: 'Netflix Premium',
        on: '2026-10-20',
        date: today,
      },
    ]);
    // An id that changed is the same plan: nothing to tell.
    expect(
      movedNotices(
        [{ from: 'netflix.standard', to: 'netflix.standard-hd' }],
        moved([renamed]),
        today,
      ),
    ).toEqual([]);
  });
});

import { planOf } from '../catalog/plan-lookup';
import {
  redirected,
  redirectedRankKey,
  type RedirectCatalog,
  type RedirectMap,
} from '../catalog/redirects';
import type { CatalogData } from '../catalog/snapshot';
import type { IsoDate } from '../dates/iso-date';
import { planTitle } from './item-text';
import type { ListDraft } from './list-draft';
import type { ListItem } from './list-item';
import type { PlanNotice } from './plan-notices';
import type { ProfileRanking } from './profile-ranking';
import type { Timestamp } from './record';
import { softDeleted, withChanges } from './stamps';

// The user's records moved to the ids the catalog's redirects point to (BLUEPRINT §4.3, M10.27): items' plans, add-ons,
// bundles and rank overrides, the profile's ranks, and drafts. The app writes the result in one transaction, once the
// catalog with the redirects is in and a move's date has come; after it no record points at an old id, so it happens
// once. Resolution follows the same redirects meanwhile (resolveItem).

/** What changes: only the records that point at an old id. */
export interface RedirectedRecords {
  /** Items with new ids, each changed at `now`. */
  items: ListItem[];
  /** Rankings under their new keys, and the old ones soft-deleted, so a sync passes both on. */
  rankings: ProfileRanking[];
  /** Drafts whose items point at an old id: both the edited items and their saved copies, so Save sees no change. */
  drafts: ListDraft[];
  /** The plans saved items moved off and onto (not deleted ones), for Home's notice. */
  moved: { from: string; to: string }[];
}

/** The item with its ids and rank keys moved, or undefined when nothing in it points at an old id. */
export function redirectedItem(item: ListItem, moves: RedirectMap): ListItem | undefined {
  const { source } = item;
  let moved: ListItem['source'] = source;
  if (source.kind === 'catalog') {
    const addOns = source.addOns?.map((addOn) => ({
      ...addOn,
      id: redirected(moves, 'add-on', addOn.id),
    }));
    moved = {
      ...source,
      planId: redirected(moves, 'plan', source.planId),
      ...(addOns && { addOns }),
    };
  } else if (source.kind === 'bundle') {
    moved = { ...source, bundleId: redirected(moves, 'bundle', source.bundleId) };
  }
  const rankOverrides = redirectedOverrides(item.rankOverrides, moves);
  const sameSource = JSON.stringify(moved) === JSON.stringify(source);
  const sameRanks = JSON.stringify(rankOverrides) === JSON.stringify(item.rankOverrides);
  return sameSource && sameRanks ? undefined : { ...item, source: moved, rankOverrides };
}

/** Rank overrides under their keys now: a renamed feature's rank keeps applying. The new key's own override wins. */
export function redirectedOverrides(
  overrides: ListItem['rankOverrides'],
  moves: RedirectMap,
): ListItem['rankOverrides'] {
  if (moves.size === 0) return overrides;
  const moved: ListItem['rankOverrides'] = {};
  for (const [key, rank] of Object.entries(overrides)) {
    const now = redirectedRankKey(moves, key);
    if (now === key || overrides[now] === undefined) moved[now] = rank;
  }
  return moved;
}

/** Every record of `records` that points at an old id, moved to the new one at `now`. */
export function redirectedRecords(
  moves: RedirectMap,
  records: {
    items: readonly ListItem[];
    rankings: readonly ProfileRanking[];
    drafts: readonly ListDraft[];
  },
  now: Timestamp,
): RedirectedRecords {
  const result: RedirectedRecords = { items: [], rankings: [], drafts: [], moved: [] };
  if (moves.size === 0) return result;
  for (const item of records.items) {
    const moved = redirectedItem(item, moves);
    if (!moved) continue;
    result.items.push(
      withChanges(item, { source: moved.source, rankOverrides: moved.rankOverrides }, now),
    );
    if (
      item.deletedAt === undefined &&
      item.source.kind === 'catalog' &&
      moved.source.kind === 'catalog' &&
      item.source.planId !== moved.source.planId
    ) {
      result.moved.push({ from: item.source.planId, to: moved.source.planId });
    }
  }
  const live = new Map(
    records.rankings
      .filter((ranking) => ranking.deletedAt === undefined)
      .map((ranking) => [ranking.rankKey, ranking]),
  );
  for (const ranking of live.values()) {
    const key = redirectedRankKey(moves, ranking.rankKey);
    if (key === ranking.rankKey) continue;
    result.rankings.push(softDeleted(ranking, now));
    // A rank the user gave the new key already stays.
    if (live.has(key)) continue;
    const earlier = records.rankings.find((stored) => stored.rankKey === key);
    result.rankings.push(
      earlier
        ? withChanges(earlier, { rank: ranking.rank, deletedAt: undefined }, now)
        : { rankKey: key, rank: ranking.rank, createdAt: ranking.createdAt, updatedAt: now },
    );
  }
  for (const draft of records.drafts) {
    let changed = false;
    const items = draft.items.map((entry) => {
      const item = redirectedItem(entry.item, moves);
      const saved = entry.saved && redirectedItem(entry.saved, moves);
      if (!item && !saved) return entry;
      changed = true;
      return {
        ...entry,
        item: item ?? entry.item,
        ...(entry.saved && { saved: saved ?? entry.saved }),
      };
    });
    if (changed) result.drafts.push({ ...draft, items });
  }
  return result;
}

/**
 * Home's notices of the plans saved items moved onto (M10.27): "Claude Max 20x subscribers moved to Claude Ultra on
 * Nov 1", once per plan. Only a retired plan's move, which is still in the catalog to name; an id that changed is
 * the same plan.
 */
export function movedNotices(
  moved: RedirectedRecords['moved'],
  catalog: RedirectCatalog & Pick<CatalogData, 'providers'>,
  today: IsoDate,
): PlanNotice[] {
  const notices = new Map<string, PlanNotice>();
  for (const { from, to } of moved) {
    const was = planOf(catalog, from);
    const is = planOf(catalog, to);
    const redirect = catalog.redirects?.find(
      (entry) => entry.kind === 'plan' && entry.from === from,
    );
    if (!was || !is || !redirect) continue;
    notices.set(`${from} ${to}`, {
      kind: 'moved',
      planId: to,
      title: planTitle(was.provider.name, was.plan.name),
      to: planTitle(is.provider.name, is.plan.name),
      on: redirect.on,
      date: today,
    });
  }
  return [...notices.values()];
}

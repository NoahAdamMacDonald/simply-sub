import type { DraftEdit } from '../optimizer/apply-suggestion';
import type { ListItem } from '../user/list-item';
import type { Rank } from '../user/rank';
import type { RankKey } from './rank-keys';
import type { RankOverrides } from './resolve-rank';

// Shared ranks (PROJECT-PLAN P6, M6.14, the user's choice): ranks changed in a plan's item dialog go to the same
// provider's other plans in the list that provide each key, saved with the list's Save, so there's no dialog to open
// for each. A plan with ranks of its own (ListItem.ownRanks) neither gives nor takes them. Essential is a plan's own
// ("keep this plan"): it isn't shared, and a plan's Essential isn't replaced.

/** What an item's ranks are shared across: a catalog plan's provider, or a custom subscription. None for a bundle. */
export function rankGroup(source: ListItem['source']): string | undefined {
  switch (source.kind) {
    case 'catalog':
      return `provider ${source.planId.slice(0, source.planId.indexOf('.'))}`;
    case 'custom':
      return `custom ${source.customSubId}`;
    case 'bundle':
      return undefined;
  }
}

/** One of the list's items, with the keys its plan provides (ResolvedItem.providedKeys). */
export interface RankSibling {
  item: Pick<ListItem, 'id' | 'source' | 'rankOverrides' | 'ownRanks'>;
  providedKeys: readonly RankKey[];
}

/**
 * The keys of `keys` whose rank differs between `before` and `after`, each with its new rank, or undefined where it
 * was cleared (the profile's rank applies again).
 */
export function rankChanges(
  before: RankOverrides,
  after: RankOverrides,
  keys: readonly RankKey[],
): Map<RankKey, Rank | undefined> {
  const changes = new Map<RankKey, Rank | undefined>();
  for (const key of keys) {
    const was = Object.hasOwn(before, key) ? before[key] : undefined;
    const is = Object.hasOwn(after, key) ? after[key] : undefined;
    if (was !== is) changes.set(key, is);
  }
  return changes;
}

/** The other items `item` shares its ranks with: the list's plans of its provider, none of them with ranks of its own. */
export function rankSiblings<S extends RankSibling>(
  item: Pick<ListItem, 'id' | 'source' | 'ownRanks'>,
  items: readonly S[],
): S[] {
  const group = rankGroup(item.source);
  if (group === undefined || item.ownRanks) return [];
  return items.filter(
    (other) =>
      other.item.id !== item.id && !other.item.ownRanks && rankGroup(other.item.source) === group,
  );
}

/**
 * The edits that give `item`'s rank `changes` to its siblings that provide each key (rankSiblings): none for a change
 * to Essential, and none to a sibling's Essential. A sibling nothing changes for has no edit.
 */
export function sharedRankEdits(
  item: Pick<ListItem, 'id' | 'source' | 'ownRanks'>,
  changes: ReadonlyMap<RankKey, Rank | undefined>,
  items: readonly RankSibling[],
): DraftEdit[] {
  return rankSiblings(item, items).flatMap(({ item: sibling, providedKeys }) => {
    const ranks: Record<RankKey, Rank> = { ...sibling.rankOverrides };
    let changed = false;
    for (const [key, rank] of changes) {
      const theirs = Object.hasOwn(ranks, key) ? ranks[key] : undefined;
      if (rank === 'essential' || theirs === 'essential' || !providedKeys.includes(key)) continue;
      if (theirs === rank) continue;
      if (rank === undefined) delete ranks[key];
      else ranks[key] = rank;
      changed = true;
    }
    return changed
      ? [{ kind: 'change' as const, itemId: sibling.id, changes: { rankOverrides: ranks } }]
      : [];
  });
}

/**
 * The ranks a new plan starts with from its siblings (rankSiblings): each key's from the first that ranks it, but for
 * Essential ones.
 */
export function sharedRanksFor(
  item: Pick<ListItem, 'id' | 'source' | 'ownRanks'>,
  items: readonly RankSibling[],
): Record<RankKey, Rank> {
  const ranks: Record<RankKey, Rank> = {};
  for (const { item: sibling } of rankSiblings(item, items)) {
    for (const [key, rank] of Object.entries(sibling.rankOverrides)) {
      if (rank !== 'essential' && !Object.hasOwn(ranks, key)) ranks[key] = rank;
    }
  }
  return ranks;
}

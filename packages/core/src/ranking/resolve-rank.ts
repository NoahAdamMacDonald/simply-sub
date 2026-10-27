import type { ProfileRank, Rank } from '../user/rank';
import type { RankKey } from './rank-keys';

// Rank resolution (PROJECT-PLAN §3.2, M6.1): what a rank key is worth to the user for one item. The item's own
// override wins, then the profile's rank, and a key with neither is not ranked. Ranks never cascade from a group to
// its children (BLUEPRINT §4.2), so nothing here looks at a key's parent.

/** The profile's ranks by key (RankingsRepository.ranks): a key that isn't here is not ranked. */
export type ProfileRanks = ReadonlyMap<RankKey, ProfileRank>;

/** An item's own ranks (ListItem.rankOverrides). */
export type RankOverrides = Readonly<Partial<Record<RankKey, Rank>>>;

/**
 * A key's rank for one item: its override, else the profile's rank, else not ranked. An override of Not ranked is an
 * override too: it hides the profile's rank for that item. Essential and Critical only ever come from an override.
 */
export function resolveRank(key: RankKey, overrides: RankOverrides, profile: ProfileRanks): Rank {
  const override = Object.hasOwn(overrides, key) ? overrides[key] : undefined;
  return override ?? profile.get(key) ?? 'not-ranked';
}

/**
 * Each key an item provides, with its rank for that item (ResolvedItem.effectiveRanks), in the order of `keys`. Not
 * ranked keys are there too, so the item dialog can list every key the plan provides (P6).
 */
export function effectiveRanks(
  keys: readonly RankKey[],
  overrides: RankOverrides,
  profile: ProfileRanks,
): Record<RankKey, Rank> {
  return Object.fromEntries(keys.map((key) => [key, resolveRank(key, overrides, profile)]));
}

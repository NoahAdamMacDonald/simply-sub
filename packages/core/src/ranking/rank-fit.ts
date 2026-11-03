import type { Feature } from '../catalog/feature';
import type { Plan } from '../catalog/provider';
import type { ListItem } from '../user/list-item';
import { rankSchema, type Rank, type RankCounts } from '../user/rank';
import { isPerkKey, planKeys } from './perk-keys';
import type { RankKey } from './rank-keys';
import { rankCounts } from './rank-summaries';
import type { ProfileRanks } from './resolve-rank';

// How well a plan fits the user's feature ranks (PROJECT-PLAN §3.2), for Search (P8, the feedback after M6.9): each
// card's rank counts ("2 Needed · 1 Wanted"), and the "Best for my ranks" sort.

/**
 * How many of the keys a plan provides the user ranks each way: its features' by the profile (a catalog plan has no
 * overrides), and its perks' as the user's lists rank them (perkRanks, M11.6), since a perk is ranked on a plan.
 */
export function planRankCounts(
  plan: Pick<Plan, 'id' | 'features' | 'perks'>,
  registry: readonly Feature[],
  profileRanks: ProfileRanks,
  perks: ReadonlyMap<RankKey, Rank> = new Map(),
): RankCounts {
  const effectiveRanks = Object.fromEntries(
    planKeys(plan, registry).flatMap((key) => {
      const rank = isPerkKey(key) ? perks.get(key) : profileRanks.get(key);
      return rank === undefined ? [] : [[key, rank]];
    }),
  );
  return rankCounts([{ effectiveRanks }]);
}

/**
 * How the user's lists rank each perk (M11.6), for Search's rank counts: a perk is ranked on a plan in a list, never
 * in the profile, so each perk key's rank is the one its items give it, the most important where they differ. Items
 * deleted, and ranks cleared, count nothing.
 */
export function perkRanks(items: readonly ListItem[]): Map<RankKey, Rank> {
  const ranks = new Map<RankKey, Rank>();
  for (const item of items) {
    if (item.deletedAt !== undefined) continue;
    for (const [key, rank] of Object.entries(item.rankOverrides)) {
      if (!isPerkKey(key) || rank === 'not-ranked') continue;
      const known = ranks.get(key);
      if (
        known === undefined ||
        rankSchema.options.indexOf(rank) < rankSchema.options.indexOf(known)
      ) {
        ranks.set(key, rank);
      }
    }
  }
  return ranks;
}

/**
 * What each rank a plan's key has is worth to "Best for my ranks": Essential most, then Critical, Needed, Wanted, Uses
 * and Sometimes; an Unused key counts nothing, and an Unwanted one counts against, as much as a Needed one counts for.
 */
export const rankWeights: RankCounts = {
  essential: 16,
  critical: 12,
  needed: 8,
  wanted: 4,
  uses: 2,
  sometimes: 1,
  unused: 0,
  unwanted: -8,
};

/** A plan's score for "Best for my ranks": its rank counts, weighted by rankWeights. */
export function rankScore(counts: RankCounts): number {
  return (Object.keys(rankWeights) as (keyof RankCounts)[]).reduce(
    (score, rank) => score + counts[rank] * rankWeights[rank],
    0,
  );
}

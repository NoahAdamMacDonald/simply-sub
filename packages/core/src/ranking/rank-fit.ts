import type { Feature } from '../catalog/feature';
import type { Plan } from '../catalog/provider';
import type { RankCounts } from '../user/rank';
import { providedKeys } from './rank-keys';
import { rankCounts } from './rank-summaries';
import type { ProfileRanks } from './resolve-rank';

// How well a plan fits the user's feature ranks (PROJECT-PLAN §3.2), for Search (P8, the feedback after M6.9): each
// card's rank counts ("2 Needed · 1 Wanted"), and the "Best for my ranks" sort.

/** How many of the keys a plan provides the user ranks each way, by the profile (a catalog plan has no overrides). */
export function planRankCounts(
  features: Plan['features'],
  registry: readonly Feature[],
  profileRanks: ProfileRanks,
): RankCounts {
  const effectiveRanks = Object.fromEntries(
    providedKeys(features, registry).flatMap((key) => {
      const rank = profileRanks.get(key);
      return rank === undefined ? [] : [[key, rank]];
    }),
  );
  return rankCounts([{ effectiveRanks }]);
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

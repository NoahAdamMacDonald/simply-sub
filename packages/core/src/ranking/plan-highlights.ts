import type { Feature } from '../catalog/feature';
import type { Plan } from '../catalog/provider';
import type { Rank } from '../user/rank';
import { planFeatureRows, type PlanFeatureRow } from './plan-features';
import { rankKeyOptions, type RankKey } from './rank-keys';
import { isHeadline } from './rank-summaries';

// A plan's highlights for Search's card (its Overview tab). A module of its own, since only the card's lazy details
// use it: one the initial bundle holds would carry it there.

/** The ranks that put a feature first among a plan's highlights, in this order (the feature summary's). */
const highlightRanks: readonly Rank[] = ['essential', 'critical', 'needed', 'wanted'];

/**
 * A plan's highlights (Search's card, its Overview tab: the owner's design, 2026-11-03): its features as a feature list
 * names them, a boolean by its name ("Ad free") and the rest with their value ("Video quality: 4K (Ultra HD)"). Those
 * the user ranks Essential, Critical, Needed or Wanted come first, in that order, then the registry's headlines, then
 * the rest in registry order; the first `limit` of them.
 */
export function planHighlights(
  features: Plan['features'],
  registry: readonly Feature[],
  ranks: Readonly<Partial<Record<RankKey, Rank>>>,
  limit = 5,
): string[] {
  const flat = (rows: readonly PlanFeatureRow[]): PlanFeatureRow[] =>
    rows.flatMap((row) => [row, ...flat(row.children)]);
  return flat(planFeatureRows(features, registry))
    .map((row, index) => {
      const options = rankKeyOptions(row.feature);
      const keys = row.keys.flatMap(({ key }) => options.filter((option) => option.key === key));
      const placed = keys
        .map(({ key }) => highlightRanks.indexOf(ranks[key] ?? 'not-ranked'))
        .filter((place) => place >= 0);
      return {
        text: row.value === undefined ? row.feature.name : `${row.feature.name}: ${row.value}`,
        rank: placed.length > 0 ? Math.min(...placed) : highlightRanks.length,
        headline: keys.some(isHeadline),
        index,
      };
    })
    .sort((a, b) => a.rank - b.rank || Number(b.headline) - Number(a.headline) || a.index - b.index)
    .slice(0, limit)
    .map(({ text }) => text);
}

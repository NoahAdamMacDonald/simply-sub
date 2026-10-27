import type { Feature } from '../catalog/feature';
import type { IsoDate } from '../dates/iso-date';
import { itemActivity } from '../user/item-activity';
import { countedRanks, rankSchema, type Rank, type RankCounts } from '../user/rank';
import type { FeatureSummaryRow, ResolvedItem } from '../user/resolved';
import { rankKeyLabel, rankKeyOptions, type RankKey, type RankKeyOption } from './rank-keys';

// What a list's ranks add up to (PROJECT-PLAN §3.2, M6.1): rank counts for the list cards (P3) and the feature
// summary, "VPN 2 / 3" (P3, P4). Both go over resolved items' provided keys at their effective ranks, so an enum or
// a tier counts on every rung a plan reaches: a 4k plan provides 1080p too.

/**
 * How many of the items' provided keys have each rank: each item counts each key it provides at its effective rank
 * there, and a plan listed twice counts twice. Not ranked isn't counted; every other rank is there, zero or not.
 */
export function rankCounts(items: readonly Pick<ResolvedItem, 'effectiveRanks'>[]): RankCounts {
  const counts = Object.fromEntries(countedRanks.map((rank) => [rank, 0])) as RankCounts;
  for (const { effectiveRanks } of items) {
    for (const rank of Object.values(effectiveRanks)) {
      if (rank !== 'not-ranked') counts[rank]++;
    }
  }
  return counts;
}

/** The ranks that put a key in the feature summary on their own (PROJECT-PLAN §3.2). */
const summaryRanks: readonly Rank[] = ['essential', 'critical', 'needed', 'wanted'];

/**
 * The feature summary: for each summary key, the items active today that provide it out of all that do. The summary
 * keys are the registry's headlines (a boolean feature, a value or a tier marked headline, or every key of a valued
 * feature marked so) and any key an item ranks Essential, Critical, Needed or Wanted, by its override or the
 * profile. A key no item provides isn't shown. Rows go by the key's highest rank among the items that provide it,
 * in Rank's order (Not ranked after Sometimes), then by name: "Video quality: 4K (Ultra HD)", as Search names it.
 */
export function featureSummary(
  items: readonly Pick<ResolvedItem, 'item' | 'providedKeys' | 'effectiveRanks'>[],
  registry: readonly Feature[],
  today: IsoDate,
): FeatureSummaryRow[] {
  const options = new Map(registry.flatMap(rankKeyOptions).map((option) => [option.key, option]));
  const rows = new Map<
    RankKey,
    { option: RankKeyOption; active: number; total: number; rank: number }
  >();
  for (const { item, providedKeys, effectiveRanks } of items) {
    const active = itemActivity(item, today).kind === 'active';
    for (const key of providedKeys) {
      const option = options.get(key);
      if (!option) continue;
      const rank = rankOrder(effectiveRanks[key] ?? 'not-ranked');
      const row = rows.get(key);
      if (row) {
        row.total++;
        if (active) row.active++;
        row.rank = Math.min(row.rank, rank);
      } else {
        rows.set(key, { option, active: active ? 1 : 0, total: 1, rank });
      }
    }
  }
  const lowestShown = rankOrder(summaryRanks[summaryRanks.length - 1]);
  return [...rows.values()]
    .filter((row) => row.rank <= lowestShown || isHeadline(row.option))
    .map((row) => ({ ...row, label: rankKeyLabel(row.option) }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        compare(sortName(a.label), sortName(b.label)) ||
        compare(a.option.key, b.option.key),
    )
    .map(({ option, label, active, total }) => ({ key: option.key, label, active, total }));
}

/** Whether a key's feature, value or tier is marked headline in the registry (BLUEPRINT §4.2). */
function isHeadline({ feature, option }: RankKeyOption): boolean {
  if (feature.headline === true) return true;
  const options =
    feature.type === 'number' ? feature.tiers : feature.type === 'boolean' ? [] : feature.values;
  return (
    options?.some((candidate) => candidate.id === option && candidate.headline === true) ?? false
  );
}

function rankOrder(rank: Rank): number {
  return rankSchema.options.indexOf(rank);
}

/** Lower case, without accents: "Écran" sorts with "ecran". */
function sortName(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

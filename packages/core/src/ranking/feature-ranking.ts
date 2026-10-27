import type { Category } from '../catalog/category';
import type { Feature } from '../catalog/feature';
import { nameMatcher } from '../search/name-match';
import type { ResolvedItem } from '../user/resolved';
import { rankKeyLabel, rankKeyOptions, type RankKey } from './rank-keys';
import type { ProfileRanks } from './resolve-rank';

// The Features page (PROJECT-PLAN P9, M6.2): every rankable key in the registry, as the page groups them. A section
// per feature category, in categories.yaml's order, and in it each feature in registry order, a parent feature (VPN,
// Password manager) with its children under it. A boolean is one row; an enum, a number's tiers and a set have a row
// per value or tier, so 1080p and 4K are ranked apart. Ranks never cascade (§3.2): a parent's Set all ranks its
// children's keys in one step, and nothing else does.

/** One rank key on the page. */
export interface RankingRow {
  key: RankKey;
  /** Its name in its place: a value's or tier's under its feature ("1080p (Full HD)"), or a boolean's own. */
  name: string;
  /** Its name alone, for its dropdown: "Video quality: 1080p (Full HD)". */
  label: string;
  /** What finds it: its own name and aliases, and its feature's. */
  names: readonly string[];
}

/** A feature on the page, with its rows, and a parent feature's children. */
export interface RankingEntry {
  id: string;
  name: string;
  /** What finds the whole feature: its name and aliases. */
  names: readonly string[];
  /** A boolean is ranked as one key, its row named by the feature: no heading of its own. */
  single: boolean;
  /** Its keys, or the ones a filter keeps. */
  rows: RankingRow[];
  children: RankingEntry[];
  /** Every key of its children and theirs, whatever a filter shows: what a parent's Set all ranks. */
  childKeys: RankKey[];
}

/** A feature category's section. */
export interface RankingSection {
  category: Category;
  entries: RankingEntry[];
  /** Every key in it, whatever a filter shows. */
  keys: RankKey[];
}

/**
 * The Features page's sections, from the catalog's registry and feature categories. A feature that isn't rankable
 * (includes-subscription) isn't there, and a category with nothing to rank has no section. A child whose parent
 * isn't rankable stands on its own.
 */
export function rankingSections(
  features: readonly Feature[],
  categories: readonly Category[],
): RankingSection[] {
  const rankable = features.filter((feature) => rankKeyOptions(feature).length > 0);
  const ids = new Set(rankable.map((feature) => feature.id));
  const entry = (feature: Feature): RankingEntry => {
    const children = rankable.filter((child) => child.parent === feature.id).map(entry);
    return {
      id: feature.id,
      name: feature.name,
      names: [feature.name, ...(feature.aliases ?? [])],
      single: feature.type === 'boolean',
      rows: rankKeyOptions(feature).map((option) => ({
        key: option.key,
        name: option.name,
        label: rankKeyLabel(option),
        names: [
          ...new Set([option.name, ...option.aliases, feature.name, ...(feature.aliases ?? [])]),
        ],
      })),
      children,
      childKeys: children.flatMap(entryKeys),
    };
  };
  const topLevel = rankable.filter(
    (feature) => feature.parent === undefined || !ids.has(feature.parent),
  );
  return categories.flatMap((category): RankingSection[] => {
    const entries = topLevel.filter((feature) => feature.category === category.id).map(entry);
    return entries.length > 0 ? [{ category, entries, keys: entries.flatMap(entryKeys) }] : [];
  });
}

export interface RankingFilter {
  /** Typed text, which keeps the rows whose own names or feature's it matches (nameMatcher). */
  text?: string;
  /** Only the keys the profile ranks. */
  rankedOnly?: boolean;
  ranks: ProfileRanks;
  /** Only these keys: the ones an item provides, which the item dialog ranks (P6). */
  keys?: ReadonlySet<RankKey>;
}

/**
 * The sections with the rows `filter` keeps. Text that names a feature keeps all of it, a parent's children too
 * ("vpn" keeps the kill switch), while Ranked only and `keys` still apply. An entry stays while it or one of its
 * children has a row, and a section while it has an entry.
 */
export function filterRanking(
  sections: readonly RankingSection[],
  { text = '', rankedOnly = false, ranks, keys }: RankingFilter,
): RankingSection[] {
  const matcher = nameMatcher(text);
  if (!matcher && !rankedOnly && !keys) return [...sections];
  const filtered = (entry: RankingEntry, named: boolean): RankingEntry | undefined => {
    const whole = named || (matcher?.(entry.names) ?? true);
    const rows = entry.rows.filter(
      (row) =>
        (!rankedOnly || ranks.has(row.key)) &&
        (!keys || keys.has(row.key)) &&
        (whole || (matcher?.(row.names) ?? true)),
    );
    const children = entry.children.flatMap((child) => filtered(child, whole) ?? []);
    return rows.length > 0 || children.length > 0 ? { ...entry, rows, children } : undefined;
  };
  return sections.flatMap((section): RankingSection[] => {
    const entries = section.entries.flatMap((entry) => filtered(entry, false) ?? []);
    return entries.length > 0 ? [{ ...section, entries }] : [];
  });
}

/** How many items provide each key, for the Features page's "in 3 subscriptions" (P9). */
export function keyUsage(
  items: readonly Pick<ResolvedItem, 'providedKeys'>[],
): ReadonlyMap<RankKey, number> {
  const usage = new Map<RankKey, number>();
  for (const { providedKeys } of items) {
    for (const key of providedKeys) usage.set(key, (usage.get(key) ?? 0) + 1);
  }
  return usage;
}

function entryKeys(entry: RankingEntry): RankKey[] {
  return [...entry.rows.map((row) => row.key), ...entry.childKeys];
}

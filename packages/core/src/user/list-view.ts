import { monthlyEquivalent } from '../catalog/monthly-equivalent';
import type { Feature } from '../catalog/feature';
import type { IsoDate } from '../dates/iso-date';
import { rankKeyLabel, rankKeyOptions, type RankKey } from '../ranking/rank-keys';
import { nameMatcher } from '../search/name-match';
import { parseAmount } from './custom-sub-form';
import { itemActivity } from './item-activity';
import type { FormIssue } from './item-form';
import { monthlyIn } from './monthly-average';
import type { ResolvedItem, UnresolvedItem } from './resolved';
import type { Tag } from './tag';

// List view's search box and its Sort menu (PROJECT-PLAN P4, M6.8): the text finds an item by its name, plan, nickname,
// note, tags or features; the menu sorts and filters. Pinned items come first, in the same order.

/** P4's sorts: price per month (highest first), A–Z, active first, or billing period (shortest first). */
export type ListSort = 'price' | 'name' | 'active' | 'interval';

/** The sort List view starts with: what costs most first. */
export const defaultListSort: ListSort = 'price';

/** List view's text, sort and filters. Each filter left out keeps every item. */
export interface ListViewQuery {
  q?: string;
  sort?: ListSort;
  /** Active only or Inactive only, today (PROJECT-PLAN §3.3). */
  activity?: 'active' | 'inactive';
  /** The monthly equivalent's range, in the user's currency before tax, both included. */
  minPrice?: number;
  maxPrice?: number;
  /** Rank keys an item must all provide. */
  features?: readonly RankKey[];
  /** Tag ids: an item needs one of them. */
  tags?: readonly string[];
}

export interface ListViewContext {
  /** The user's tags, by id. */
  tags: ReadonlyMap<string, Tag>;
  /** The catalog's feature registry, which names the keys an item provides. */
  registry: readonly Feature[];
  /** Settings' currency, which the price filter and sort compare in. */
  currency: string;
  today: IsoDate;
}

/** What List view shows of a list. */
export interface ListView {
  /** The pinned items that match, then the others, each in the query's order. */
  pinned: ResolvedItem[];
  others: ResolvedItem[];
  /**
   * The items it can't price or name, in the order they were added, while no text or filter is set: they have
   * nothing to match on.
   */
  unresolved: UnresolvedItem[];
  /** How many items the list has, and how many of them are shown. */
  total: number;
  shown: number;
}

/** What the Sort menu's filters offer: what the list's items have, so no choice on its own empties the list. */
export interface ListFilterOptions {
  /** The keys the items provide, by name: "Video quality: 4K (Ultra HD)". */
  features: { key: RankKey; label: string }[];
  /** The tags the items have, by name. */
  tags: Tag[];
}

/**
 * The list's items that match `query`, sorted, pinned ones first. Text matches a word of the item's name, plan,
 * nickname, note, a tag's name or a provided key's name (nameMatcher). The price filter and sort compare monthly equivalents in the
 * user's currency: an item priced in another one for want of a rate is left out by a price filter, and sorted last.
 * Ties go A–Z by name, plan and nickname.
 */
export function listView(
  items: { resolved: readonly ResolvedItem[]; unresolved: readonly UnresolvedItem[] },
  query: ListViewQuery,
  context: ListViewContext,
): ListView {
  const labels = keyLabels(context.registry);
  const matches = nameMatcher(query.q ?? '');
  const features = query.features ?? [];
  const tags = new Set(query.tags ?? []);
  const shown = items.resolved.filter((resolved) => {
    const { item } = resolved;
    if (query.activity && itemActivity(item, context.today).kind !== query.activity) return false;
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      const monthly = monthlyIn(resolved, context.currency);
      if (monthly === undefined) return false;
      if (query.minPrice !== undefined && monthly < query.minPrice) return false;
      if (query.maxPrice !== undefined && monthly > query.maxPrice) return false;
    }
    if (!features.every((key) => resolved.providedKeys.includes(key))) return false;
    if (tags.size > 0 && !item.tagIds.some((id) => tags.has(id))) return false;
    return (
      !matches ||
      matches([
        resolved.name,
        resolved.planName,
        ...(item.nickname === undefined ? [] : [item.nickname]),
        ...(item.note === undefined ? [] : [item.note]),
        ...item.tagIds.flatMap((id) => context.tags.get(id)?.name ?? []),
        ...resolved.providedKeys.flatMap((key) => labels.get(key) ?? []),
      ])
    );
  });
  const sorted = shown.sort(sorter(query.sort ?? defaultListSort, context));
  const filtered = matches !== undefined || listFilterCount(query) > 0;
  return {
    pinned: sorted.filter(({ item }) => item.pinned),
    others: sorted.filter(({ item }) => !item.pinned),
    unresolved: filtered ? [] : [...items.unresolved],
    total: items.resolved.length + items.unresolved.length,
    shown: sorted.length + (filtered ? 0 : items.unresolved.length),
  };
}

/** The Sort menu's price fields, as typed: an amount per month, or nothing for no limit. */
export interface ListPriceText {
  min: string;
  max: string;
}

/** The price range typed, and what's wrong with it: amounts (parseAmount), and the lowest no higher than the highest. */
export interface ListPriceRange {
  minPrice?: number;
  maxPrice?: number;
  issues: FormIssue[];
}

/** The range the price fields give. A field that isn't an amount sets no limit, and says so. */
export function listPriceRange({ min, max }: ListPriceText): ListPriceRange {
  const issues: FormIssue[] = [];
  const read = (text: string, field: keyof ListPriceText) => {
    if (text.trim() === '') return undefined;
    const amount = parseAmount(text);
    if (amount === undefined) issues.push({ path: [field], message: 'Enter an amount, like 9.99' });
    return amount;
  };
  const minPrice = read(min, 'min');
  const maxPrice = read(max, 'max');
  if (minPrice !== undefined && maxPrice !== undefined && maxPrice < minPrice) {
    issues.push({ path: ['max'], message: 'Must be at least the lowest price' });
    return { minPrice, issues };
  }
  return {
    ...(minPrice !== undefined && { minPrice }),
    ...(maxPrice !== undefined && { maxPrice }),
    issues,
  };
}

/** How many of the Sort menu's filters are set (not the sort or the text): the menu's button says so. */
export function listFilterCount(query: ListViewQuery): number {
  return [
    query.activity !== undefined,
    query.minPrice !== undefined || query.maxPrice !== undefined,
    (query.features?.length ?? 0) > 0,
    (query.tags?.length ?? 0) > 0,
  ].filter(Boolean).length;
}

/** The Sort menu's feature and tag choices for a list's items. */
export function listFilterOptions(
  resolved: readonly ResolvedItem[],
  context: Pick<ListViewContext, 'tags' | 'registry'>,
): ListFilterOptions {
  const labels = keyLabels(context.registry);
  const keys = new Set(resolved.flatMap((item) => item.providedKeys));
  const tagIds = new Set(resolved.flatMap(({ item }) => item.tagIds));
  return {
    features: [...keys]
      .flatMap((key) => {
        const label = labels.get(key);
        return label === undefined ? [] : [{ key, label }];
      })
      .sort((a, b) => compare(sortName(a.label), sortName(b.label)) || compare(a.key, b.key)),
    tags: [...tagIds]
      .flatMap((id) => context.tags.get(id) ?? [])
      .sort((a, b) => compare(sortName(a.name), sortName(b.name)) || compare(a.id, b.id)),
  };
}

/** Every rank key's name, as Search's Features chips have it. */
function keyLabels(registry: readonly Feature[]): Map<RankKey, string> {
  return new Map(
    registry.flatMap(rankKeyOptions).map((option) => [option.key, rankKeyLabel(option)]),
  );
}

function sorter(
  sort: ListSort,
  { currency, today }: Pick<ListViewContext, 'currency' | 'today'>,
): (a: ResolvedItem, b: ResolvedItem) => number {
  const byName = (a: ResolvedItem, b: ResolvedItem) =>
    compare(sortName(a.name), sortName(b.name)) ||
    compare(sortName(a.planName), sortName(b.planName)) ||
    compare(sortName(a.item.nickname ?? ''), sortName(b.item.nickname ?? ''));
  switch (sort) {
    case 'price':
      return (a, b) => {
        const priceA = monthlyIn(a, currency) ?? -Infinity;
        const priceB = monthlyIn(b, currency) ?? -Infinity;
        return priceB - priceA || byName(a, b);
      };
    case 'name':
      return byName;
    case 'active': {
      const inactive = (resolved: ResolvedItem) =>
        itemActivity(resolved.item, today).kind === 'active' ? 0 : 1;
      return (a, b) => inactive(a) - inactive(b) || byName(a, b);
    }
    case 'interval': {
      // A period's length in months: a month is 1, a year 12, 2 weeks about 0.46.
      const months = ({ item: { billing } }: ResolvedItem) =>
        1 /
        monthlyEquivalent({
          amount: 1,
          interval: billing.interval,
          intervalCount: billing.intervalCount,
        });
      return (a, b) => months(a) - months(b) || byName(a, b);
    }
  }
}

/** Lower case, without accents, for sorting by name. */
function sortName(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

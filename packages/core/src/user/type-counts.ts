import type { ServiceCategory } from '../catalog/category';
import type { ResolvedItem } from './resolved';

// What types of subscriptions a list has (P3's and P4's right column, the feedback after M6.8): how many items are in
// each service category, "Streaming video 3 · VPN 1".

/** One type, and how many items are of it. */
export interface TypeCount {
  /** A service category's id, or `custom` for the user's own subscriptions. */
  id: string;
  name: string;
  /** A Material Symbols name. */
  icon: string;
  count: number;
}

/** The type a custom subscription counts as: it has no category. */
export const customType = { id: 'custom', name: 'Custom', icon: 'edit_note' } as const;

/**
 * How many of `items` are of each type: each of its service categories (an item in two counts in both), or Custom
 * for a custom subscription. A category the registry doesn't name is left out. Most first, then by name.
 */
export function typeCounts(
  items: readonly Pick<ResolvedItem, 'categories' | 'customSubId'>[],
  categories: readonly ServiceCategory[],
): TypeCount[] {
  const known = new Map(categories.map((category) => [category.id, category]));
  const counts = new Map<string, TypeCount>();
  const count = (type: Omit<TypeCount, 'count'>) => {
    const counted = counts.get(type.id);
    if (counted) counted.count++;
    else counts.set(type.id, { ...type, count: 1 });
  };
  for (const item of items) {
    if (item.customSubId !== undefined) {
      count(customType);
      continue;
    }
    for (const id of new Set(item.categories)) {
      const category = known.get(id);
      if (category) count({ id, name: category.name, icon: category.icon });
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}

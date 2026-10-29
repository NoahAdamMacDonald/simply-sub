import { inclusionsOf, planOf } from '../catalog/plan-lookup';
import type { CatalogData } from '../catalog/snapshot';
import type { IsoDate } from '../dates/iso-date';
import type { ListItem } from './list-item';

// What takes over from an item that ends (PROJECT-PLAN §3.3, M7.11): Optimizations replaces items on their next charge
// (M8.5), so an item it replaced stays in the list until then, and its status says what it becomes: a bundle or suite
// of the same list, or an extra member on another account of its provider.

export interface ItemReplacement {
  kind: 'bundle' | 'suite' | 'extra-member';
  /** The item that takes over: the bundle or suite, or the account the extra member joins. */
  itemId: string;
  /** The day it takes over: the replaced item's end. */
  on: IsoDate;
}

/**
 * Each ending item's replacement in its list, by its id: an item that ends on a day when, in the same list, a bundle
 * that includes its plan, or a suite that includes its plan or provider, has started, or an extra member joins another
 * plan of its provider (an add-on whose `since` is that day).
 */
export function itemReplacements(
  items: readonly ListItem[],
  catalog: Pick<CatalogData, 'providers' | 'bundles'>,
): Map<string, ItemReplacement> {
  const found = new Map<string, ItemReplacement>();
  for (const item of items) {
    const { billing, source } = item;
    if (billing.mode !== 'recurring' || billing.endDate === undefined) continue;
    if (source.kind !== 'catalog') continue;
    const on = billing.endDate;
    const planId = source.planId;
    const providerId = planId.slice(0, planId.indexOf('.'));
    const takesOver = (other: ListItem): ItemReplacement['kind'] | undefined => {
      if (other.id === item.id || other.listId !== item.listId) return undefined;
      const started =
        other.billing.mode === 'recurring' &&
        (other.billing.startDate ?? other.billing.anchorDate) <= on &&
        (other.billing.endDate === undefined || other.billing.endDate > on);
      if (other.source.kind === 'bundle') {
        const { bundleId } = other.source;
        const bundle = catalog.bundles.find(({ id }) => id === bundleId);
        return started && bundle?.includes.includes(planId) ? 'bundle' : undefined;
      }
      if (other.source.kind !== 'catalog') return undefined;
      if (
        other.source.addOns?.some((addOn) => addOn.since === on) &&
        other.source.planId.startsWith(`${providerId}.`)
      ) {
        return 'extra-member';
      }
      const suite = planOf(catalog, other.source.planId)?.plan;
      if (!started || !suite) return undefined;
      const included = inclusionsOf(suite, catalog);
      return included.has(planId) || included.has(providerId) ? 'suite' : undefined;
    };
    for (const other of items) {
      const kind = takesOver(other);
      if (kind) {
        found.set(item.id, { kind, itemId: other.id, on });
        break;
      }
    }
  }
  return found;
}

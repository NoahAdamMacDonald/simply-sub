import type { Bundle } from '../catalog/bundle';
import type { IsoDate } from '../dates/iso-date';
import { itemActivity, type ItemActivity } from '../user/item-activity';
import type { ListItem } from '../user/list-item';

// A provider's place in the user's lists, for Search (PROJECT-PLAN P8, §3.3): its status across every list ("Active ·
// 2 lists"), the Activity filter, and which of its plans the user has, which a card shows first.

export interface ProviderActivity {
  /** Active when one of its items is. */
  kind: ItemActivity['kind'];
  /** When it's inactive: the soonest date one of its items starts again. */
  activeFrom?: IsoDate;
  /** How many lists have it. */
  lists: number;
  /** Which lists have it, in the order their items came: Search's "· 2 lists" names them. */
  listIds: string[];
  /** The plans of it in the lists, each active when an item with it is, in the order the items came. */
  plans: { planId: string; kind: ItemActivity['kind'] }[];
}

/**
 * Each listed provider's activity, by provider id: from its catalog items, and from a bundle for each provider whose
 * plan it includes. Custom subscriptions aren't catalog providers, and a bundle `bundles` doesn't have counts for none.
 */
export function providerActivity(
  items: readonly ListItem[],
  bundles: readonly Bundle[],
  today: IsoDate,
): Map<string, ProviderActivity> {
  const found = new Map<
    string,
    {
      lists: Set<string>;
      plans: Map<string, ItemActivity['kind']>;
      active: boolean;
      from?: IsoDate;
    }
  >();
  for (const item of items) {
    const { source } = item;
    const planIds =
      source.kind === 'catalog'
        ? [source.planId]
        : source.kind === 'bundle'
          ? (bundles.find((bundle) => bundle.id === source.bundleId)?.includes ?? [])
          : [];
    const { kind, activeFrom } = itemActivity(item, today);
    for (const planId of planIds) {
      // Plan ids are <provider id>.<slug>, which validateCatalog checks.
      const providerId = planId.slice(0, planId.indexOf('.'));
      let provider = found.get(providerId);
      if (!provider) {
        found.set(providerId, (provider = { lists: new Set(), plans: new Map(), active: false }));
      }
      provider.lists.add(item.listId);
      if (kind === 'active' || !provider.plans.has(planId)) {
        provider.plans.set(planId, kind);
      }
      provider.active ||= kind === 'active';
      if (activeFrom !== undefined && (provider.from === undefined || activeFrom < provider.from)) {
        provider.from = activeFrom;
      }
    }
  }
  return new Map(
    [...found].map(([id, { lists, plans, active, from }]) => [
      id,
      {
        kind: active ? 'active' : 'inactive',
        ...(!active && from !== undefined && { activeFrom: from }),
        lists: lists.size,
        listIds: [...lists],
        plans: [...plans].map(([planId, kind]) => ({ planId, kind })),
      },
    ]),
  );
}

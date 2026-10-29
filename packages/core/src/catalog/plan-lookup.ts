import type { Plan } from './provider';
import type { CatalogData, SnapshotProvider } from './snapshot';

// Finding plans in a catalog by id, for the optimizer (BLUEPRINT §10) and the items' statuses (PROJECT-PLAN §3.3).

/** A plan by its id (<provider id>.<slug>), with its provider. */
export function planOf(
  catalog: Pick<CatalogData, 'providers'>,
  planId: string,
): { provider: SnapshotProvider; plan: Plan } | undefined {
  const provider = catalog.providers.find(({ id }) => id === planId.slice(0, planId.indexOf('.')));
  const plan = provider?.plans.find(({ id }) => id === planId);
  return provider && plan ? { provider, plan } : undefined;
}

/**
 * Every plan or provider a suite includes, through the plans it includes too (Duo includes Unlimited, which includes
 * the Plus plans).
 */
export function inclusionsOf(plan: Plan, catalog: Pick<CatalogData, 'providers'>): Set<string> {
  const found = new Set<string>();
  const queue = [plan];
  while (queue.length > 0) {
    const listed = queue.shift()?.features['includes-subscription'];
    for (const id of Array.isArray(listed) ? listed : []) {
      if (found.has(id) || id === plan.id) continue;
      found.add(id);
      const included = planOf(catalog, id)?.plan;
      if (included) queue.push(included);
    }
  }
  return found;
}

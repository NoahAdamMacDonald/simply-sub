import type { Category } from '../catalog/category';
import type { Feature } from '../catalog/feature';
import type { Perk, Plan, Provider } from '../catalog/provider';
import { providedKeys, type RankKey } from './rank-keys';

// Ranked perks (M11.6, BLUEPRINT §4.2): a provider lists its perks once with ids, and each plan the ones it has. Each
// perk is a rank key, perk:<provider>/<perk>, which a plan provides when it lists the perk. They're ranked in the item
// dialog only, never on the Features page, and counted like features' keys: rank counts, feature summaries, Search's
// ranks and the optimizer. Here they're also boolean features of a Perks category, made from the providers, so the
// code that names and groups keys (the item dialog's ranks, summaries, labels) takes them as it takes the registry's.

/** A perk's rank key: `perk:xbox-game-pass/fortnite-crew`. */
export function perkKey(providerId: string, perkId: string): RankKey {
  return `perk:${providerId}/${perkId}`;
}

/** Whether a rank key is a perk's rather than a feature's. */
export function isPerkKey(key: RankKey): boolean {
  return key.startsWith('perk:');
}

/** The rank keys of a plan's perks, its provider's id taken from its own (`xbox-game-pass.ultimate`). */
export function planPerkKeys(plan: Pick<Plan, 'id' | 'perks'>): RankKey[] {
  const providerId = plan.id.slice(0, plan.id.indexOf('.'));
  return (plan.perks ?? []).map((perk) => perkKey(providerId, perk));
}

/** Every rank key a plan provides: its features' (providedKeys), then its perks'. */
export function planKeys(
  plan: Pick<Plan, 'id' | 'features' | 'perks'>,
  registry: readonly Feature[],
): RankKey[] {
  return [...providedKeys(plan.features, registry), ...planPerkKeys(plan)];
}

/** The feature category perks are in: the item dialog's last group of ranks. */
export const perksCategory: Category = { id: 'perks', name: 'Perks' };

/** A perk as a boolean feature of the Perks category: its rank key as the id, its provider's name for it. */
export function perkFeature(providerId: string, perk: Perk): Feature {
  return {
    id: perkKey(providerId, perk.id),
    name: perk.name,
    category: perksCategory.id,
    type: 'boolean',
  };
}

/** Every provider's perks as features, in the providers' order. */
export function perkFeatures(providers: readonly Pick<Provider, 'id' | 'perks'>[]): Feature[] {
  return providers.flatMap((provider) =>
    (provider.perks ?? []).map((perk) => perkFeature(provider.id, perk)),
  );
}

/**
 * What every rank key of a catalog is: the registry's features, then the providers' perks as features; none without a
 * catalog. What names, groups or counts keys takes it in place of the registry; the Features page and Search's
 * filters keep the registry.
 */
export function rankFeatures(
  catalog:
    | { features: readonly Feature[]; providers: readonly Pick<Provider, 'id' | 'perks'>[] }
    | undefined,
): Feature[] {
  return catalog ? [...catalog.features, ...perkFeatures(catalog.providers)] : [];
}

import type { Feature } from '../catalog/feature';
import type { Plan } from '../catalog/provider';

// Rank keys (PROJECT-PLAN §3.2): one per rankable option of a feature. A boolean feature's key is its id
// (streaming.ad-free); an enum value, a number tier or a set value adds its id (video.quality=4k,
// streaming.concurrent-streams=2-4, password-manager.item-types=passkey). GET /providers filters on them (M2.3),
// GET /plans/:id lists the ones a plan provides (M2.4), and M6.1 builds rank resolution and counts on top.

export type RankKey = string;

/** One rank key, with the feature it belongs to and what it's called. */
export interface RankKeyOption {
  key: RankKey;
  feature: Feature;
  /** The value or tier id after `=`, or undefined for a boolean feature. */
  option?: string;
  /** A boolean's own name and aliases; a value's or tier's otherwise. */
  name: string;
  aliases: readonly string[];
}

/**
 * Every rank key of `feature`, in registry order: none for a feature that isn't rankable, a number without tiers or
 * a set of provider ids.
 */
export function rankKeyOptions(feature: Feature): RankKeyOption[] {
  if (feature.rankable === false) {
    return [];
  }
  const withOptions = (options: readonly { id: string; name: string; aliases?: string[] }[]) =>
    options.map((option): RankKeyOption => ({
      key: `${feature.id}=${option.id}`,
      feature,
      option: option.id,
      name: option.name,
      aliases: option.aliases ?? [],
    }));
  switch (feature.type) {
    case 'boolean':
      return [{ key: feature.id, feature, name: feature.name, aliases: feature.aliases ?? [] }];
    case 'enum':
      return withOptions(feature.values);
    case 'number':
      return withOptions(feature.tiers ?? []);
    case 'set':
      return withOptions(feature.values ?? []);
  }
}

/**
 * A key's name where it stands alone, as Search's feature chips show it: a boolean's own name ("Ad free"), else its
 * feature's and its value's or tier's ("Video quality: 4K (Ultra HD)").
 */
export function rankKeyLabel({ feature, option, name }: RankKeyOption): string {
  return option === undefined ? name : `${feature.name}: ${name}`;
}

/**
 * Whether a plan's features provide the key: a boolean that is true, an enum value at least the key's, a number at
 * least the tier's min (or unlimited), a set that contains the value. A feature the plan doesn't list provides
 * nothing.
 */
export function providesKey(
  features: Plan['features'],
  { feature, option }: RankKeyOption,
): boolean {
  const value = Object.hasOwn(features, feature.id) ? features[feature.id] : undefined;
  switch (feature.type) {
    case 'boolean':
      return value === true;
    case 'enum': {
      const position = feature.values.findIndex((candidate) => candidate.id === value);
      const needed = feature.values.findIndex((candidate) => candidate.id === option);
      return position >= 0 && needed >= 0 && position >= needed;
    }
    case 'number': {
      const tier = feature.tiers?.find((candidate) => candidate.id === option);
      return (
        tier !== undefined &&
        (value === 'unlimited' || (typeof value === 'number' && value >= tier.min))
      );
    }
    case 'set':
      return Array.isArray(value) && option !== undefined && value.includes(option);
  }
}

/** Every rank key a plan's features provide, in registry order: a 4k plan provides each video.quality up to 4k. */
export function providedKeys(features: Plan['features'], registry: readonly Feature[]): RankKey[] {
  return registry
    .flatMap(rankKeyOptions)
    .filter((option) => providesKey(features, option))
    .map((option) => option.key);
}

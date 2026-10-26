import type { Feature, FeatureValue } from '../catalog/feature';
import type { Plan } from '../catalog/provider';
import { providesKey, rankKeyOptions, type RankKey } from './rank-keys';

/** One feature of a plan as a feature list shows it (Search's and List view's expanded cards, P4 and P8). */
export interface PlanFeatureRow {
  feature: Feature;
  /** The plan's value as text: "4K (Ultra HD)", "10 devices", "Unlimited", "WireGuard, OpenVPN". None for a boolean. */
  value?: string;
  /**
   * The rank keys the value provides, in registry order, each with its value's or tier's name when the feature has
   * several keys: a 4K plan provides video.quality=1080p ("1080p (Full HD)") and video.quality=4k too.
   */
  keys: { key: RankKey; option?: string }[];
  /** The plan's features whose parent this one is (a VPN's protocols), in registry order. */
  children: PlanFeatureRow[];
}

/**
 * A plan's features in registry order, each under its parent when the plan lists that too. Left out: features that
 * aren't rankable (`includes-subscription`, which cards show as included plans), and values that provide nothing (a
 * false boolean, a 0, an empty set).
 */
export function planFeatureRows(
  features: Plan['features'],
  registry: readonly Feature[],
): PlanFeatureRow[] {
  const rows = new Map<string, PlanFeatureRow>();
  for (const feature of registry) {
    const value = Object.hasOwn(features, feature.id) ? features[feature.id] : undefined;
    if (feature.rankable === false || value === undefined || !providesSomething(value)) continue;
    const options = rankKeyOptions(feature);
    rows.set(feature.id, {
      feature,
      ...(feature.type !== 'boolean' && { value: featureValueText(feature, value) }),
      keys: options
        .filter((option) => providesKey(features, option))
        .map(({ key, option, name }) => ({ key, ...(option !== undefined && { option: name }) })),
      children: [],
    });
  }
  const top: PlanFeatureRow[] = [];
  for (const row of rows.values()) {
    const parent = row.feature.parent === undefined ? undefined : rows.get(row.feature.parent);
    (parent?.children ?? top).push(row);
  }
  return top;
}

/** A plan's value for a feature as text: "4K (Ultra HD)", "1 device", "500 GB", "Unlimited", "Logins, Passkeys". */
export function featureValueText(feature: Feature, value: FeatureValue): string {
  switch (feature.type) {
    case 'boolean':
      return value === true ? 'Yes' : 'No';
    case 'number':
      if (value === 'unlimited') return 'Unlimited';
      if (typeof value !== 'number') return String(value);
      return feature.unit === undefined
        ? value.toLocaleString('en')
        : `${value.toLocaleString('en')} ${unitText(feature.unit, value)}`;
    case 'enum':
      return feature.values.find((candidate) => candidate.id === value)?.name ?? String(value);
    case 'set': {
      const ids = Array.isArray(value) ? value : [String(value)];
      return ids
        .map((id) => feature.values?.find((candidate) => candidate.id === id)?.name ?? id)
        .join(', ');
    }
  }
}

function providesSomething(value: FeatureValue): boolean {
  return value !== false && value !== 0 && !(Array.isArray(value) && value.length === 0);
}

/**
 * The registry's units are plural ("devices", "countries"), so one of them needs the singular. A unit that isn't a
 * plural noun ("GB") stays as it is. A new unit whose singular isn't the plural less its "s" goes in `singulars`.
 */
function unitText(unit: string, count: number): string {
  if (count !== 1) return unit;
  if (Object.hasOwn(singulars, unit)) return singulars[unit];
  if (unit.endsWith('ies')) return `${unit.slice(0, -3)}y`;
  return unit.endsWith('s') ? unit.slice(0, -1) : unit;
}

const singulars: Record<string, string> = {
  addresses: 'address',
  aliases: 'alias',
  people: 'person',
};

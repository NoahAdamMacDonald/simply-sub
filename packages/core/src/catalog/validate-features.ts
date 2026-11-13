import type { Categories } from './category';
import { choices, didYouMean, idOf, listedMoreThanOnce } from './checks';
import { featureSchema, type Feature, type FeatureValue } from './feature';
import type { Price } from './price';
import type { Plan } from './provider';
import type { CatalogIds, CatalogIssuePath, Report } from './validate-catalog';

// The feature checks of validateCatalog (BLUEPRINT §6.2): the registry's own references, and each plan's
// feature values and labels against the registry.

/** The feature that lists the plans a suite includes (BLUEPRINT §4.4). */
const includesSubscription = 'includes-subscription';

type SetFeature = Extract<Feature, { type: 'set' }>;

const typeWithArticle: Record<Feature['type'], string> = {
  boolean: 'a boolean',
  number: 'a number',
  enum: 'an enum',
  set: 'a set',
};

export interface FeatureRegistry {
  features: ReadonlyMap<string, Feature>;
  /** Features whose own definition is broken. Plans that use them are checked once it's fixed. */
  unchecked: ReadonlySet<string>;
}

/**
 * The features in data/features.yaml that match the schema, after checking that ids are unique and that each
 * feature's category and parent exist, with the parent listed first. Undefined when the file isn't a list at all.
 * The caller has already reported the schema errors, and leaves out category checks when `categories` couldn't be
 * read.
 */
export function readFeatureRegistry(
  data: unknown,
  categories: Categories | undefined,
  report: Report,
): FeatureRegistry | undefined {
  if (!Array.isArray(data)) {
    return undefined;
  }
  const features = new Map<string, Feature>();
  const unchecked = new Set<string>();
  const valid: { feature: Feature; index: number }[] = [];
  data.forEach((item: unknown, index) => {
    const id = idOf(item);
    if (id !== undefined && (features.has(id) || unchecked.has(id))) {
      report([index, 'id'], listedMoreThanOnce(id));
      return;
    }
    const result = featureSchema.safeParse(item);
    if (result.success) {
      features.set(result.data.id, result.data);
      valid.push({ feature: result.data, index });
    } else if (id !== undefined) {
      unchecked.add(id);
    }
  });

  const categoryIds = categories?.feature.map((category) => category.id);
  const serviceIds = categories?.service.map((category) => category.id);
  const indexes = new Map(valid.map(({ feature, index }) => [feature.id, index]));
  for (const { feature, index } of valid) {
    if (categoryIds && !categoryIds.includes(feature.category)) {
      report(
        [index, 'category'],
        `"${feature.category}" isn't a feature category in data/categories.yaml${choices(feature.category, categoryIds)}`,
      );
    }
    feature.requiredIn?.forEach((id, item) => {
      const at = [index, 'requiredIn', item];
      if (feature.requiredIn?.indexOf(id) !== item) {
        report(at, listedMoreThanOnce(id));
      } else if (serviceIds && !serviceIds.includes(id)) {
        report(
          at,
          `"${id}" isn't a service category in data/categories.yaml${choices(id, serviceIds)}`,
        );
      }
    });
    if (feature.providerWide && feature.parent !== undefined) {
      report(
        [index, 'providerWide'],
        `A provider-wide feature isn't in a group: a plan's ${feature.parent} decides its children, so leave out parent or providerWide`,
      );
    }
    const problem = parentProblem(feature, index, features, indexes, unchecked);
    if (problem) {
      report([index, 'parent'], problem);
    }
  }
  return { features, unchecked };
}

/** A group is a top-level boolean feature: its children name it as their parent (PROJECT-PLAN §3.2). */
function isGroup(feature: Feature | undefined): boolean {
  return feature?.type === 'boolean' && feature.parent === undefined;
}

/**
 * A parent is a group listed before the feature: GET /features keeps the file's order, and the Features page shows
 * each group above its features (PROJECT-PLAN P9).
 */
function parentProblem(
  feature: Feature,
  index: number,
  features: ReadonlyMap<string, Feature>,
  indexes: ReadonlyMap<string, number>,
  unchecked: ReadonlySet<string>,
): string | undefined {
  const parentId = feature.parent;
  if (parentId === undefined || unchecked.has(parentId)) {
    return undefined;
  }
  if (parentId === feature.id) {
    return "A feature can't be its own parent";
  }
  const parent = features.get(parentId);
  if (!parent) {
    return `"${parentId}" isn't a feature${didYouMean(parentId, [...features.keys()])}`;
  }
  if (parent.type !== 'boolean') {
    return `"${parentId}" is ${typeWithArticle[parent.type]} feature, but a parent must be a boolean group feature`;
  }
  if (parent.parent !== undefined) {
    return `"${parentId}" is in the group ${parent.parent}, and groups are one level deep: use ${parent.parent}`;
  }
  if ((indexes.get(parentId) ?? -1) > index) {
    return `"${parentId}" is listed after this feature: move the group above its features`;
  }
  return undefined;
}

export interface PlanContext {
  registry: FeatureRegistry;
  ids: CatalogIds;
  providerId: string;
  report: Report;
}

/**
 * Checks a provider's own features (M11.4): only provider-wide features, each with a value of its type. Its plans'
 * values are checked with each plan (checkPlanFeatures).
 */
export function checkProviderFeatures(features: Plan['features'], context: PlanContext): void {
  const { registry, report } = context;
  for (const [featureId, value] of Object.entries(features)) {
    const at = ['features', featureId];
    if (registry.unchecked.has(featureId)) {
      continue;
    }
    const feature = registry.features.get(featureId);
    if (!feature) {
      report(
        at,
        `Not a feature in data/features.yaml${didYouMean(featureId, [...registry.features.keys()], 'add it there first')}`,
      );
    } else if (!feature.providerWide) {
      report(
        at,
        `${featureId} isn't provider-wide in data/features.yaml: state it on each plan, even when every plan has the same value`,
      );
    } else {
      checkValue(feature, value, at, undefined, context);
    }
  }
}

/**
 * Checks a plan's features and featureLabels against the registry. `path` is the plan's own. A value its provider's
 * features state already, the same, is left out.
 */
export function checkPlanFeatures(
  plan: Plan,
  path: CatalogIssuePath,
  context: PlanContext,
  providerFeatures: Plan['features'] = {},
): void {
  const { registry, report } = context;
  for (const [featureId, value] of Object.entries(plan.features)) {
    const at = [...path, 'features', featureId];
    if (registry.unchecked.has(featureId)) {
      continue;
    }
    if (
      registry.features.get(featureId)?.providerWide === true &&
      Object.hasOwn(providerFeatures, featureId) &&
      sameValue(providerFeatures[featureId], value)
    ) {
      report(
        at,
        "Its provider's features say so already: leave it out, or give the value it differs by",
      );
      continue;
    }
    const feature = registry.features.get(featureId);
    if (!feature) {
      report(
        at,
        `Not a feature in data/features.yaml${didYouMean(featureId, [...registry.features.keys()], 'add it there first')}`,
      );
      continue;
    }
    checkValue(feature, value, at, plan.id, context);
    const { parent } = feature;
    if (
      parent !== undefined &&
      isGroup(registry.features.get(parent)) &&
      plan.features[parent] !== true
    ) {
      report(at, `Needs ${parent}: true, the group this feature belongs to`);
    }
  }
  for (const key of Object.keys(plan.featureLabels ?? {})) {
    const problem = labelProblem(key, registry, context.ids);
    if (problem) {
      report([...path, 'featureLabels', key], problem);
    }
  }
}

function checkValue(
  feature: Feature,
  value: FeatureValue,
  path: CatalogIssuePath,
  planId: string | undefined,
  context: PlanContext,
): void {
  const { report } = context;
  switch (feature.type) {
    case 'boolean':
      if (typeof value !== 'boolean') {
        report(path, 'Use true or false');
      }
      return;
    case 'number':
      if (typeof value !== 'number' && value !== 'unlimited') {
        report(path, `Use a number${feature.unit ? ` of ${feature.unit}` : ''}, or unlimited`);
      }
      return;
    case 'enum': {
      const valueIds = feature.values.map((option) => option.id);
      if (typeof value !== 'string') {
        report(path, `Use a ${feature.id} value${choices(String(value), valueIds)}`);
      } else if (!valueIds.includes(value)) {
        report(path, `"${value}" isn't a ${feature.id} value${choices(value, valueIds)}`);
      }
      return;
    }
    case 'set':
      if (!Array.isArray(value)) {
        report(
          path,
          feature.values
            ? `Use a list of ${feature.id} values, such as [${feature.values[0].id}]`
            : 'Use a list of provider or plan ids',
        );
        return;
      }
      value.forEach((item, index) => {
        const problem =
          value.indexOf(item) < index
            ? listedMoreThanOnce(item)
            : setItemProblem(feature, item, planId, context);
        if (problem) {
          report([...path, index], problem);
        }
      });
      return;
  }
}

/**
 * A set lists its own values, or provider and plan ids for `valuesFrom: providers`. A suite doesn't include
 * itself or its own provider.
 */
function setItemProblem(
  feature: SetFeature,
  id: string,
  planId: string | undefined,
  { ids, providerId }: PlanContext,
): string | undefined {
  if (feature.values) {
    const valueIds = feature.values.map((option) => option.id);
    return valueIds.includes(id)
      ? undefined
      : `"${id}" isn't a ${feature.id} value${choices(id, valueIds)}`;
  }
  if (feature.id === includesSubscription && id === planId) {
    return "A plan can't include itself";
  }
  if (feature.id === includesSubscription && id === providerId) {
    return `"${id}" is this plan's own provider: list the plans it includes instead`;
  }
  switch (ids.kindOf(id)) {
    case 'provider':
    case 'plan':
    case 'unchecked':
      return undefined;
    case 'add-on':
      return `"${id}" is an add-on: list provider or plan ids`;
    case 'bundle':
      return `"${id}" is a bundle: list provider or plan ids`;
    case 'reseller':
      return `"${id}" is a reseller: list provider or plan ids`;
    case undefined:
      return `"${id}" isn't a provider or plan id${didYouMean(id, ids.all('provider', 'plan'))}`;
  }
}

/** Two values of one feature are the same, a set's in any order. */
function sameValue(a: FeatureValue, b: FeatureValue): boolean {
  return Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((item) => b.includes(item))
    : a === b;
}

/** A featureLabels key is a feature id, or a rank key whose value or tier exists (BLUEPRINT §4.2 rule 5). */
function labelProblem(key: string, registry: FeatureRegistry, ids: CatalogIds): string | undefined {
  const [featureId, option] = key.includes('=') ? key.split('=') : [key, undefined];
  if (registry.unchecked.has(featureId)) {
    return undefined;
  }
  const feature = registry.features.get(featureId);
  if (!feature) {
    return `"${featureId}" isn't a feature in data/features.yaml${didYouMean(featureId, [...registry.features.keys()])}`;
  }
  if (option === undefined) {
    return undefined;
  }
  const notAValue = (kind: string, optionIds: string[]) =>
    optionIds.includes(option)
      ? undefined
      : `"${option}" isn't a ${featureId} ${kind}${choices(option, optionIds)}`;
  switch (feature.type) {
    case 'boolean':
      return `${featureId} is a boolean feature, which has no values: use ${featureId} alone`;
    case 'number':
      return feature.tiers
        ? notAValue(
            'tier',
            feature.tiers.map((tier) => tier.id),
          )
        : `${featureId} has no tiers: use ${featureId} alone`;
    case 'enum':
      return notAValue(
        'value',
        feature.values.map((value) => value.id),
      );
    case 'set':
      if (feature.values) {
        return notAValue(
          'value',
          feature.values.map((value) => value.id),
        );
      }
      return ids.kindOf(option) === 'provider' || ids.kindOf(option) === 'unchecked'
        ? undefined
        : `"${option}" isn't a provider id${didYouMean(option, ids.all('provider'))}`;
  }
}

/**
 * Plans whose required features no official page states yet, by plan id (M11.4): each named feature missing is a
 * warning, not an error. Their files' comments name the pages that were silent. M11.9 inferred ESPN Select's and ICI
 * RDI's from pages that bear on them (`inferred`); RDS's and TSN's pages give no reason to infer any, no Rumble page
 * says how many streams Premium plays at once, and no Italian page names the video quality of discovery+'s Italian plans
 * (M11.15, the owner's choices of 2026-11-04). Odysee's Premium article names neither tier's video quality, streams or
 * ads, and its Premium page is behind its sign-up (the owner's choice of 2026-11-09).
 */
export const awaitingRequiredFeatures: ReadonlyMap<string, readonly string[]> = new Map([
  ['rds.standard', ['video.quality']],
  ['tsn.standard', ['video.quality']],
  ['tsn.premium', ['video.quality']],
  ['rumble.premium', ['streaming.concurrent-streams']],
  ['discovery-plus.intrattenimento-con-pubblicita', ['video.quality']],
  ['discovery-plus.intrattenimento', ['video.quality']],
  ['discovery-plus.intrattenimento-sport', ['video.quality']],
  ['odysee.free', ['video.quality', 'streaming.concurrent-streams']],
  ['odysee.premium', ['video.quality', 'streaming.concurrent-streams']],
  ['odysee.premium-plus', ['video.quality', 'streaming.concurrent-streams']],
  ['youtube.free', ['streaming.concurrent-streams']],
  ['viki.free', ['streaming.concurrent-streams']],
  ['rumble.free', ['video.quality', 'streaming.concurrent-streams']],
  ['ici-tou-tv.free', ['streaming.concurrent-streams']],
  ['zee5.free', ['video.quality', 'streaming.concurrent-streams']],
  ['dazn.free', ['streaming.concurrent-streams']],
  ['amazon-prime-video.free', ['video.quality', 'streaming.concurrent-streams']],
  ['apple-music.radio', ['audio.quality']],
  ['paramount-plus.essential', ['video.quality']],
  // SiriusXM's app "uses variable bit rates" and no page, nor a named review, gives one (2026-11-11).
  ['siriusxm.free', ['audio.quality']],
  ['siriusxm.all-music', ['audio.quality']],
  ['siriusxm.all-access', ['audio.quality']],
  ['siriusxm.all-access-app-only', ['audio.quality']],
  ['siriusxm.sports-pass', ['audio.quality']],
  ['siriusxm.all-access-family-friendly', ['audio.quality']],
  ['siriusxm.platinum', ['audio.quality']],
  ['siriusxm.platinum-family-friendly', ['audio.quality']],
  ['siriusxm.music-entertainment', ['audio.quality']],
  ['siriusxm.music-entertainment-family-friendly', ['audio.quality']],
  ['siriusxm.music-showcase', ['audio.quality']],
  ['siriusxm.news-sports-talk', ['audio.quality']],
  ['siriusxm-canada.free', ['audio.quality']],
  ['siriusxm-canada.platinum', ['audio.quality']],
  ['siriusxm-canada.music-entertainment', ['audio.quality']],
  ['siriusxm-canada.music-showcase', ['audio.quality']],
  ['siriusxm-canada.all-access-app-only', ['audio.quality']],
  // CBC Gem states only Premium's quality and streams (2026-11-11).
  ['cbc-gem.free', ['video.quality', 'streaming.concurrent-streams']],
  // Peacock states Premium's and Premium Plus's quality, not Select's (2026-11-11).
  ['peacock.select', ['video.quality']],
  // Twitch and Kick don't say how many streams play at once (2026-11-11).
  ['twitch.free', ['streaming.concurrent-streams']],
  ['twitch.turbo', ['streaming.concurrent-streams']],
  ['kick.free', ['streaming.concurrent-streams']],
  // Nebula doesn't say how many streams play at once (2026-11-11).
  ['nebula.standard', ['streaming.concurrent-streams']],
  // Tubi states 4K only for some US live events, and no stream count (2026-11-11).
  ['tubi.free', ['video.quality', 'streaming.concurrent-streams']],
  // AMC+ states no video quality on any page read (2026-11-13).
  ['amc-plus.with-ads', ['video.quality']],
  ['amc-plus.premium', ['video.quality']],
  // Super Channel states Super Channel+'s quality but no stream count, and nothing for its channels (2026-11-13).
  ['super-channel.plus', ['streaming.concurrent-streams']],
  ['super-channel.channels', ['video.quality']],
  ['super-channel.free', ['video.quality', 'streaming.concurrent-streams']],
  // Acorn TV and Sundance Now state neither their quality nor their streams (2026-11-13).
  ['acorn-tv.standard', ['video.quality', 'streaming.concurrent-streams']],
  ['sundance-now.standard', ['video.quality', 'streaming.concurrent-streams']],
  // NBA League Pass states no stream count for its free plan or NBA TV alone (2026-11-13).
  ['nba-league-pass.free', ['streaming.concurrent-streams']],
  ['nba-league-pass.nba-tv', ['streaming.concurrent-streams']],
  // Kanopy states no stream count; Hoopla no video or audio quality (2026-11-13).
  ['kanopy.free', ['streaming.concurrent-streams']],
  ['hoopla.free', ['video.quality', 'audio.quality']],
  // Fubo Free and Sling Freestream state no stream count (2026-11-13).
  ['fubo.free', ['streaming.concurrent-streams']],
  ['sling-tv.freestream', ['streaming.concurrent-streams']],
  // MLB states no stream count on its own pages (ESPN's "3 devices" is ESPN's) (2026-11-13).
  ['mlb-tv.all-teams', ['streaming.concurrent-streams']],
  ['mlb-tv.mlb-plus', ['streaming.concurrent-streams']],
  ['mlb-tv.mlb-plus-international', ['streaming.concurrent-streams']],
  // Avast names no VPN server-country count on any page read (2026-11-13).
  ['avast.ultimate', ['vpn.server-countries']],
  ['avast.ultimate-mac', ['vpn.server-countries']],
  ['avast.ultimate-10-devices', ['vpn.server-countries']],
  ['avast.premium-vpn', ['vpn.server-countries']],
]);

/**
 * Every plan in a category states the features required there (BLUEPRINT §4.2 rule 7, M11.4), `false` and `0`
 * included, so the features buyers compare most never rest on "unlisted means no". `features` are the plan's own and
 * its provider's. A plan in `awaiting` gets a warning for the features it names.
 */
export function checkRequiredFeatures(
  plan: Plan,
  categories: readonly string[],
  features: Plan['features'],
  path: CatalogIssuePath,
  {
    registry,
    awaiting,
    report,
  }: {
    registry: FeatureRegistry;
    awaiting: ReadonlyMap<string, readonly string[]>;
    report: Report;
  },
): void {
  for (const feature of registry.features.values()) {
    const required = [...new Set(feature.requiredIn)].filter((category) =>
      categories.includes(category),
    );
    if (required.length === 0 || Object.hasOwn(features, feature.id)) {
      continue;
    }
    const value =
      feature.type === 'boolean'
        ? 'true or false'
        : feature.type === 'number'
          ? 'its number, 0 included'
          : feature.type === 'set'
            ? 'its values, [] included'
            : 'its value';
    const waiting = awaiting.get(plan.id)?.includes(feature.id) === true;
    report(
      [...path, 'features'],
      `Needs ${feature.id}, which every plan in ${required.join(' and ')} states (requiredIn): ${
        waiting
          ? 'no official page states it, or gives a reason to infer it, yet (awaitingRequiredFeatures)'
          : `give ${value}, from the provider's own pages`
      }`,
      waiting ? 'warning' : 'error',
    );
  }
}

/**
 * Two of a provider's plans at different prices, for the same region, currency and period, must differ in a feature
 * (BLUEPRINT §4.2 rule 8, M11.4): the optimizer compares only rank keys, so a tier whose extras are text has it
 * suggest the cheaper plan every time (Xbox Game Pass, Claude before M11.9). A warning, once a pair, at the dearer
 * plan, for plans and prices still sold. Unlisted means false, 0 or empty, so stating one changes nothing. Perks
 * count once M11.6 gives them ids.
 */
export function checkPriceDifferences(
  plans: readonly {
    plan: Plan;
    features: Plan['features'];
    sold: boolean;
    path: CatalogIssuePath;
  }[],
  report: Report,
): void {
  const sold = plans.filter((entry) => entry.sold);
  // A perk tells plans apart as a feature does (M11.6).
  const signature = ({ plan, features }: (typeof plans)[number]) =>
    `${featureSignature(features)} ${JSON.stringify([...(plan.perks ?? [])].sort())}`;
  sold.forEach((entry, index) => {
    for (const other of sold.slice(0, index)) {
      if (signature(entry) !== signature(other)) continue;
      const pair = differentPrice(entry.plan.prices, other.plan.prices);
      if (!pair) continue;
      const [dearer, cheaper] = pair[0].amount > pair[1].amount ? [entry, other] : [other, entry];
      const [high, low] = pair[0].amount > pair[1].amount ? pair : [pair[1], pair[0]];
      report(
        [...dearer.path, 'features'],
        `Costs more than ${cheaper.plan.id} (${high.amount} against ${low.amount} ${high.currency} ${periodText(high)} in ${high.region}) with the same features and perks: give what the price pays for a feature or a perk, or the optimizer always suggests ${cheaper.plan.id}`,
        'warning',
      );
    }
  });
}

/** A plan's features with what unlisted means left out (false, 0, []), in a fixed order, sets sorted. */
function featureSignature(features: Plan['features']): string {
  const stated = Object.entries(features)
    .filter(
      ([, value]) =>
        value !== false && value !== 0 && !(Array.isArray(value) && value.length === 0),
    )
    .map(([id, value]) => [id, Array.isArray(value) ? [...value].sort() : value] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(stated);
}

/** The first prices of the two lists still sold for the same region, currency and period, at different amounts. */
function differentPrice(a: readonly Price[], b: readonly Price[]): [Price, Price] | undefined {
  const key = (price: Price) =>
    `${price.region} ${price.currency} ${price.intervalCount} ${price.interval}`;
  const sold = (prices: readonly Price[]) => prices.filter((price) => price.retired === undefined);
  const others = new Map(sold(b).map((price) => [key(price), price]));
  for (const price of sold(a)) {
    const other = others.get(key(price));
    if (other && other.amount !== price.amount) return [price, other];
  }
  return undefined;
}

function periodText({ interval, intervalCount }: Price): string {
  return intervalCount === 1 ? `a ${interval}` : `every ${intervalCount} ${interval}s`;
}

/**
 * Reports each loop in includes-subscription (a suite that includes a plan that includes it) once, at the item
 * that closes it. Inclusion is transitive, so a loop would make every plan in it include itself.
 */
export function checkInclusionLoops(
  plans: readonly { plan: Plan; path: CatalogIssuePath; report: Report }[],
): void {
  const byId = new Map(plans.map((entry) => [entry.plan.id, entry]));
  const done = new Set<string>();
  const stack: string[] = [];
  const visit = (entry: (typeof plans)[number]): void => {
    stack.push(entry.plan.id);
    const included = entry.plan.features[includesSubscription];
    (Array.isArray(included) ? included : []).forEach((id, index) => {
      const target = byId.get(id);
      if (!target || id === entry.plan.id || done.has(id)) {
        return;
      }
      const start = stack.indexOf(id);
      if (start >= 0) {
        entry.report(
          [...entry.path, 'features', includesSubscription, index],
          `Makes a loop, ${[...stack.slice(start), id].join(' → ')}: a plan can't include a plan that includes it`,
        );
      } else {
        visit(target);
      }
    });
    stack.pop();
    done.add(entry.plan.id);
  };
  for (const entry of byId.values()) {
    if (!done.has(entry.plan.id)) {
      visit(entry);
    }
  }
}

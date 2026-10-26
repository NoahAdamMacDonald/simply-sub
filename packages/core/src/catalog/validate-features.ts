import type { Categories } from './category';
import { choices, didYouMean, idOf, listedMoreThanOnce } from './checks';
import { featureSchema, type Feature, type FeatureValue } from './feature';
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
  const indexes = new Map(valid.map(({ feature, index }) => [feature.id, index]));
  for (const { feature, index } of valid) {
    if (categoryIds && !categoryIds.includes(feature.category)) {
      report(
        [index, 'category'],
        `"${feature.category}" isn't a feature category in data/categories.yaml${choices(feature.category, categoryIds)}`,
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

/** Checks a plan's features and featureLabels against the registry. `path` is the plan's own. */
export function checkPlanFeatures(plan: Plan, path: CatalogIssuePath, context: PlanContext): void {
  const { registry, report } = context;
  for (const [featureId, value] of Object.entries(plan.features)) {
    const at = [...path, 'features', featureId];
    if (registry.unchecked.has(featureId)) {
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
    checkValue(feature, value, at, plan, context);
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
  plan: Plan,
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
            : setItemProblem(feature, item, plan, context);
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
  plan: Plan,
  { ids, providerId }: PlanContext,
): string | undefined {
  if (feature.values) {
    const valueIds = feature.values.map((option) => option.id);
    return valueIds.includes(id)
      ? undefined
      : `"${id}" isn't a ${feature.id} value${choices(id, valueIds)}`;
  }
  if (feature.id === includesSubscription && id === plan.id) {
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

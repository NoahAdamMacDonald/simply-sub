import type { Categories } from '../catalog/category';
import type { Feature } from '../catalog/feature';
import { planNames } from '../catalog/former-names';
import { planCategories } from '../catalog/plan-categories';
import { withPlanFeatures } from '../catalog/provider-features';
import type { SnapshotProvider } from '../catalog/snapshot';
import { providesKey, rankKeyOptions } from '../ranking/rank-keys';
import { normalized, searchTermForms } from './search-providers';

// What GET /providers reads in D1 since shape 4 (M11.8, BLUEPRINT §5.3): a provider's `search` column, only what
// searchProviders and its results read, so every parse is smaller (GET /providers/:id keeps the full `json`); and its
// row in provider_search, an FTS5 table (trigram, so any part of a word is found, as searchProviders finds it) of the
// names its text can match: its name and aliases, its plans' names and former names, the service categories they're in,
// and the names and aliases of the features they have and the rank keys they provide. The index only narrows: a
// provider it finds is still matched by searchProviders, and it never misses one searchProviders would match.

const providerFields: readonly string[] = [
  'id',
  'name',
  'aliases',
  'website',
  'iconUrl',
  'category',
  'billingCurrency',
  'availableIn',
  'retired',
  'endsOn',
  'features',
];
const planFields: readonly string[] = [
  'id',
  'name',
  'formerNames',
  'categories',
  'notIn',
  'features',
  'soldIn',
  'notSoldIn',
  'prices',
  'retired',
  'endsOn',
];

/** A provider as GET /providers searches it: no notes, perks, resellers, policies or facts, which only its card shows. */
export function searchProviderOf(provider: SnapshotProvider): SnapshotProvider {
  const only = (item: object, fields: readonly string[]) =>
    Object.fromEntries(Object.entries(item).filter(([key]) => fields.includes(key)));
  return {
    ...only(provider, providerFields),
    plans: provider.plans.map((plan) => only(plan, planFields)),
  } as SnapshotProvider;
}

/**
 * The names a provider's text can match, normalized, a tab between each: its provider_search row. A term never holds
 * a tab, so none is found across two names, and the seed's SQL literal needs no line breaks spliced in.
 */
export function providerSearchText(
  provider: SnapshotProvider,
  features: readonly Feature[],
  categories: Categories,
): string {
  const options = features.flatMap(rankKeyOptions);
  const names = new Set<string>([provider.name, ...(provider.aliases ?? [])]);
  const add = (...more: readonly string[]) => more.forEach((name) => names.add(name));
  for (const plan of withPlanFeatures(provider).plans) {
    add(...planNames(plan));
    for (const id of planCategories(plan, provider)) {
      add(...categories.service.filter((category) => category.id === id).map(({ name }) => name));
    }
    for (const feature of features) {
      if (plan.features[feature.id] !== undefined) add(feature.name, ...(feature.aliases ?? []));
    }
    for (const option of options) {
      if (providesKey(plan.features, option)) add(option.name, ...option.aliases);
    }
  }
  return [...names].map(normalized).join('\t');
}

/**
 * The FTS5 MATCH expression for `text`: every term, as any of its forms, a phrase found anywhere in a provider's names.
 * Undefined when a form is under three characters, which a trigram index can't find: the search reads every provider.
 */
export function providerTextQuery(
  text: string,
  context: { features: readonly Feature[]; categories: Categories },
): string | undefined {
  const terms = searchTermForms(text, context);
  if (terms.length === 0 || terms.some((forms) => forms.some((form) => [...form].length < 3))) {
    return undefined;
  }
  const phrase = (form: string) => `"${form.replaceAll('"', '""')}"`;
  return terms.map((forms) => `(${forms.map(phrase).join(' OR ')})`).join(' AND ');
}

/**
 * A digest of the registry's names a provider's search text holds: its features' and rank keys' names and aliases,
 * and its service categories' names. The seed keeps it in each provider's stored hash, so renaming one compares every
 * provider's rows again, and their provider_search rows follow (M11.8). FNV-1a, for telling versions apart only.
 */
export function searchVocabularyKey(features: readonly Feature[], categories: Categories): string {
  const names = JSON.stringify([
    features.map((feature) => [
      feature.id,
      feature.name,
      feature.aliases ?? [],
      rankKeyOptions(feature).map((option) => [option.key, option.name, option.aliases]),
    ]),
    categories.service.map((category) => [category.id, category.name]),
  ]);
  let hash = 0x811c9dc5;
  for (const character of names) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

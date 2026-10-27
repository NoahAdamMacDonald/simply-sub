import type { Category } from '../catalog/category';
import {
  providesKey,
  rankKeyOptions,
  type RankKey,
  type RankKeyOption,
} from '../ranking/rank-keys';
import { termForms } from './plurals';
import { searchCatalog, type CatalogQuery, type CatalogSearchContext } from './search-catalog';

// What Search's filter panel offers (PROJECT-PLAN P8, M5.3), from the catalog file for the user's country: the
// service categories and rank keys of what's sold there, so no choice on its own empties the results, the price
// slider's range in the user's currency, and the Features box's suggestions.

/** The price slider, in the user's currency: 0 to `top` by `step`, where the top is "Unlimited". */
export interface PriceRange {
  top: number;
  step: number;
}

export interface SearchFilterOptions {
  /** The service categories something sold in the user's country is in. */
  categories: ReadonlySet<string>;
  /** The rank keys some plan sold there provides, in registry order. */
  keys: RankKeyOption[];
  price: PriceRange;
}

/** About this many steps from 0 to the top of the price slider. */
const priceSteps = 40;

/**
 * What the panel offers for the user's country. A plan counts where it's offered or unknown, as Search shows it. The
 * slider's top is at or above every plan's lowest monthly equivalent, which the price filter compares, so a maximum
 * at the top keeps every plan.
 */
export function searchFilterOptions(
  context: Omit<CatalogSearchContext, 'items'>,
): SearchFilterOptions {
  const results = searchCatalog({}, { ...context, items: [] });
  const plans = results.flatMap((result) => (result.kind === 'priced' ? result.plans : []));
  const highest = Math.max(0, ...plans.map((plan) => plan.bestMonthlyEquivalent));
  return {
    categories: new Set(results.map((result) => result.provider.category)),
    keys: context.catalog.features
      .flatMap(rankKeyOptions)
      .filter((option) => plans.some((plan) => providesKey(plan.plan.features, option))),
    price: priceRange(highest),
  };
}

/**
 * A slider from 0 that reaches `highest`, with about 40 steps of 1, 2 or 5 times a power of ten, and a top that's a
 * multiple of five steps: CA$28.19 is 0 to 30 by 1, and ¥3,600 is 0 to 4,000 by 100.
 */
export function priceRange(highest: number): PriceRange {
  const rough = Math.max(highest, 1) / priceSteps;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((times) => times * power).find((candidate) => candidate >= rough);
  const exact = (value: number) => Number(value.toPrecision(12));
  const stepSize = exact(step ?? 10 * power);
  return {
    top: exact(Math.max(1, Math.ceil(exact(highest / (stepSize * 5)))) * stepSize * 5),
    step: stepSize,
  };
}

/** A group of the Features box's suggestions. */
export interface FeatureSuggestionGroup {
  label: string;
  keys: RankKeyOption[];
}

export interface FeatureSuggestionContext {
  /** The keys there are to suggest (searchFilterOptions' keys). */
  keys: readonly RankKeyOption[];
  /** The feature categories, which group the keys, in their order. */
  categories: readonly Category[];
  /** The keys already chosen, which aren't suggested again. */
  picked?: readonly RankKey[];
}

/**
 * The Features box's suggestions for `text` (P8): first the keys it names, by their own names and aliases or their
 * feature's ("video quality" names 480p to 4K), then the rest of those keys' feature categories ("More in
 * Streaming": Ad free, HDR …). Words match from their start ("ad" isn't "download"), ignoring case, accents and
 * punctuation, and a plural also matches its singular. With no text, every key, by feature category.
 */
export function featureSuggestions(
  text: string,
  { keys, categories, picked = [] }: FeatureSuggestionContext,
): FeatureSuggestionGroup[] {
  const open = keys.filter((option) => !picked.includes(option.key));
  const byCategory = (options: readonly RankKeyOption[], label: (name: string) => string) =>
    categories.flatMap((category): FeatureSuggestionGroup[] => {
      const inCategory = options.filter((option) => option.feature.category === category.id);
      return inCategory.length > 0 ? [{ label: label(category.name), keys: inCategory }] : [];
    });

  const typed = words(text);
  if (typed === '') {
    return byCategory(open, (name) => name);
  }
  const forms = termForms(typed);
  const names = (option: RankKeyOption) => [
    option.name,
    ...option.aliases,
    option.feature.name,
    ...(option.feature.aliases ?? []),
  ];
  const matches = open.filter((option) =>
    names(option).some((name) => {
      const spaced = ` ${words(name)}`;
      return forms.some((form) => spaced.includes(` ${form}`));
    }),
  );
  if (matches.length === 0) {
    return [];
  }
  const matched = new Set(matches.map((option) => option.feature.category));
  const related = open.filter(
    (option) => matched.has(option.feature.category) && !matches.includes(option),
  );
  return [{ label: 'Matches', keys: matches }, ...byCategory(related, (name) => `More in ${name}`)];
}

/** How many filters the query sets, as the Filters button counts them: each feature, and one for each other filter. */
export function filterCount(query: CatalogQuery): number {
  return (
    (query.features?.length ?? 0) +
    [
      query.minPrice !== undefined || query.maxPrice !== undefined,
      query.category !== undefined,
      (query.activity?.length ?? 0) > 0,
      query.nativeOnly === true,
    ].filter(Boolean).length
  );
}

/** Lower case words without accents or punctuation: "4K (Ultra HD)" is "4k ultra hd", "Ad-free" is "ad free". */
function words(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

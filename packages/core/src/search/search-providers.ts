import { availability, type Availability } from '../catalog/availability';
import type { Categories } from '../catalog/category';
import type { FxRates } from '../catalog/convert';
import type { Feature } from '../catalog/feature';
import { pickPrice, type PickedPrice } from '../catalog/pick-price';
import type { Plan } from '../catalog/provider';
import type { SnapshotProvider } from '../catalog/snapshot';
import { addDays, type IsoDate } from '../dates/iso-date';
import {
  providesKey,
  rankKeyOptions,
  type RankKey,
  type RankKeyOption,
} from '../ranking/rank-keys';
import type { ProviderSort, ProvidersQuery } from './providers-query';

// Searching the catalog's providers (PROJECT-PLAN P8): GET /providers runs it on the providers D1 narrows down to
// (M2.3), and the app's Search page through searchCatalog (M5.1).
//
// Text is matched term by term, and every term must match: "netflix 4k" is Netflix's 4k plans. A term is the longest
// run of words that a name in the registry contains ("ultra hd", "video quality"), or else one word. Terms match
// provider names and aliases, plan names, service category names, rank keys by their names and aliases (a boolean
// feature's own; an enum value's, tier's or set value's otherwise: "4K (Ultra HD)" and uhd are video.quality=4k), and
// the other features by their own ("video quality", "streams"). Matching ignores case, accents and extra spaces, and a
// term whose last word looks plural also matches its singular (vpns, boxes, categories). Relevance, best first: a
// provider name that starts with a term, one that contains it, an alias, a plan name, then a feature or category.

/** A price is out of date once it was last checked more than this many days ago (BLUEPRINT §6.4). */
export const staleAfterDays = 90;

/** What searchProviders reads of a query: GET /providers' limit only pages its results. */
export type ProviderSearch = Omit<ProvidersQuery, 'limit'>;

export interface SearchContext {
  features: readonly Feature[];
  categories: Categories;
  /** Exchange rates in the query's currency, for picking prices. */
  fx?: FxRates;
  today: IsoDate;
}

/** A plan that matches every filter. */
export interface PlanMatch {
  plan: Plan;
  /**
   * The rank keys it matched on that it provides: the feature filter's, then the text's. A feature the text names
   * by its own name counts with the highest key the plan provides of it (every value of a set).
   */
  matchedKeys: RankKey[];
  /** With a region: the picked prices, at full precision. */
  pricing?: PickedPrice[];
  /** With a region: the lowest monthly equivalent of the picked prices (of the interval asked for, if any). */
  bestMonthlyEquivalent?: number;
  /** With a region: whether it's sold there. An unknown one shows its fallback price, "No price for <country> yet". */
  availability?: Exclude<Availability, 'not-offered'>;
  /** The oldest lastVerified of the prices shown: the picked ones, or all of them without a region. */
  lastVerified: IsoDate;
  stale: boolean;
}

export interface ProviderMatch {
  provider: SnapshotProvider;
  /** Its matching plans, cheapest first with a region, else in file order. The first is the one to show. */
  plans: [PlanMatch, ...PlanMatch[]];
  /** Why it's in the results: name, plan:<id>, alias:<alias>, category:<id> and feature:<rank key>. */
  matchedOn: string[];
  /** With text: 1 (its name starts with a term) to 5 (only features or categories matched). */
  relevance?: number;
}

/** The providers with at least one plan that matches every filter, in the query's sort order. */
export function searchProviders(
  providers: readonly SnapshotProvider[],
  query: ProviderSearch,
  context: SearchContext,
): ProviderMatch[] {
  const options = context.features.flatMap(rankKeyOptions);
  const required = (query.feature ?? []).flatMap(
    (key) => options.find((option) => option.key === key) ?? [],
  );
  const terms = query.q === undefined ? [] : textTerms(query.q, options, context);

  const matches = providers.flatMap((provider): ProviderMatch[] => {
    if (query.category !== undefined && provider.category !== query.category) {
      return [];
    }
    const found = terms.length === 0 ? undefined : textMatch(provider, terms);
    if (terms.length > 0 && !found) {
      return [];
    }
    const plans = (found?.plans ?? provider.plans).flatMap(
      (plan) => planMatch(plan, provider, query, context, required, terms, options) ?? [],
    );
    if (query.region !== undefined) {
      // Stable, so plans that cost the same keep their file order.
      plans.sort((a, b) => (a.bestMonthlyEquivalent ?? 0) - (b.bestMonthlyEquivalent ?? 0));
    }
    const [first, ...rest] = plans;
    if (!first) {
      return [];
    }
    // The filter's keys, then the text's in registry order.
    const keys = new Set([
      ...required.map((option) => option.key),
      ...options
        .filter((option) => plans.some((plan) => plan.matchedKeys.includes(option.key)))
        .map((option) => option.key),
    ]);
    const category = query.category !== undefined || found?.category === true;
    return [
      {
        provider,
        plans: [first, ...rest],
        matchedOn: [
          ...(found?.matchedOn ?? []),
          ...(category ? [`category:${provider.category}`] : []),
          ...[...keys].map((key) => `feature:${key}`),
        ],
        ...(found && { relevance: found.relevance }),
      },
    ];
  });
  return matches.sort(providerOrder(query.sort, context.features, (match) => match.plans[0]));
}

/**
 * The order of `sort` for results that show the plan `shown` picks: price sorts compare its lowest monthly
 * equivalent, and Most features the rank keys it provides. Names break every tie, then ids. A result with no plan to
 * show, or no price, comes after the priced ones.
 */
export function providerOrder<T extends { provider: SnapshotProvider; relevance?: number }>(
  sort: ProviderSort,
  features: readonly Feature[],
  shown: (result: T) => PlanMatch | undefined,
): (a: T, b: T) => number {
  const options = features.flatMap(rankKeyOptions);
  const price = (result: T) => shown(result)?.bestMonthlyEquivalent;
  const priced = (a: T, b: T, order: (x: number, y: number) => number) => {
    const [x, y] = [price(a), price(b)];
    return x === y ? 0 : x === undefined ? 1 : y === undefined ? -1 : order(x, y);
  };
  const cheaper = (a: T, b: T) => priced(a, b, (x, y) => x - y);
  const keyCount = (result: T) => {
    const plan = shown(result)?.plan;
    return plan ? options.filter((option) => providesKey(plan.features, option)).length : 0;
  };
  const byName = (a: T, b: T) =>
    compare(normalized(a.provider.name), normalized(b.provider.name)) ||
    compare(a.provider.id, b.provider.id);
  switch (sort) {
    case 'relevance':
      return (a, b) => (a.relevance ?? 0) - (b.relevance ?? 0) || cheaper(a, b) || byName(a, b);
    case 'price_asc':
      return (a, b) => cheaper(a, b) || byName(a, b);
    case 'price_desc':
      return (a, b) => priced(a, b, (x, y) => y - x) || byName(a, b);
    case 'name':
      return byName;
    case 'features':
      return (a, b) => keyCount(b) - keyCount(a) || cheaper(a, b) || byName(a, b);
  }
}

/** One term of the text, a word or a run of words, with what it names in the registry. */
interface TextTerm {
  /** The term, normalized, and its singular when its last word looks plural. */
  forms: string[];
  /** The rank keys it names by their own names or aliases. */
  keys: RankKeyOption[];
  /**
   * When it names no rank key: the other features it names by their own names or aliases (not booleans, which are
   * keys), as their keys.
   */
  features: RankKeyOption[][];
  /** The service categories it names. */
  categories: string[];
}

/** The most words a term can have: more than any name in the registry, and it bounds the work. */
const maxTermWords = 6;

/**
 * The text's terms, left to right: the longest run of words that a rank key's, feature's or service category's name
 * or alias contains, or else one word. The registry alone decides, so a provider is matched the same whichever others
 * are searched with it. A repeated term counts once.
 */
function textTerms(
  text: string,
  options: readonly RankKeyOption[],
  { features, categories }: SearchContext,
): TextTerm[] {
  const keyNames = options.map((option) => ({
    option,
    names: [option.name, ...option.aliases].map(normalized),
  }));
  const featureNames = features.flatMap((feature) => {
    const keys = options.filter((option) => option.feature === feature);
    return feature.type === 'boolean' || keys.length === 0
      ? []
      : [{ keys, names: [feature.name, ...(feature.aliases ?? [])].map(normalized) }];
  });
  const categoryNames = categories.service.map((category) => ({
    id: category.id,
    names: [normalized(category.name)],
  }));
  const vocabulary = [...keyNames, ...featureNames, ...categoryNames].flatMap(({ names }) => names);

  const words = normalized(text).split(' ').filter(Boolean);
  const terms = new Map<string, TextTerm>();
  for (let start = 0; start < words.length;) {
    let end = Math.min(words.length, start + maxTermWords);
    while (
      end > start + 1 &&
      !vocabulary.some((name) => contains(name, termForms(words.slice(start, end).join(' '))))
    ) {
      end -= 1;
    }
    const term = words.slice(start, end).join(' ');
    start = end;
    if (terms.has(term)) {
      continue;
    }
    const forms = termForms(term);
    const named = ({ names }: { names: string[] }) => names.some((name) => contains(name, forms));
    const keys = keyNames.filter(named).map(({ option }) => option);
    terms.set(term, {
      forms,
      keys,
      // Only when it names no key: every feature in the VPN group is named "VPN …", and "vpn" means vpn.included.
      features: keys.length > 0 ? [] : featureNames.filter(named).map((feature) => feature.keys),
      categories: categoryNames.filter(named).map(({ id }) => id),
    });
  }
  return [...terms.values()];
}

/**
 * A term, and its singular when its last word has four letters or more and looks plural: vpns → vpn, boxes → box,
 * categories → category. Words in -ss, -us and -is aren't plurals (pass, plus, analysis).
 */
function termForms(term: string): string[] {
  const word = term.slice(term.lastIndexOf(' ') + 1);
  if (word.length < 4 || !word.endsWith('s') || /(?:ss|us|is)$/.test(word)) {
    return [term];
  }
  return [
    term,
    term.slice(0, -1),
    ...(/(?:[sxz]|[cs]h)es$/.test(word) ? [term.slice(0, -2)] : []),
    ...(word.endsWith('ies') ? [`${term.slice(0, -3)}y`] : []),
  ];
}

interface TextMatch {
  /** The plans the text points at, before the filters. */
  plans: readonly Plan[];
  matchedOn: string[];
  category: boolean;
  relevance: number;
}

/**
 * How `provider` matches the text, or undefined when a term doesn't match it. Each term picks plans: a service
 * category it names brings every plan; otherwise the rank keys and features it names bring the plans that provide
 * one, when any does, with the plans it names; otherwise a name or alias brings every plan, and plan names those
 * plans. The match is the plans every term picks. Plan names are a reason only for a term the provider's name and
 * aliases don't match, and the relevance is the best any term reaches.
 */
function textMatch(provider: SnapshotProvider, terms: readonly TextTerm[]): TextMatch | undefined {
  let plans: readonly Plan[] = provider.plans;
  let name = false;
  let category = false;
  let relevance = 5;
  const aliases = new Set<string>();
  const planReasons = new Set<Plan>();
  for (const term of terms) {
    const nameHit = nameMatch(provider.name, term.forms);
    const aliasHits = (provider.aliases ?? []).filter((alias) =>
      contains(normalized(alias), term.forms),
    );
    const named = nameHit !== undefined || aliasHits.length > 0;
    const planNames = provider.plans.filter((plan) => contains(normalized(plan.name), term.forms));
    const inCategory = term.categories.includes(provider.category);
    const providing = provider.plans.filter((plan) => termKeys(plan.features, term).length > 0);
    const picked = inCategory
      ? provider.plans
      : providing.length > 0
        ? provider.plans.filter((plan) => providing.includes(plan) || planNames.includes(plan))
        : named
          ? provider.plans
          : planNames;
    if (picked.length === 0) {
      return undefined;
    }
    plans = plans.filter((plan) => picked.includes(plan));
    name ||= nameHit !== undefined;
    category ||= inCategory;
    aliasHits.forEach((alias) => aliases.add(alias));
    if (!named) {
      planNames.forEach((plan) => planReasons.add(plan));
    }
    relevance = Math.min(
      relevance,
      nameHit === 'start'
        ? 1
        : nameHit === 'inside'
          ? 2
          : aliasHits.length > 0
            ? 3
            : planNames.length > 0
              ? 4
              : 5,
    );
  }
  if (plans.length === 0) {
    return undefined;
  }
  return {
    plans,
    matchedOn: [
      ...(name ? ['name'] : []),
      ...[...aliases].map((alias) => `alias:${alias}`),
      ...plans.filter((plan) => planReasons.has(plan)).map((plan) => `plan:${plan.id}`),
    ],
    category,
    relevance,
  };
}

/**
 * The keys a plan provides of what `term` names: each rank key it names, and of each feature it names, the highest
 * value or tier the plan provides, or every value of a set.
 */
function termKeys(features: Plan['features'], term: TextTerm): RankKeyOption[] {
  return [
    ...term.keys.filter((option) => providesKey(features, option)),
    ...term.features.flatMap((keys) => {
      const provided = keys.filter((option) => providesKey(features, option));
      const { feature } = keys[0];
      if (provided.length === 0 || feature.type === 'set') {
        return provided;
      }
      if (feature.type === 'number') {
        const min = (option: RankKeyOption) =>
          feature.tiers?.find((tier) => tier.id === option.option)?.min ?? 0;
        return [provided.reduce((top, option) => (min(option) > min(top) ? option : top))];
      }
      // Enum values are listed low to high.
      return provided.slice(-1);
    }),
  ];
}

/** `plan` as a match when it passes every filter, else undefined. */
function planMatch(
  plan: Plan,
  provider: SnapshotProvider,
  query: ProviderSearch,
  { fx, today }: SearchContext,
  required: readonly RankKeyOption[],
  terms: readonly TextTerm[],
  options: readonly RankKeyOption[],
): PlanMatch | undefined {
  if (!required.every((option) => providesKey(plan.features, option))) {
    return undefined;
  }
  const { region, currency, interval } = query;
  let shown = plan.prices;
  let priced: Pick<PlanMatch, 'pricing' | 'bestMonthlyEquivalent' | 'availability'> = {};
  if (region !== undefined && currency !== undefined) {
    const sold = availability(plan.prices, provider, region);
    if (sold === 'not-offered') {
      return undefined;
    }
    const pricing = pickPrice(plan.prices, {
      region,
      currency,
      billingCurrency: provider.billingCurrency,
      fx,
    });
    const counted = pricing.filter(
      (price) => interval === undefined || price.interval === interval,
    );
    if (counted.length === 0 || (query.nativeOnly && !pricing.every((price) => price.native))) {
      return undefined;
    }
    const best = Math.min(...counted.map((price) => price.monthlyEquivalent));
    // Compared as shown, to the cent.
    const rounded = Math.round(best * 100) / 100;
    if (
      (query.minPrice !== undefined && rounded < query.minPrice) ||
      (query.maxPrice !== undefined && rounded > query.maxPrice)
    ) {
      return undefined;
    }
    const [{ source }] = counted;
    shown = plan.prices.filter(
      (price) => price.region === source.region && price.currency === source.currency,
    );
    priced = { pricing, bestMonthlyEquivalent: best, availability: sold };
  } else if (interval !== undefined && !plan.prices.some((price) => price.interval === interval)) {
    return undefined;
  }
  const lastVerified = shown.map((price) => price.lastVerified).sort()[0];
  const textKeys = new Set(terms.flatMap((term) => termKeys(plan.features, term)));
  return {
    plan,
    matchedKeys: [
      ...required,
      ...options.filter((option) => textKeys.has(option) && !required.includes(option)),
    ].map((option) => option.key),
    ...priced,
    lastVerified,
    stale: addDays(lastVerified, staleAfterDays) < today,
  };
}

/** Whether `name` starts with or contains one of `forms`. Starting with it includes being it. */
function nameMatch(name: string, forms: readonly string[]): 'start' | 'inside' | undefined {
  const value = normalized(name);
  return forms.some((form) => value.startsWith(form))
    ? 'start'
    : contains(value, forms)
      ? 'inside'
      : undefined;
}

/** Whether a normalized name contains one of `forms`. */
function contains(name: string, forms: readonly string[]): boolean {
  return forms.some((form) => name.includes(form));
}

/** Lower case, without accents, with single spaces: "Crème  Brûlée" → "creme brulee". */
function normalized(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

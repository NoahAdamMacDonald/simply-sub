import { availability } from '../catalog/availability';
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
import type { ProvidersQuery } from './providers-query';

// Searching the catalog's providers (PROJECT-PLAN P8): GET /providers runs it on the providers D1 narrows down to
// (M2.3), and the app's Search page will run it on its snapshot (M5.1).
//
// Text matches provider names and aliases, plan names, service category names, and the names and aliases of rank
// keys (a boolean feature's own; an enum value's, tier's or set value's otherwise: "4K (Ultra HD)" and uhd are
// video.quality=4k). Relevance, best first: a provider name that starts with the text, one that contains it, an
// alias, a plan name, then a feature or category. Matching ignores case, accents and extra spaces.

/** A price is out of date once it was last checked more than this many days ago (BLUEPRINT §6.4). */
export const staleAfterDays = 90;

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
  /** The rank keys it matched on that it provides: the feature filter's, then the text's. */
  matchedKeys: RankKey[];
  /** With a region: the picked prices, at full precision. */
  pricing?: PickedPrice[];
  /** With a region: the lowest monthly equivalent of the picked prices (of the interval asked for, if any). */
  bestMonthlyEquivalent?: number;
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
  /** With text: 1 (its name starts with it) to 5 (only a feature or category matched). */
  relevance?: number;
}

/** The providers with at least one plan that matches every filter, in the query's sort order. */
export function searchProviders(
  providers: readonly SnapshotProvider[],
  query: ProvidersQuery,
  context: SearchContext,
): ProviderMatch[] {
  const options = context.features.flatMap(rankKeyOptions);
  const required = (query.feature ?? []).flatMap(
    (key) => options.find((option) => option.key === key) ?? [],
  );
  const text = query.q === undefined ? undefined : normalized(query.q);
  const textKeys =
    text === undefined
      ? []
      : options.filter((option) =>
          [option.name, ...option.aliases].some((name) => normalized(name).includes(text)),
        );
  const textCategories =
    text === undefined
      ? []
      : context.categories.service
          .filter((category) => normalized(category.name).includes(text))
          .map((category) => category.id);

  const matches = providers.flatMap((provider): ProviderMatch[] => {
    if (query.category !== undefined && provider.category !== query.category) {
      return [];
    }
    const found =
      text === undefined ? undefined : textMatch(provider, text, textCategories, textKeys);
    if (text !== undefined && !found) {
      return [];
    }
    const plans = (found?.plans ?? provider.plans).flatMap(
      (plan) => planMatch(plan, provider, query, context, required, textKeys) ?? [],
    );
    if (query.region !== undefined) {
      // Stable, so plans that cost the same keep their file order.
      plans.sort((a, b) => (a.bestMonthlyEquivalent ?? 0) - (b.bestMonthlyEquivalent ?? 0));
    }
    const [first, ...rest] = plans;
    if (!first) {
      return [];
    }
    const keys = [...required, ...textKeys].filter(
      (option) =>
        required.includes(option) || plans.some((plan) => plan.matchedKeys.includes(option.key)),
    );
    const category = query.category !== undefined || found?.category === true;
    return [
      {
        provider,
        plans: [first, ...rest],
        matchedOn: [
          ...(found?.matchedOn ?? []),
          ...(category ? [`category:${provider.category}`] : []),
          ...new Set(keys.map((option) => `feature:${option.key}`)),
        ],
        ...(found && { relevance: found.relevance }),
      },
    ];
  });
  return matches.sort(comparison(query, options));
}

interface TextMatch {
  /** The plans the text points at, before the filters. */
  plans: readonly Plan[];
  matchedOn: string[];
  category: boolean;
  relevance: number;
}

/**
 * How `provider` matches the text, or undefined when it doesn't. When the text names rank keys, only the plans that
 * provide one count. Otherwise a provider matched by name, alias or category brings every plan, and one matched
 * only through plan names brings those plans. Plan names are a reason only when the provider's name and aliases
 * aren't.
 */
function textMatch(
  provider: SnapshotProvider,
  text: string,
  textCategories: readonly string[],
  textKeys: readonly RankKeyOption[],
): TextMatch | undefined {
  const name = nameMatch(provider.name, text);
  const aliases = (provider.aliases ?? []).filter((alias) => normalized(alias).includes(text));
  const named = name !== undefined || aliases.length > 0;
  const planNames = named ? [] : provider.plans.filter((plan) => nameMatch(plan.name, text));
  const category = textCategories.includes(provider.category);
  const plans =
    textKeys.length > 0
      ? provider.plans.filter((plan) =>
          textKeys.some((option) => providesKey(plan.features, option)),
        )
      : named || category
        ? provider.plans
        : planNames;
  if (plans.length === 0) {
    return undefined;
  }
  return {
    plans,
    matchedOn: [
      ...(name ? ['name'] : []),
      ...aliases.map((alias) => `alias:${alias}`),
      ...planNames.map((plan) => `plan:${plan.id}`),
    ],
    category,
    relevance:
      name === 'start'
        ? 1
        : name === 'inside'
          ? 2
          : aliases.length > 0
            ? 3
            : planNames.length > 0
              ? 4
              : 5,
  };
}

/** `plan` as a match when it passes every filter, else undefined. */
function planMatch(
  plan: Plan,
  provider: SnapshotProvider,
  query: ProvidersQuery,
  { fx, today }: SearchContext,
  required: readonly RankKeyOption[],
  textKeys: readonly RankKeyOption[],
): PlanMatch | undefined {
  if (!required.every((option) => providesKey(plan.features, option))) {
    return undefined;
  }
  const { region, currency, interval } = query;
  let shown = plan.prices;
  let priced: Pick<PlanMatch, 'pricing' | 'bestMonthlyEquivalent'> = {};
  if (region !== undefined && currency !== undefined) {
    if (availability(plan.prices, provider, region) === 'not-offered') {
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
    priced = { pricing, bestMonthlyEquivalent: best };
  } else if (interval !== undefined && !plan.prices.some((price) => price.interval === interval)) {
    return undefined;
  }
  const lastVerified = shown.map((price) => price.lastVerified).sort()[0];
  const keys = [...required, ...textKeys.filter((option) => !required.includes(option))];
  return {
    plan,
    matchedKeys: keys
      .filter((option) => providesKey(plan.features, option))
      .map((option) => option.key),
    ...priced,
    lastVerified,
    stale: addDays(lastVerified, staleAfterDays) < today,
  };
}

/** The order of `query.sort`: names break every tie, then ids. */
function comparison(
  query: ProvidersQuery,
  options: readonly RankKeyOption[],
): (a: ProviderMatch, b: ProviderMatch) => number {
  const price = (match: ProviderMatch) => match.plans[0].bestMonthlyEquivalent ?? 0;
  const cheaper = (a: ProviderMatch, b: ProviderMatch) => price(a) - price(b);
  const keyCount = (match: ProviderMatch) =>
    options.filter((option) => providesKey(match.plans[0].plan.features, option)).length;
  const byName = (a: ProviderMatch, b: ProviderMatch) =>
    compare(normalized(a.provider.name), normalized(b.provider.name)) ||
    compare(a.provider.id, b.provider.id);
  switch (query.sort) {
    case 'relevance':
      return (a, b) => (a.relevance ?? 0) - (b.relevance ?? 0) || cheaper(a, b) || byName(a, b);
    case 'price_asc':
      return (a, b) => cheaper(a, b) || byName(a, b);
    case 'price_desc':
      return (a, b) => cheaper(b, a) || byName(a, b);
    case 'name':
      return byName;
    case 'features':
      return (a, b) => keyCount(b) - keyCount(a) || cheaper(a, b) || byName(a, b);
  }
}

/** Whether `name` starts with or contains the (normalized) text. Starting with it includes being it. */
function nameMatch(name: string, text: string): 'start' | 'inside' | undefined {
  const value = normalized(name);
  return value.startsWith(text) ? 'start' : value.includes(text) ? 'inside' : undefined;
}

/** Lower case, without accents, with single spaces: "Crème  Brûlée" → "creme brulee". */
function normalized(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

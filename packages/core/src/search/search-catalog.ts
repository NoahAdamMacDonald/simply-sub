import { providerAvailability, type Availability } from '../catalog/availability';
import type { FxRates } from '../catalog/convert';
import type { PickedPrice } from '../catalog/pick-price';
import { resellerDeals, type DealContext, type ResellerDeal } from '../catalog/reseller-deals';
import type { CatalogData, SnapshotProvider } from '../catalog/snapshot';
import type { IsoDate } from '../dates/iso-date';
import { planRankCounts, rankScore } from '../ranking/rank-fit';
import type { RankKey } from '../ranking/rank-keys';
import type { ProfileRanks } from '../ranking/resolve-rank';
import type { ListItem } from '../user/list-item';
import type { RankCounts } from '../user/rank';
import type { Settings } from '../user/settings';
import { providerActivity, type ProviderActivity } from './provider-activity';
import { providerSorts } from './providers-query';
import {
  providerOrder,
  searchProviders,
  type PlanMatch,
  type ProviderSearch,
  type SearchContext,
} from './search-providers';

// The Search page's results (PROJECT-PLAN P8, M5.1), worked out on the device: searchProviders' matching, filters and
// sorts on the catalog file for the user's country, plus what the page shows that GET /providers doesn't. Each
// provider is one card, showing the user's own plan when it matches; each plan has the resellers that sell it for
// less; each provider has its place in the user's lists; and a provider the text names that isn't sold in the user's
// country still gets a card, which says so. Add-ons, bundles and a suite's savings are the expanded card's, worked out
// for the plan it shows (M5.2).

/**
 * Search's sorts: GET /providers' (relevance, price, name, features), and "Best for my ranks" (`ranks`), which only the
 * app has, since it takes the user's ranks (the feedback after M6.9).
 */
export const catalogSorts = [...providerSorts, 'ranks'] as const;
export type CatalogSort = (typeof catalogSorts)[number];

/** Search's text, filters and sort (P8), as its URL keeps them (M5.3). */
export interface CatalogQuery {
  q?: string;
  /** Best match by default with text, else cheapest first. */
  sort?: CatalogSort;
  /** A service category id. */
  category?: string;
  /** Rank keys a plan must all provide. */
  features?: readonly RankKey[];
  /** The monthly equivalent's range, in the user's currency before tax. No maximum is "Unlimited". */
  minPrice?: number;
  maxPrice?: number;
  /** Providers by their place in the user's lists. None, or an empty list, keeps every provider. */
  activity?: readonly ActivityFilter[];
  /** Only prices that weren't converted. */
  nativeOnly?: boolean;
  /**
   * Only what's sold in the user's country (M5.6): plans priced there, so none with only a fallback price ("No
   * price for Canada yet"), and no card for a provider that isn't sold there.
   */
  soldOnly?: boolean;
  /**
   * The plan its provider's card shows, when it's among the card's plans (M5.11): List view's View in Search names the
   * item's plan, so a user with two of a provider's plans sees the one they came from. Not a filter.
   */
  plan?: string;
}

/** P8's Activity filter: Active, Inactive or Not listed (PROJECT-PLAN §3.3). */
export type ActivityFilter = ProviderActivity['kind'] | 'not-listed';

export interface CatalogSearchContext {
  /** The catalog file for Settings' country (CatalogStore.catalogFor). */
  catalog: CatalogData;
  /** Where the user is (the region prices are picked for), their currency and their sales tax. */
  settings: Pick<Settings, 'country' | 'subdivision' | 'currency' | 'salesTaxPercent'>;
  /** Exchange rates in the user's currency. Without them, converted prices stay in their own currency. */
  fx?: FxRates;
  /** Every list's items. */
  items: readonly ListItem[];
  today: IsoDate;
  /** The user's ranks: each plan's rank counts, and the "Best for my ranks" sort. None counts nothing. */
  profileRanks?: ProfileRanks;
}

/** A plan that matches, priced for the user. */
export interface CatalogPlan extends PlanMatch {
  pricing: PickedPrice[];
  bestMonthlyEquivalent: number;
  availability: Exclude<Availability, 'not-offered'>;
  /** The official resellers that sell it for less per month after the user's sales tax, cheapest first (§4.9). */
  deals: ResellerDeal[];
  /** How many of the keys it provides the user ranks each way (planRankCounts): a card's "2 Needed · 1 Wanted". */
  rankCounts: RankCounts;
}

interface ResultBase {
  provider: SnapshotProvider;
  /** Why it's in the results, as in GET /providers: name, alias:, plan:, category: and feature:. */
  matchedOn: string[];
  /** With text: 1 (its name starts with a term) to 5 (only features or categories matched). */
  relevance?: number;
  /** Its place in the user's lists, when it's in one; else it's Not listed. */
  activity?: ProviderActivity;
}

/** A provider with plans that match: a card with a chip per plan. */
export interface PricedResult extends ResultBase {
  kind: 'priced';
  /** Cheapest first, by their shortest billing period's price per month (searchProviders). */
  plans: [CatalogPlan, ...CatalogPlan[]];
  /**
   * The plan the card shows: the query's plan, else the user's own when it matches (an active one first), else the
   * first.
   */
  shownPlanId: string;
}

/** A provider the text names that isn't sold in the user's country: "Not offered in Canada", with no prices. */
export interface NotOfferedResult extends ResultBase {
  kind: 'not-offered';
}

export type CatalogResult = PricedResult | NotOfferedResult;

/** The relevance of a provider named by the text, by its name or an alias, rather than by a plan or a feature. */
const namedRelevance = 3;

/**
 * Search's results, in the query's order. Plans aren't shown where availability says they aren't sold. A provider
 * that sells nothing in the user's country gets a not-offered card only when the text names it, and passes the
 * category, feature and activity filters; a price filter, Native pricing only or Sold in leaves it out, since it has no
 * price. Sold in also leaves out the plans with only a fallback price, and a provider with no other plan. Price sorts
 * compare the shown plan's lowest monthly equivalent, and put not-offered cards last. "Best for my ranks" shows the
 * user's own plan, else each provider's best fit (rankScore; the cheaper of two that fit as well), and puts the best
 * fits first, then the cheaper, with not-offered cards last.
 */
export function searchCatalog(query: CatalogQuery, context: CatalogSearchContext): CatalogResult[] {
  const { catalog, settings, fx, items, today, profileRanks = new Map() } = context;
  const q = query.q?.trim() || undefined;
  const sort = query.sort ?? (q !== undefined ? 'relevance' : 'price_asc');
  // searchProviders sorts the API's way; the ranks sort orders the results below.
  const providerSort = sort === 'ranks' ? 'price_asc' : sort;
  const { country: region, currency } = settings;
  const filters: Omit<ProviderSearch, 'sort'> = {
    ...(q !== undefined && { q }),
    ...(query.category !== undefined && { category: query.category }),
    ...(query.features && query.features.length > 0 && { feature: [...query.features] }),
  };
  const searching: SearchContext = {
    features: catalog.features,
    categories: catalog.categories,
    ...(fx && { fx }),
    today,
  };
  const activity = providerActivity(items, catalog.bundles, today);
  const providers = catalog.providers.filter(
    (provider) =>
      !query.activity?.length ||
      query.activity.includes(activity.get(provider.id)?.kind ?? 'not-listed'),
  );
  const listed = (provider: SnapshotProvider) => {
    const found = activity.get(provider.id);
    return found && { activity: found };
  };

  const buyer: DealContext = {
    region,
    currency,
    ...(fx && { fx }),
    taxPlace: {
      country: settings.country,
      ...(settings.subdivision !== undefined && { subdivision: settings.subdivision }),
      ...(settings.salesTaxPercent !== undefined && { salesTaxPercent: settings.salesTaxPercent }),
    },
  };
  const priced = searchProviders(
    providers,
    {
      ...filters,
      ...(query.minPrice !== undefined && { minPrice: query.minPrice }),
      ...(query.maxPrice !== undefined && { maxPrice: query.maxPrice }),
      region,
      currency,
      ...(query.nativeOnly && { nativeOnly: true }),
      sort: providerSort,
    },
    searching,
  ).flatMap(({ provider, plans, matchedOn, relevance }): PricedResult[] => {
    const sold = query.soldOnly ? plans.filter((match) => match.availability === 'offered') : plans;
    const [first, ...rest] = sold.map((match) =>
      catalogPlan(
        match,
        resellerDeals(provider, match.plan.id, catalog.resellers, buyer),
        planRankCounts(match.plan.features, catalog.features, profileRanks),
      ),
    );
    if (!first) {
      return [];
    }
    const chips: PricedResult['plans'] = [first, ...rest];
    const own = activity.get(provider.id)?.plans ?? [];
    const owned = (kind?: ProviderActivity['kind']) =>
      chips.find((plan) =>
        own.some((mine) => mine.planId === plan.plan.id && (!kind || mine.kind === kind)),
      );
    // The best fit for the user's ranks, the cheaper of two that fit as well (chips come cheapest first).
    const bestFit = () =>
      chips.reduce((best, plan) =>
        rankScore(plan.rankCounts) > rankScore(best.rankCounts) ? plan : best,
      );
    return [
      {
        kind: 'priced',
        provider,
        plans: chips,
        shownPlanId: (
          chips.find((plan) => plan.plan.id === query.plan) ??
          owned('active') ??
          owned() ??
          (sort === 'ranks' ? bestFit() : first)
        ).plan.id,
        matchedOn,
        ...(relevance !== undefined && { relevance }),
        ...listed(provider),
      },
    ];
  });

  const unpriced =
    q === undefined ||
    query.minPrice !== undefined ||
    query.maxPrice !== undefined ||
    query.nativeOnly === true ||
    query.soldOnly === true;
  const notOffered = unpriced
    ? []
    : searchProviders(
        providers.filter((provider) => providerAvailability(provider, region) === 'not-offered'),
        { ...filters, sort: providerSort },
        searching,
      ).flatMap(({ provider, matchedOn, relevance }): NotOfferedResult[] =>
        relevance !== undefined && relevance <= namedRelevance
          ? [{ kind: 'not-offered', provider, matchedOn, relevance, ...listed(provider) }]
          : [],
      );

  const shown = (result: CatalogResult) =>
    result.kind === 'priced'
      ? result.plans.find((plan) => plan.plan.id === result.shownPlanId)
      : undefined;
  const order = providerOrder(providerSort, catalog.features, shown);
  if (sort !== 'ranks') return [...priced, ...notOffered].sort(order);
  const score = (result: CatalogResult) => {
    const plan = shown(result);
    return plan ? rankScore(plan.rankCounts) : -Infinity;
  };
  return [...priced, ...notOffered].sort(
    (a, b) => (score(a) === score(b) ? 0 : score(b) - score(a)) || order(a, b),
  );
}

/** A match from searchProviders with a region, which prices every plan, as a plan to show. */
function catalogPlan(match: PlanMatch, deals: ResellerDeal[], rankCounts: RankCounts): CatalogPlan {
  const { pricing, bestMonthlyEquivalent, availability } = match;
  if (!pricing || bestMonthlyEquivalent === undefined || !availability) {
    throw new Error(`${match.plan.id} has no price: searchProviders prices plans for a region`);
  }
  return { ...match, pricing, bestMonthlyEquivalent, availability, deals, rankCounts };
}

import type { PickedPrice } from '../catalog/pick-price';
import type { IsoDate } from '../dates/iso-date';
import { providersCursor, type ProvidersQuery } from './providers-query';
import type { ProviderMatch } from './search-providers';

// The GET /providers body (docs/api-output-examples.json): one page of searchProviders' matches, rounded the way the
// API writes money, with the meta that describes it.

/** A picked price as the API writes it: amounts to 2 decimals and the rate to 4, from the unrounded values. */
export function apiPickedPrice(picked: PickedPrice): PickedPrice {
  return {
    ...picked,
    amount: round(picked.amount, 2),
    monthlyEquivalent: round(picked.monthlyEquivalent, 2),
    ...(picked.fx && { fx: { ...picked.fx, rate: round(picked.fx.rate, 4) } }),
  };
}

/** One result: the provider in short, its matching plans with their prices, and why it matched. */
export function providerResult({ provider, plans, matchedOn }: ProviderMatch) {
  const { id, name, category, website, iconUrl } = provider;
  return {
    provider: { id, name, category, website, ...(iconUrl !== undefined && { iconUrl }) },
    matchedPlans: plans.map((match) => ({
      id: match.plan.id,
      name: match.plan.name,
      matchedKeys: match.matchedKeys,
      ...(match.pricing && { pricing: match.pricing.map(apiPickedPrice) }),
      ...(match.bestMonthlyEquivalent !== undefined && {
        bestMonthlyEquivalent: round(match.bestMonthlyEquivalent, 2),
      }),
      lastVerified: match.lastVerified,
      stale: match.stale,
    })),
    bestPlanId: plans[0].plan.id,
    matchedOn,
  };
}
export type ProviderResult = ReturnType<typeof providerResult>;

export interface ProvidersBodyOptions {
  query: ProvidersQuery;
  /** Where the page starts, from the request's cursor. */
  offset: number;
  catalogVersion: string;
  /** The date of the exchange rates the prices were picked with, when there's a region. */
  fxDate?: IsoDate;
}

/** The page of `matches` that starts at `offset`, and meta: the query as read, the total and the next cursor. */
export function providersBody(
  matches: readonly ProviderMatch[],
  { query, offset, catalogVersion, fxDate }: ProvidersBodyOptions,
) {
  const end = offset + query.limit;
  return {
    data: matches.slice(offset, end).map(providerResult),
    meta: {
      catalogVersion,
      query,
      total: matches.length,
      nextCursor: end < matches.length ? providersCursor(end) : null,
      ...(fxDate !== undefined && { fxDate }),
    },
  };
}

function round(value: number, decimals: number): number {
  return Math.round(value * 10 ** decimals) / 10 ** decimals;
}

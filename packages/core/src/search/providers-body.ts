import * as z from 'zod';
import {
  httpsUrlSchema,
  isoDateSchema,
  planIdSchema,
  rankKeySchema,
  slugSchema,
  textSchema,
} from '../catalog/formats';
import { pickedPriceSchema, type PickedPrice } from '../catalog/pick-price';
import { catalogMetaSchema } from '../catalog/snapshot';
import type { IsoDate } from '../dates/iso-date';
import { providersCursor, providersQuerySchema, type ProvidersQuery } from './providers-query';
import type { ProviderMatch } from './search-providers';

// The GET /providers body (docs/api-output-examples.json): one page of searchProviders' matches, rounded the way the
// API writes money, with the meta that describes it. The schemas are the contract's (M2.7): the builders' types
// come from them, and the contract tests hold the examples and the route to them.

/** One search result: the provider in short, its matching plans with their prices, and why it matched. */
export const providerResultSchema = z.strictObject({
  provider: z.strictObject({
    id: slugSchema,
    name: textSchema,
    category: slugSchema,
    website: httpsUrlSchema,
    iconUrl: httpsUrlSchema.optional(),
  }),
  matchedPlans: z
    .array(
      z.strictObject({
        id: planIdSchema,
        name: textSchema,
        matchedKeys: z.array(rankKeySchema),
        pricing: z.array(pickedPriceSchema).optional(),
        bestMonthlyEquivalent: z.number().nonnegative().optional(),
        lastVerified: isoDateSchema,
        stale: z.boolean(),
      }),
    )
    .min(1),
  bestPlanId: planIdSchema,
  matchedOn: z.array(
    z
      .string()
      .regex(
        /^(?:name|(?:alias|plan|category|feature):.+)$/,
        'Use name, alias:, plan:, category: or feature:',
      ),
  ),
});
export type ProviderResult = z.infer<typeof providerResultSchema>;

export const providersBodySchema = z.strictObject({
  data: z.array(providerResultSchema),
  meta: z.strictObject({
    catalogVersion: catalogMetaSchema.shape.catalogVersion,
    query: providersQuerySchema,
    total: z.int().nonnegative(),
    nextCursor: z.string().min(1).nullable(),
    fxDate: isoDateSchema.optional(),
  }),
});
export type ProvidersBody = z.infer<typeof providersBodySchema>;

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
export function providerResult({ provider, plans, matchedOn }: ProviderMatch): ProviderResult {
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
): ProvidersBody {
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

import { z } from 'zod';
import { availability, type Availability } from '../catalog/availability';
import { bundleSchema, type Bundle } from '../catalog/bundle';
import {
  bundleFeatures,
  bundleSavings,
  bundleSavingSchema,
  type BundleSaving,
} from '../catalog/bundle-deal';
import type { FxRates } from '../catalog/convert';
import type { Feature } from '../catalog/feature';
import {
  bundleIdSchema,
  currencySchema,
  httpsUrlSchema,
  isoDateSchema,
  planIdSchema,
  rankKeySchema,
  regionSchema,
  slugSchema,
  textSchema,
} from '../catalog/formats';
import { pickedPriceSchema, pickPrice, type PickedPrice } from '../catalog/pick-price';
import { intervalSchema, type Price } from '../catalog/price';
import { addOnSchema, planSchema, type Plan } from '../catalog/provider';
import {
  catalogMetaSchema,
  snapshotProviderSchema,
  type SnapshotProvider,
} from '../catalog/snapshot';
import { providedKeys } from '../ranking/rank-keys';
import { apiPickedPrice } from '../search/providers-body';
import type { PricingQuery } from './lookup-query';

// The bodies of GET /providers/:id, GET /plans/:id and GET /bundles (docs/api-output-examples.json). Each record
// keeps its JSON as written, key order included, with only what the contract adds: picked pricing after the stored
// prices, a plan's add-ons and provider summary, the rank keys it provides and the bundles that include it, and a
// bundle's expanded plans, savings and feature union.
//
// With a region, every plan, add-on and bundle that availability doesn't call not-offered there gets its picked
// prices, rounded the way the API writes money: an unknown one gets pickPrice's fallback price. GET /bundles leaves
// a not-offered bundle out, as GET /providers does a plan; the detail routes keep every plan and add-on.
//
// The schemas are the contract's (M2.7): the builders' types come from them, and the contract tests hold the
// examples and the routes to them. They're strict, so a field added to plans or bundles must be added here too.

export interface LookupContext {
  /** The query as read: with a region, prices are picked there, in its currency. */
  query: PricingQuery;
  /** Exchange rates in the query's currency. */
  fx?: FxRates;
  catalogVersion: string;
}

export const lookupMetaSchema = z.strictObject({
  catalogVersion: catalogMetaSchema.shape.catalogVersion,
  region: regionSchema.optional(),
  currency: currencySchema.optional(),
  fxDate: isoDateSchema
    .describe('The date of the exchange rates the prices were picked with, when there is a region')
    .optional(),
});
export type LookupMeta = z.infer<typeof lookupMetaSchema>;

/** A plan, add-on or bundle, with its picked prices after its stored ones when it has a region's. */
export type Priced<T> = T & { pricing?: PickedPrice[] };

const pricingSchema = z.array(pickedPriceSchema);
export const pricedPlanSchema = planSchema.safeExtend({ pricing: pricingSchema.optional() });
export const pricedAddOnSchema = addOnSchema.extend({ pricing: pricingSchema.optional() });

export const providerBodySchema = z.strictObject({
  data: snapshotProviderSchema.safeExtend({
    plans: z.array(pricedPlanSchema).min(1),
    addOns: z.array(pricedAddOnSchema).min(1).optional(),
  }),
  meta: lookupMetaSchema,
});
export type ProviderBody = z.infer<typeof providerBodySchema>;
export type ProviderDetail = ProviderBody['data'];

/** GET /providers/:id: the provider as written, with picked prices on each plan and add-on. */
export function providerBody(provider: SnapshotProvider, context: LookupContext): ProviderBody {
  return {
    data: {
      // Replacing keys the provider has keeps their place.
      ...provider,
      plans: provider.plans.map((plan) => priced(plan, provider, context)),
      ...(provider.addOns && {
        addOns: provider.addOns.map((addOn) => priced(addOn, provider, context)),
      }),
    },
    meta: lookupMeta(context),
  };
}

const providerShape = snapshotProviderSchema.shape;

/** What GET /plans/:id shows of the plan's provider. */
export const providerSummarySchema = z.strictObject({
  id: providerShape.id,
  name: providerShape.name,
  website: providerShape.website,
  iconUrl: providerShape.iconUrl,
  category: providerShape.category,
  spendCategory: providerShape.spendCategory,
  acceptedNetworks: providerShape.acceptedNetworks,
  cancelUrl: providerShape.cancelUrl,
});
export type ProviderSummary = z.infer<typeof providerSummarySchema>;

const summaryKeys = Object.keys(providerSummarySchema.shape);

/** The provider's summary fields, in its own key order. */
function providerSummary(provider: SnapshotProvider): ProviderSummary {
  return rebuilt(provider, (key, value) =>
    summaryKeys.includes(key) ? [[key, value]] : [],
  ) as ProviderSummary;
}

const planShape = planSchema.shape;

export const planBodySchema = z.strictObject({
  data: z.strictObject({
    id: planShape.id,
    name: planShape.name,
    provider: providerSummarySchema,
    link: planShape.link,
    features: planShape.features,
    providedRankKeys: z
      .array(rankKeySchema)
      .min(1)
      .describe('Every rank key the plan provides, in registry order')
      .optional(),
    featureLabels: planShape.featureLabels,
    perks: planShape.perks,
    notes: planShape.notes,
    prices: planShape.prices,
    pricing: pricingSchema.optional(),
    addOns: z
      .array(pricedAddOnSchema)
      .min(1)
      .describe('The add-ons addOnIds names, in its order and in its place')
      .optional(),
    addOnLimit: planShape.addOnLimit,
    bundleIds: z
      .array(bundleIdSchema)
      .min(1)
      .describe('The bundles that include the plan, in any region')
      .optional(),
  }),
  meta: lookupMetaSchema,
});
export type PlanBody = z.infer<typeof planBodySchema>;
export type PlanDetail = PlanBody['data'];

export interface PlanContext extends LookupContext {
  registry: readonly Feature[];
  /** The bundles that include the plan, in any region. */
  bundleIds: readonly string[];
}

/**
 * GET /plans/:id: the plan as written, with its provider in short after its name, the rank keys it provides (in
 * registry order) after its features, its add-ons in place of their ids, and the bundles that include it last.
 * Lists that would be empty are left out.
 */
export function planBody(
  provider: SnapshotProvider,
  plan: Plan,
  { registry, bundleIds, ...context }: PlanContext,
): PlanBody {
  const keys = providedKeys(plan.features, registry);
  const addOns = (plan.addOnIds ?? [])
    .flatMap((id) => provider.addOns?.find((addOn) => addOn.id === id) ?? [])
    .map((addOn) => priced(addOn, provider, context));
  const pricing = picking(plan.prices, provider, context).picked?.map(apiPickedPrice);
  const data = rebuilt(plan, (key, value) => {
    switch (key) {
      case 'name':
        return [
          [key, value],
          ['provider', providerSummary(provider)],
        ];
      case 'features':
        return [[key, value], ...(keys.length > 0 ? [['providedRankKeys', keys] as const] : [])];
      case 'prices':
        return [[key, value], ...(pricing ? [['pricing', pricing] as const] : [])];
      case 'addOnIds':
        return addOns.length > 0 ? [['addOns', addOns]] : [];
      default:
        return [[key, value]];
    }
  });
  return {
    data: { ...data, ...(bundleIds.length > 0 && { bundleIds: [...bundleIds] }) } as PlanDetail,
    meta: lookupMeta(context),
  };
}

/** One of a bundle's plans, in short, with its own price on the bundle's first interval. */
export const bundlePlanSchema = z.strictObject({
  planId: planIdSchema,
  providerId: slugSchema,
  providerName: textSchema,
  planName: textSchema,
  iconUrl: httpsUrlSchema.optional(),
  standalone: z
    .strictObject({
      amount: z.number().nonnegative(),
      currency: currencySchema,
      interval: intervalSchema,
      intervalCount: z.int().positive(),
    })
    .optional(),
});
export type BundlePlan = z.infer<typeof bundlePlanSchema>;

export const bundleResultSchema = z.strictObject({
  ...bundleSchema.shape,
  includes: z.array(bundlePlanSchema).min(2),
  pricing: pricingSchema.optional(),
  savings: z.array(bundleSavingSchema).min(1).optional(),
  features: planShape.features.describe("The union of its plans' features (bundleFeatures)"),
});
export type BundleResult = z.infer<typeof bundleResultSchema>;

export const bundlesBodySchema = z.strictObject({
  data: z.array(bundleResultSchema),
  meta: lookupMetaSchema.extend({ total: z.int().nonnegative() }),
});
export type BundlesBody = z.infer<typeof bundlesBodySchema>;

export interface BundlesContext extends LookupContext {
  registry: readonly Feature[];
}

/**
 * GET /bundles: each bundle as written, sorted by id, with its plans expanded in place, its savings (bundleSavings)
 * after its picked prices, and the union of its plans' features last. Without a region there are no prices, no
 * standalone prices and no savings; with one, a bundle not offered there is left out. `providers` has every
 * provider the bundles sell or include.
 */
export function bundlesBody(
  bundles: readonly Bundle[],
  providers: readonly SnapshotProvider[],
  { registry, ...context }: BundlesContext,
): BundlesBody {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const providerOf = (id: string) => {
    const provider = byId.get(id);
    if (!provider) {
      throw new Error(`Provider ${id} is missing: GET /bundles reads every one a bundle needs`);
    }
    return provider;
  };
  const data = [...bundles]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .flatMap((bundle): BundleResult[] => {
      const seller = providerOf(bundle.soldBy);
      const sold = picking(bundle.prices, seller, context);
      if (sold.availability === 'not-offered') {
        return [];
      }
      const parts = bundle.includes.map((planId) => {
        const provider = providerOf(planId.slice(0, planId.indexOf('.')));
        const plan = provider.plans.find((candidate) => candidate.id === planId);
        if (!plan) {
          throw new Error(`Plan ${planId} is missing from provider ${provider.id}`);
        }
        return { provider, plan, ...picking(plan.prices, provider, context) };
      });
      const savings = sold.picked
        ? bundleSavings(
            { pricing: sold.picked, offered: sold.availability === 'offered' },
            parts.map((part) => ({
              pricing: part.picked ?? [],
              offered: part.availability === 'offered',
            })),
          )
        : [];
      const first = sold.picked?.[0];
      const includes = parts.map(({ provider, plan, picked }): BundlePlan => {
        const standalone =
          first &&
          picked?.find(
            (price) =>
              price.interval === first.interval && price.intervalCount === first.intervalCount,
          );
        return {
          planId: plan.id,
          providerId: provider.id,
          providerName: provider.name,
          planName: plan.name,
          ...(provider.iconUrl !== undefined && { iconUrl: provider.iconUrl }),
          ...(standalone && {
            standalone: {
              amount: round(standalone.amount, 2),
              currency: standalone.currency,
              interval: standalone.interval,
              intervalCount: standalone.intervalCount,
            },
          }),
        };
      });
      const result = rebuilt(bundle, (key, value) => {
        switch (key) {
          case 'includes':
            return [[key, includes]];
          case 'prices':
            return [
              [key, value],
              ...(sold.picked ? [['pricing', sold.picked.map(apiPickedPrice)] as const] : []),
              ...(savings.length > 0 ? [['savings', savings.map(apiSaving)] as const] : []),
            ];
          default:
            return [[key, value]];
        }
      });
      const features = bundleFeatures(
        parts.map(({ plan }) => plan),
        registry,
      );
      return [{ ...result, features } as BundleResult];
    });
  const { region, currency } = context.query;
  return {
    data,
    meta: {
      catalogVersion: context.catalogVersion,
      ...(region !== undefined && { region, currency }),
      total: data.length,
      ...(region !== undefined && context.fx && { fxDate: context.fx.date }),
    },
  };
}

/** A saving as the API writes it: amounts to 2 decimals and the percentage to 1, from the unrounded values. */
function apiSaving(saving: BundleSaving): BundleSaving {
  return {
    ...saving,
    standaloneTotal: round(saving.standaloneTotal, 2),
    bundlePrice: round(saving.bundlePrice, 2),
    amount: round(saving.amount, 2),
    percent: round(saving.percent, 1),
  };
}

function lookupMeta({ query, fx, catalogVersion }: LookupContext): LookupMeta {
  const { region, currency } = query;
  return {
    catalogVersion,
    ...(region !== undefined && { region, currency }),
    ...(region !== undefined && fx && { fxDate: fx.date }),
  };
}

/** `item` with its picked prices, as the API writes them, right after its stored prices. */
function priced<T extends { prices: Price[] }>(
  item: T,
  provider: SnapshotProvider,
  context: LookupContext,
): Priced<T> {
  const pricing = picking(item.prices, provider, context).picked?.map(apiPickedPrice);
  return pricing
    ? (rebuilt(item, (key, value) =>
        key === 'prices'
          ? [
              [key, value],
              ['pricing', pricing],
            ]
          : [[key, value]],
      ) as Priced<T>)
    : item;
}

/**
 * Whether an item `provider` sells is offered in the query's region, and its picked prices there at full precision.
 * Nothing without a region, and no prices when it isn't offered there.
 */
function picking(
  prices: readonly Price[],
  provider: SnapshotProvider,
  { query, fx }: LookupContext,
): { availability?: Availability; picked?: PickedPrice[] } {
  const { region, currency } = query;
  if (region === undefined || currency === undefined) {
    return {};
  }
  const available = availability(prices, provider, region);
  return {
    availability: available,
    ...(available !== 'not-offered' && {
      picked: pickPrice(prices, {
        region,
        currency,
        billingCurrency: provider.billingCurrency,
        fx,
      }),
    }),
  };
}

/** `record` with each entry, in order, replaced by the entries `entries` gives for it. */
function rebuilt(
  record: object,
  entries: (key: string, value: unknown) => (readonly [string, unknown])[],
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).flatMap(([key, value]) => entries(key, value)));
}

function round(value: number, decimals: number): number {
  return Math.round(value * 10 ** decimals) / 10 ** decimals;
}

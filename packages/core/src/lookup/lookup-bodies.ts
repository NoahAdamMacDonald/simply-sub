import { availability, type Availability } from '../catalog/availability';
import type { Bundle } from '../catalog/bundle';
import { bundleFeatures, bundleSavings, type BundleSaving } from '../catalog/bundle-deal';
import type { FxRates } from '../catalog/convert';
import type { Feature } from '../catalog/feature';
import { pickPrice, type PickedPrice } from '../catalog/pick-price';
import type { Interval, Price } from '../catalog/price';
import type { AddOn, Plan } from '../catalog/provider';
import type { SnapshotProvider } from '../catalog/snapshot';
import type { IsoDate } from '../dates/iso-date';
import { providedKeys, type RankKey } from '../ranking/rank-keys';
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

export interface LookupContext {
  /** The query as read: with a region, prices are picked there, in its currency. */
  query: PricingQuery;
  /** Exchange rates in the query's currency. */
  fx?: FxRates;
  catalogVersion: string;
}

export interface LookupMeta {
  catalogVersion: string;
  region?: string;
  currency?: string;
  /** The date of the exchange rates the prices were picked with, when there's a region. */
  fxDate?: IsoDate;
}

/** A plan, add-on or bundle, with its picked prices after its stored ones when it has a region's. */
export type Priced<T> = T & { pricing?: PickedPrice[] };

export type ProviderDetail = Omit<SnapshotProvider, 'plans' | 'addOns'> & {
  plans: Priced<Plan>[];
  addOns?: Priced<AddOn>[];
};

/** GET /providers/:id: the provider as written, with picked prices on each plan and add-on. */
export function providerBody(
  provider: SnapshotProvider,
  context: LookupContext,
): { data: ProviderDetail; meta: LookupMeta } {
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

/** What GET /plans/:id shows of the plan's provider. */
export type ProviderSummary = Pick<
  SnapshotProvider,
  | 'id'
  | 'name'
  | 'website'
  | 'iconUrl'
  | 'category'
  | 'spendCategory'
  | 'acceptedNetworks'
  | 'cancelUrl'
>;

const summaryKeys = [
  'id',
  'name',
  'website',
  'iconUrl',
  'category',
  'spendCategory',
  'acceptedNetworks',
  'cancelUrl',
];

/** The provider's summary fields, in its own key order. */
function providerSummary(provider: SnapshotProvider): ProviderSummary {
  return rebuilt(provider, (key, value) =>
    summaryKeys.includes(key) ? [[key, value]] : [],
  ) as ProviderSummary;
}

export type PlanDetail = Omit<Priced<Plan>, 'addOnIds'> & {
  provider: ProviderSummary;
  providedRankKeys?: RankKey[];
  /** The add-ons addOnIds names, in its order, in its place. */
  addOns?: Priced<AddOn>[];
  bundleIds?: string[];
};

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
): { data: PlanDetail; meta: LookupMeta } {
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
export interface BundlePlan {
  planId: string;
  providerId: string;
  providerName: string;
  planName: string;
  iconUrl?: string;
  standalone?: { amount: number; currency: string; interval: Interval; intervalCount: number };
}

export type BundleResult = Omit<Priced<Bundle>, 'includes'> & {
  includes: BundlePlan[];
  savings?: BundleSaving[];
  features: Plan['features'];
};

export interface BundlesContext extends LookupContext {
  registry: readonly Feature[];
}

export interface BundlesMeta {
  catalogVersion: string;
  region?: string;
  currency?: string;
  total: number;
  fxDate?: IsoDate;
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
): { data: BundleResult[]; meta: BundlesMeta } {
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

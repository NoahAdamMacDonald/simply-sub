import { bundleFeatures } from '../catalog/bundle-deal';
import { acceptedNetworksIn } from '../catalog/card-networks';
import { isoDateSchema } from '../catalog/formats';
import type { FxRates } from '../catalog/convert';
import { pickPrice, typedPrice, type PickedPrice, type PriceContext } from '../catalog/pick-price';
import { planCategories } from '../catalog/plan-categories';
import type { Price } from '../catalog/price';
import type { CardNetwork, Plan } from '../catalog/provider';
import { catalogIconFile, type CatalogData, type SnapshotProvider } from '../catalog/snapshot';
import type { IsoDate } from '../dates/iso-date';
import { providedKeys, type RankKey } from '../ranking/rank-keys';
import { effectiveRanks, type ProfileRanks } from '../ranking/resolve-rank';
import { nextCharge, type Charge } from '../schedule/charges';
import { itemStatus } from '../schedule/item-status';
import type { TaxPlace } from '../tax/sales-tax-rate';
import { customIconUrl } from './custom-sub-form';
import type { CustomSubscription } from './custom-subscription';
import type { ListItem } from './list-item';
import type { Rank } from './rank';

// The view models pages show (PROJECT-PLAN §3.4). resolveItem joins a list item to the catalog or its custom
// subscription, prices it for the user and lists what it provides (M4.6), with each key's rank for the item (M6.1),
// its status and its next charge (M7.1). ListMetrics adds up a list's (schedule/list-metrics.ts).

/** Whether an item is active today (PROJECT-PLAN §3.3). */
export interface ItemStatus {
  kind: 'active' | 'inactive';
  /** When an inactive item starts again: a future window or start date. */
  activeFrom?: IsoDate;
  /** Its end date, when that's within the next 30 days. */
  endsOn?: IsoDate;
  /** Its next charge is a manual renewal. */
  manual: boolean;
}

/** One line of a feature summary, "VPN 2 / 3" (PROJECT-PLAN §3.2). */
export interface FeatureSummaryRow {
  key: RankKey;
  label: string;
  /** The active items that provide the key. */
  active: number;
  /** All the items that provide it. */
  total: number;
}

/** An add-on of a catalog item, priced. */
export interface ResolvedAddOn {
  id: string;
  name: string;
  quantity: number;
  /**
   * One add-on's price: for the item's billing period when it's sold that way, else its shortest one (Disney+ sells
   * extra members monthly only, even on a yearly plan).
   */
  price: PickedPrice;
  /** The day it joined, when after the item began (M8.5): its charges before then don't include it. */
  since?: IsoDate;
}

/** A list item joined to what it is, priced for the user. */
export interface ResolvedItem {
  item: ListItem;
  listId: string;
  providerId?: string;
  planId?: string;
  bundleId?: string;
  customSubId?: string;
  /** The provider's, bundle's or custom subscription's name: "Netflix". */
  name: string;
  /** The plan's name: "Standard". A bundle's is its plans': "Netflix Standard + Crave Premium". */
  planName: string;
  /**
   * Catalog: the relative icons/<id>.webp when the provider has a logo (the snapshot's absolute URL points at
   * production, so a preview would miss a new logo). Custom: api/v1/icon?domain= from its link. None: a letter.
   */
  iconUrl?: string;
  /**
   * Where to sign up, and where to cancel: a catalog plan's link and its provider's cancel page; a bundle's link and
   * its own cancel page, else its seller's; a custom subscription's, when it has them.
   */
  link?: string;
  cancelUrl?: string;
  /** The region it's priced for: where the item was bought, else the user's country. */
  region: string;
  /** The plan's, bundle's or custom plan's price for the item's billing period. */
  price: PickedPrice;
  addOns: ResolvedAddOn[];
  /** The price override, with the item's billing period, while it applies (dates before its `until`). */
  override?: PickedPrice;
  /**
   * The price override as a price for the item's billing period, whatever the date: charges dated before its `until`
   * cost it (§3.1). `override` is the same while it applies today.
   */
  overridePrice?: PickedPrice;
  /**
   * What the item costs per month today, in the user's currency: the override while it applies, else the price
   * plus each add-on's × its quantity. Before sales tax, like the price tags, except an override or custom price
   * typed with tax included.
   */
  monthlyEquivalent: number;
  /** What it gives: the plan's features, a bundle's plans' together, or the custom plan's. */
  features: Plan['features'];
  /**
   * Its service categories (data/categories.yaml): a catalog plan's (planCategories), a bundle's plans' together, and
   * none for a custom plan.
   */
  categories: string[];
  providedKeys: RankKey[];
  /** Each provided key's rank for this item, in providedKeys' order: its override, else the profile's (M6.1). */
  effectiveRanks: Record<RankKey, Rank>;
  /** Active or Inactive today, ending soon, and whether its next charge is a manual renewal (M7.1, §3.3). */
  status: ItemStatus;
  /** Its first charge on or after today, sales tax included; none when it has none to come (M7.1). */
  nextCharge?: Charge;
  /**
   * The card networks the seller (a catalog plan's provider, a bundle's soldBy) takes where it's bought (BLUEPRINT
   * §9.3, M9.3). Left out when they aren't known there, and for a custom subscription: every card is then allowed.
   */
  acceptedNetworks?: readonly CardNetwork[];
}

/**
 * Why an item can't be resolved:
 * - `pending`: what it needs hasn't loaded yet (the catalog file for its region, or the custom subscriptions).
 * - `plan-gone`, `bundle-gone`, `custom-gone`, `add-on-gone`: it's no longer in the catalog, or the custom
 *   subscription or its plan was deleted.
 * - `no-price`: the plan or bundle has no price for the item's billing period where it's bought.
 */
export type UnresolvedReason =
  'pending' | 'plan-gone' | 'bundle-gone' | 'custom-gone' | 'add-on-gone' | 'no-price';

/** An item that can't be resolved. Pages say why, and totals leave it out (M7.1). */
export interface UnresolvedItem {
  item: ListItem;
  listId: string;
  reason: UnresolvedReason;
}

export type ItemResolution =
  { ok: true; resolved: ResolvedItem } | { ok: false; unresolved: UnresolvedItem };

export interface ResolveContext {
  /** The catalog file that serves the item's region; undefined until it's downloaded. */
  catalog: CatalogData | undefined;
  /** The user's custom subscriptions by id; undefined until they've loaded. */
  customSubs: ReadonlyMap<string, CustomSubscription> | undefined;
  /** Settings' country and currency. */
  country: string;
  currency: string;
  fx?: FxRates;
  today: IsoDate;
  /** The profile's ranks, under the items' overrides. */
  profileRanks: ProfileRanks;
  /** Where the user pays sales tax, for the next charge: Settings' country, province and rate. Left out, no tax. */
  taxPlace?: TaxPlace;
}

/**
 * Joins `item` to its catalog plan, bundle or custom plan and prices it for the user (BLUEPRINT §4.7): pickPrice in
 * the item's region, converted into the user's currency with `fx`. An item that can't be resolved says why. Nothing
 * here decides whether the plan is still sold in the region: an item the user has is priced wherever it can be.
 */
export function resolveItem(item: ListItem, context: ResolveContext): ItemResolution {
  const { catalog } = context;
  const region = item.region ?? context.country;
  const unresolved = (reason: UnresolvedReason): ItemResolution => ({
    ok: false,
    unresolved: { item, listId: item.listId, reason },
  });
  // Even a custom plan needs the catalog's feature registry, for the keys it provides.
  if (!catalog) return unresolved('pending');
  const { source } = item;
  let parts: Omit<
    ResolvedItem,
    | 'item'
    | 'listId'
    | 'region'
    | 'override'
    | 'overridePrice'
    | 'monthlyEquivalent'
    | 'providedKeys'
    | 'effectiveRanks'
    | 'status'
    | 'nextCharge'
  >;
  switch (source.kind) {
    case 'catalog': {
      const provider = catalog.providers.find((candidate) =>
        candidate.plans.some((plan) => plan.id === source.planId),
      );
      const plan = provider?.plans.find((candidate) => candidate.id === source.planId);
      if (!provider || !plan) return unresolved('plan-gone');
      const pricing = priceContext(context, region, provider);
      const price = forPeriod(plan.prices, item, pricing);
      if (!price) return unresolved('no-price');
      const addOns: ResolvedAddOn[] = [];
      for (const { id, quantity, since } of source.addOns ?? []) {
        const addOn = provider.addOns?.find((candidate) => candidate.id === id);
        if (!addOn) return unresolved('add-on-gone');
        const picked = pickPrice(addOn.prices, pricing);
        const addOnPrice = picked.find((candidate) => samePeriod(candidate, item)) ?? picked[0];
        if (!addOnPrice) return unresolved('no-price');
        addOns.push({
          id,
          name: addOn.name,
          quantity,
          price: addOnPrice,
          ...(since !== undefined && { since }),
        });
      }
      const networks = acceptedNetworksIn(provider, region);
      parts = {
        providerId: provider.id,
        planId: plan.id,
        name: provider.name,
        planName: plan.name,
        ...providerLinks(provider, plan),
        price,
        addOns,
        features: plan.features,
        categories: [...planCategories(plan, provider)],
        ...(networks && { acceptedNetworks: networks }),
      };
      break;
    }
    case 'bundle': {
      const bundle = catalog.bundles.find((candidate) => candidate.id === source.bundleId);
      const seller = catalog.providers.find((candidate) => candidate.id === bundle?.soldBy);
      if (!bundle || !seller) return unresolved('bundle-gone');
      const price = forPeriod(bundle.prices, item, priceContext(context, region, seller));
      if (!price) return unresolved('no-price');
      const plans = bundle.includes.flatMap((planId) => {
        const provider = catalog.providers.find((candidate) =>
          candidate.plans.some((plan) => plan.id === planId),
        );
        const plan = provider?.plans.find((candidate) => candidate.id === planId);
        return provider && plan ? [{ provider, plan }] : [];
      });
      const networks = acceptedNetworksIn(seller, region);
      parts = {
        providerId: seller.id,
        bundleId: bundle.id,
        name: bundle.name,
        planName: plans.map(({ provider, plan }) => `${provider.name} ${plan.name}`).join(' + '),
        ...(seller.iconUrl && { iconUrl: `icons/${catalogIconFile(seller.id)}` }),
        link: bundle.link,
        cancelUrl: bundle.cancelUrl ?? seller.cancelUrl,
        price,
        addOns: [],
        features: bundleFeatures(
          plans.map(({ plan }) => plan),
          catalog.features,
        ),
        categories: [
          ...new Set(plans.flatMap(({ provider, plan }) => planCategories(plan, provider))),
        ],
        ...(networks && { acceptedNetworks: networks }),
      };
      break;
    }
    case 'custom': {
      if (!context.customSubs) return unresolved('pending');
      const sub = context.customSubs.get(source.customSubId);
      const plan = sub?.plans.find((candidate) => candidate.id === source.customPlanId);
      if (!sub || !plan) return unresolved('custom-gone');
      const iconUrl = customIconUrl(sub.link);
      parts = {
        customSubId: sub.id,
        name: sub.name,
        planName: plan.name,
        ...(iconUrl !== undefined && { iconUrl }),
        ...(sub.link && { link: sub.link }),
        ...(sub.cancelUrl && { cancelUrl: sub.cancelUrl }),
        // A custom plan has one price, with its own period, which the item dialog bills it by (P6).
        price: typedPrice(plan.price, plan.autoRenewAvailable, priceContext(context, region)),
        addOns: [],
        features: plan.features,
        categories: [],
      };
      break;
    }
  }
  const overridePrice = typedOverride(item, parts.price, priceContext(context, region));
  const { until } = item.priceOverride ?? {};
  const override = until === undefined || context.today < until ? overridePrice : undefined;
  const keys = providedKeys(parts.features, catalog.features);
  const charged = {
    item,
    listId: item.listId,
    price: parts.price,
    addOns: parts.addOns,
    overridePrice,
  };
  // The item dialog resolves its form's item while a date is still being typed: that has no charges, and no status.
  const dated = hasDates(item.billing);
  const next = dated
    ? nextCharge(charged, context.today, context.taxPlace ?? { country: context.country })
    : undefined;
  return {
    ok: true,
    resolved: {
      item,
      listId: item.listId,
      ...parts,
      region,
      ...(override && { override }),
      ...(overridePrice && { overridePrice }),
      monthlyEquivalent:
        override?.monthlyEquivalent ??
        parts.addOns.reduce(
          (total, addOn) => total + addOn.price.monthlyEquivalent * addOn.quantity,
          parts.price.monthlyEquivalent,
        ),
      providedKeys: keys,
      effectiveRanks: effectiveRanks(keys, item.rankOverrides, context.profileRanks),
      status: dated ? itemStatus(item, context.today, next) : { kind: 'inactive', manual: false },
      ...(next && { nextCharge: next }),
    },
  };
}

/**
 * Whether every date of `billing` is one: a stored item's always are (its schema checks them), the item dialog's form
 * while a date is typed may not be.
 */
function hasDates(billing: ListItem['billing']): boolean {
  const dates =
    billing.mode === 'recurring'
      ? [billing.anchorDate, billing.startDate, billing.endDate].filter(
          (date) => date !== undefined,
        )
      : billing.windows.flatMap(({ start, end }) => [start, end]);
  return dates.every((date) => isoDateSchema.safeParse(date).success);
}

function priceContext(
  { currency, fx }: ResolveContext,
  region: string,
  provider?: SnapshotProvider,
): PriceContext {
  return {
    region,
    currency,
    ...(provider?.billingCurrency && { billingCurrency: provider.billingCurrency }),
    ...(fx && { fx }),
  };
}

/** The picked price for the item's billing period, if there's one. */
function forPeriod(
  prices: readonly Price[],
  item: ListItem,
  context: PriceContext,
): PickedPrice | undefined {
  return pickPrice(prices, context).find((price) => samePeriod(price, item));
}

function samePeriod(price: PickedPrice, { billing }: ListItem): boolean {
  return price.interval === billing.interval && price.intervalCount === billing.intervalCount;
}

function providerLinks(
  provider: SnapshotProvider,
  plan: Plan,
): Pick<ResolvedItem, 'iconUrl' | 'link' | 'cancelUrl'> {
  return {
    ...(provider.iconUrl && { iconUrl: `icons/${catalogIconFile(provider.id)}` }),
    link: plan.link,
    cancelUrl: provider.cancelUrl,
  };
}

/** The item's price override as a price for its billing period, whatever the date. */
function typedOverride(
  { priceOverride, billing }: ListItem,
  price: PickedPrice,
  context: PriceContext,
): PickedPrice | undefined {
  if (!priceOverride) return undefined;
  return typedPrice(
    {
      amount: priceOverride.amount,
      currency: priceOverride.currency,
      interval: billing.interval,
      intervalCount: billing.intervalCount,
      ...(priceOverride.plusTax && { plusTax: true }),
    },
    price.autoRenew,
    context,
  );
}

import { addedSalesTax, taxAddedRegions, type TaxPlace } from '../tax/sales-tax-rate';
import { pickPrice, type PickedPrice, type PriceContext } from './pick-price';
import { globalRegion, groupsOf } from './regions';
import type { ResellerPrice } from './reseller';
import type { SnapshotProvider, SnapshotReseller } from './snapshot';

// Which resellers sell a plan for less than its provider (BLUEPRINT §4.9). Search shows them by the plan's prices
// ("Cheaper at Amazon.ca", M5.2). Costs are compared per month and with the buyer's sales tax, since that's what
// leaves the account: Amazon.ca adds HST to a Mullvad voucher and Mullvad's own price includes tax, so Amazon is
// cheaper in Alberta but not in Ontario.

/** A reseller that sells the plan for less, at its cheapest price. */
export interface ResellerDeal {
  reseller: SnapshotReseller;
  /** The price, picked for the buyer: converted into their currency, as price tags show it. */
  price: PickedPrice;
  /** Where to buy it: the reseller's page for this price. */
  link: string;
  /** What it costs the buyer per month, sales tax included. */
  monthlyCost: number;
  /** How much less that is than the provider's own cheapest price, per month, with tax. */
  monthlySaving: number;
}

export interface DealContext extends PriceContext {
  /** Where the buyer pays tax: Settings', or buyerTaxPlace's for an item bought elsewhere. */
  taxPlace: TaxPlace;
}

/**
 * The resellers that sell `planId` for less than `provider` does, each at its cheapest price per month after tax,
 * cheapest first. Only prices for the buyer's region, a group it belongs to or GLOBAL count: a reseller doesn't sell
 * where it has no price. A price that leaves VAT to be added (`taxExcluded`) counts only in Canada and the US, where
 * the app knows the tax. Nothing is compared without a rate to convert into the buyer's currency.
 */
export function resellerDeals(
  provider: SnapshotProvider,
  planId: string,
  resellers: readonly SnapshotReseller[],
  context: DealContext,
): ResellerDeal[] {
  const plan = provider.plans.find((candidate) => candidate.id === planId);
  if (!plan) return [];
  const pricing = {
    ...context,
    ...(provider.billingCurrency && { billingCurrency: provider.billingCurrency }),
  };
  const direct = cheapest(
    pickPrice(plan.prices, pricing).map((price) => ({ price, link: '' })),
    context,
  );
  if (!direct) return [];
  const usable = new Set([context.region, ...groupsOf(context.region), globalRegion]);
  const knowsTax = taxAddedRegions.has(context.taxPlace.country);
  const deals = (provider.resellers ?? []).flatMap((listing): ResellerDeal[] => {
    const reseller = resellers.find((candidate) => candidate.id === listing.reseller);
    if (!reseller) return [];
    const offers = listing.offers
      .filter((offer) => offer.plan === planId)
      .flatMap((offer) => offer.prices)
      .filter((price) => usable.has(price.region) && (knowsTax || !price.taxExcluded))
      .map((price) => ({ price: picked(price, context), link: price.sourceUrl }));
    const best = cheapest(offers, context);
    if (!best || best.monthlyCost >= direct.monthlyCost - halfACent) return [];
    return [
      {
        reseller,
        price: best.price,
        link: best.link,
        monthlyCost: best.monthlyCost,
        monthlySaving: direct.monthlyCost - best.monthlyCost,
      },
    ];
  });
  return deals.sort((a, b) => a.monthlyCost - b.monthlyCost);
}

/** Less than this per month is the same price: amounts are compared at full precision, and shown to the cent. */
const halfACent = 0.005;

/** A reseller price picked like a catalog one, in the buyer's currency when there's a rate. One price picks itself. */
function picked(price: ResellerPrice, context: PriceContext): PickedPrice {
  return pickPrice([price], context)[0];
}

/**
 * The cheapest of `prices` per month with the buyer's sales tax, and of two that cost the same per month, the one paid
 * for fewer months at a time. None can be compared without a rate.
 */
function cheapest(
  prices: readonly { price: PickedPrice; link: string }[],
  context: DealContext,
): { price: PickedPrice; link: string; monthlyCost: number } | undefined {
  let best: { price: PickedPrice; link: string; monthlyCost: number } | undefined;
  for (const { price, link } of prices) {
    if (price.currency !== context.currency) continue;
    const tax = addedSalesTax(price, context.taxPlace)?.percent ?? 0;
    const monthlyCost = price.monthlyEquivalent * (1 + tax / 100);
    const cheaper = !best || monthlyCost < best.monthlyCost - halfACent;
    const asCheapButShorter =
      best !== undefined &&
      Math.abs(monthlyCost - best.monthlyCost) < halfACent &&
      price.amount < best.price.amount;
    if (cheaper || asCheapButShorter) best = { price, link, monthlyCost };
  }
  return best;
}

import type { Price } from './price';
import type { Provider } from './provider';
import { globalRegion, groupsOf } from './regions';

// Where a provider, plan, add-on or bundle is sold (BLUEPRINT §4.7). The catalog fills Canada first, so a missing
// price isn't proof that something isn't sold somewhere: without availableIn, a region the catalog has no prices
// for is unknown, not "not offered".

/**
 * - `offered`: sold in the region. pickPrice gives its price, converted when it isn't in the user's currency.
 * - `not-offered`: the app shows "Not offered in <country>" instead of a price.
 * - `unknown`: the catalog doesn't know. The app shows pickPrice's fallback price with "No <country> price yet".
 */
export type Availability = 'offered' | 'not-offered' | 'unknown';

type Seller = Pick<Provider, 'plans' | 'availableIn'>;

/**
 * Whether the provider sells in `region`. availableIn, when set, is the full list. Otherwise it's sold where its
 * plans have a price: in the region, in a group the region belongs to (EU), or GLOBAL.
 */
export function providerAvailability(provider: Seller, region: string): Availability {
  if (provider.availableIn) {
    return covers(provider.availableIn, region) ? 'offered' : 'not-offered';
  }
  return provider.plans.some((plan) => hasPriceFor(plan.prices, region)) ? 'offered' : 'unknown';
}

/**
 * Whether one plan or add-on of `provider`, or a bundle it sells, is sold in `region`. Once the catalog has the
 * provider's prices for a region, an item without one there isn't sold there: Disney+'s US-only plans aren't
 * offered in Canada.
 */
export function availability(
  prices: readonly Price[],
  provider: Seller,
  region: string,
): Availability {
  const seller = providerAvailability(provider, region);
  if (seller === 'not-offered') {
    return 'not-offered';
  }
  if (hasPriceFor(prices, region)) {
    return 'offered';
  }
  const pricedThere = provider.plans.some((plan) =>
    plan.prices.some((price) => price.region !== globalRegion && covers([price.region], region)),
  );
  return pricedThere ? 'not-offered' : provider.availableIn ? 'offered' : 'unknown';
}

/** A price applies in `region`: its own, its group's, or a GLOBAL one. */
function hasPriceFor(prices: readonly Price[], region: string): boolean {
  return prices.some((price) => price.region === globalRegion || covers([price.region], region));
}

/** `regions` includes `region` or a group it belongs to. */
function covers(regions: readonly string[], region: string): boolean {
  return regions.includes(region) || groupsOf(region).some((group) => regions.includes(group));
}

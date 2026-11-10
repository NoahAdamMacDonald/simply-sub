import type { Price } from './price';
import type { Provider } from './provider';
import { countryOf, globalRegion, groupsOf, isSubdivision } from './regions';

// Where a provider, plan, add-on or bundle is sold (BLUEPRINT §4.7). The catalog fills Canada first, so a missing
// price isn't proof that something isn't sold somewhere: without availableIn, a region the catalog has no prices
// for is unknown, not "not offered". A province or state (M11.17) is part of its country: the user's own decides
// when it's given, and without it a country counts as sold where any of its provinces is.

/**
 * - `offered`: sold in the region. pickPrice gives its price, converted when it isn't in the user's currency.
 * - `not-offered`: the app shows "Not offered in <country>" instead of a price.
 * - `unknown`: the catalog doesn't know. The app shows pickPrice's fallback price with "No price for <country> yet".
 */
export type Availability = 'offered' | 'not-offered' | 'unknown';

type Seller = Pick<Provider, 'plans' | 'availableIn'>;

/**
 * Whether the provider sells in `region`, or in the user's province of it (`subdivision`, core's subdivisionIn).
 * availableIn, when set, is the full list. Otherwise it's sold where its plans have a price: in the province, the
 * region, a group the region belongs to (EU), or GLOBAL.
 */
export function providerAvailability(
  provider: Seller,
  region: string,
  subdivision?: string,
): Availability {
  const place = placeOf(region, subdivision);
  if (provider.availableIn) {
    return covers(provider.availableIn, place) ? 'offered' : 'not-offered';
  }
  return provider.plans.some((plan) => hasPriceFor(plan.prices, place)) ? 'offered' : 'unknown';
}

/**
 * Whether one plan or add-on of `provider`, or a bundle it sells, is sold in `region` (or the user's province of it).
 * Once the catalog has the provider's prices for a region, an item without one there isn't sold there: Disney+'s
 * US-only plans aren't offered in Canada, and a plan priced only in Quebec isn't offered in Ontario once the provider
 * is priced anywhere in Canada.
 */
export function availability(
  prices: readonly Price[],
  provider: Seller,
  region: string,
  subdivision?: string,
): Availability {
  const place = placeOf(region, subdivision);
  const seller = providerAvailability(provider, region, subdivision);
  if (seller === 'not-offered') {
    return 'not-offered';
  }
  if (hasPriceFor(prices, place)) {
    return 'offered';
  }
  const pricedThere = provider.plans.some((plan) =>
    plan.prices.some(
      (price) =>
        price.region !== globalRegion &&
        (covers([price.region], place) ||
          (isSubdivision(place) && countryOf(price.region) === countryOf(place))),
    ),
  );
  return pricedThere ? 'not-offered' : provider.availableIn ? 'offered' : 'unknown';
}

/** Where the user is for `region`: their province of it when given, else the region. */
function placeOf(region: string, subdivision: string | undefined): string {
  return subdivision !== undefined && countryOf(subdivision) === region ? subdivision : region;
}

/** A price applies in `place`: its own, its country's or group's, or a GLOBAL one. */
function hasPriceFor(prices: readonly Price[], place: string): boolean {
  return prices.some((price) => price.region === globalRegion || covers([price.region], place));
}

/**
 * `regions` covers `place`: it lists it or a group it belongs to (a province's country, a country's EU); and a country
 * with no province given is covered by any of its provinces, since it's sold somewhere in it.
 */
function covers(regions: readonly string[], place: string): boolean {
  return (
    regions.includes(place) ||
    groupsOf(place).some((group) => regions.includes(group)) ||
    (!isSubdivision(place) &&
      regions.some((region) => isSubdivision(region) && countryOf(region) === place))
  );
}

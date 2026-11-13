import type { Price } from './price';
import type { Plan, Provider, SoldRegions } from './provider';
import { countryOf, globalRegion, groupsOf, isSubdivision } from './regions';

// Where a provider, plan, add-on or bundle is sold (BLUEPRINT §4.7). The catalog fills Canada first, so a missing
// price isn't proof that something isn't sold somewhere: without availableIn, a region the catalog has no prices
// for is unknown, not "not offered". A province or state (M11.17) is part of its country: the user's own decides
// when it's given, and without it a country counts as sold where any of its provinces is. Where prices alone would
// say otherwise, a plan's own soldIn and notSoldIn (M11.20) state what its provider's page says.

/**
 * - `offered`: sold in the region. pickPrice gives its price, converted when it isn't in the user's currency.
 * - `not-offered`: the app shows "Not offered in <country>" instead of a price.
 * - `unknown`: the catalog doesn't know. The app shows pickPrice's fallback price with "No price for <country> yet".
 */
export type Availability = 'offered' | 'not-offered' | 'unknown';

type Seller = Pick<Provider, 'plans' | 'availableIn'>;

/** What availability reads of a plan, add-on or bundle: its prices, and a plan's own soldIn and notSoldIn. */
export type SoldItem = Pick<Plan, 'prices'> & Partial<Pick<Plan, 'soldIn' | 'notSoldIn'>>;

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
 * A plan's notSoldIn comes first, before its prices, so it can leave a place out of a wider price (a Canadian price,
 * except Quebec). Once the catalog has the provider's prices for a region, an item without one there isn't sold there,
 * unless its soldIn names it: Disney+'s US-only plans aren't offered in Canada, and a plan priced only in Quebec isn't
 * offered in Ontario once the provider is priced anywhere in Canada.
 */
export function availability(
  item: SoldItem,
  provider: Seller,
  region: string,
  subdivision?: string,
): Availability {
  const place = placeOf(region, subdivision);
  if (
    providerAvailability(provider, region, subdivision) === 'not-offered' ||
    names(soldRegions(item.notSoldIn), place)
  ) {
    return 'not-offered';
  }
  if (hasPriceFor(item.prices, place) || covers(soldRegions(item.soldIn), place)) {
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

/** The regions a plan's soldIn or notSoldIn entries name. */
export function soldRegions(entries: readonly SoldRegions[] | undefined): string[] {
  return (entries ?? []).flatMap((entry) => entry.regions);
}

/**
 * `regions` name `place` or what it's part of (a province's country, a country's group). Unlike covers, a country
 * isn't named through one of its provinces: "not sold in Quebec" says nothing of Canada as a whole.
 */
export function names(regions: readonly string[], place: string): boolean {
  return regions.includes(place) || groupsOf(place).some((group) => regions.includes(group));
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
 * `regions` covers `place`: it names it (names), and a country with no province given is covered by any of its
 * provinces, since it's sold somewhere in it.
 */
function covers(regions: readonly string[], place: string): boolean {
  return (
    names(regions, place) ||
    (!isSubdivision(place) &&
      regions.some((region) => isSubdivision(region) && countryOf(region) === place))
  );
}

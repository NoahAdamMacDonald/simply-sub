import * as z from 'zod';
import { regionSchema } from './formats';
import type { Price } from './price';
import { globalRegion, groupsOf, membersOf } from './regions';
import type { ResellerListing } from './reseller';
import { catalogMetaSchema, type CatalogMeta, type CatalogSnapshot } from './snapshot';

// The per-region catalog files (BLUEPRINT §6.3). data/catalog/<region>.json is the snapshot with only the prices
// pickPrice can pick for a buyer in that region, whatever their currency, so the app doesn't download every
// region's prices. data/catalog/index.json lists the files and the catalog version, which GET /catalog sends as its
// ETag. A missing static file is answered with the app's index.html (the SPA fallback), so the Worker and the app
// look a region up in the index instead of trying its file (regionFileFor, in catalog-sync.ts).

/**
 * The prices pickPrice can pick for a buyer in `region`, in any currency: those of the region, or else of the
 * first group it belongs to that has any, since pickPrice's rule 1 then always wins. An item priced in neither keeps
 * every price, because rules 2 to 4 can pick any region, depending on the buyer's currency.
 */
export function regionPrices<T extends Price>(prices: readonly T[], region: string): T[] {
  for (const where of [region, ...groupsOf(region)]) {
    const there = prices.filter((price) => price.region === where);
    if (there.length > 0) {
      return there;
    }
  }
  return [...prices];
}

/**
 * A provider's resellers as a buyer in `region` can use them: the prices for the region, a group it belongs to or
 * GLOBAL, and in a group's file its members' too, since a member without a file of its own gets its group's (a Swede
 * gets EU.json, with Sweden's shops). A reseller price never stands in for another region's, so offers and resellers
 * left with none are left out.
 */
export function regionResellers(
  resellers: readonly ResellerListing[],
  region: string,
): ResellerListing[] {
  const usable = new Set([region, ...groupsOf(region), ...membersOf(region), globalRegion]);
  return resellers.flatMap((listing) => {
    const offers = listing.offers.flatMap((offer) => {
      const prices = offer.prices.filter((price) => usable.has(price.region));
      return prices.length > 0 ? [{ ...offer, prices }] : [];
    });
    return offers.length > 0 ? [{ ...listing, offers }] : [];
  });
}

/**
 * The region file for `region`: every provider, plan, add-on and bundle, each with only its regionPrices, the
 * resellers a buyer there can use, and meta.region set. Nothing else changes, so the version, build time, region list
 * and counts are the full snapshot's.
 */
export function regionSnapshot(snapshot: CatalogSnapshot, region: string): CatalogSnapshot {
  const trimmed = <T extends { prices: Price[] }>(item: T): T => ({
    ...item,
    prices: regionPrices(item.prices, region),
  });
  const { data, meta } = snapshot;
  return {
    data: {
      ...data,
      providers: data.providers.map(({ resellers, ...provider }) => {
        const usable = resellers && regionResellers(resellers, region);
        return {
          ...provider,
          plans: provider.plans.map(trimmed),
          ...(provider.addOns && { addOns: provider.addOns.map(trimmed) }),
          ...(usable && usable.length > 0 && { resellers: usable }),
        };
      }),
      bundles: data.bundles.map(trimmed),
    },
    meta: {
      catalogVersion: meta.catalogVersion,
      generatedAt: meta.generatedAt,
      region,
      regions: meta.regions,
      counts: meta.counts,
    },
  };
}

export const catalogIndexSchema = z.strictObject({
  catalogVersion: catalogMetaSchema.shape.catalogVersion,
  generatedAt: catalogMetaSchema.shape.generatedAt,
  regions: z
    .array(regionSchema)
    .describe(
      'The regions with a file of their own, data/catalog/<region>.json: every priced country and group (EU), sorted',
    ),
});
export type CatalogIndex = z.infer<typeof catalogIndexSchema>;

/** data/catalog/index.json: a file for every region with a price, except GLOBAL, whose prices apply everywhere. */
export function buildCatalogIndex(meta: CatalogMeta): CatalogIndex {
  return {
    catalogVersion: meta.catalogVersion,
    generatedAt: meta.generatedAt,
    regions: meta.regions.filter((region) => region !== globalRegion),
  };
}

import * as z from 'zod';
import { regionSchema } from './formats';
import type { Price } from './price';
import { globalRegion, groupsOf } from './regions';
import { catalogMetaSchema, type CatalogMeta, type CatalogSnapshot } from './snapshot';

// The per-region catalog files (BLUEPRINT §6.3). data/catalog/<region>.json is the snapshot with only the prices
// pickPrice can pick for a buyer in that region, whatever their currency, so the app doesn't download every
// region's prices. data/catalog/index.json lists the files and the catalog version, which GET /catalog sends as its
// ETag. A missing static file is answered with the app's index.html (the SPA fallback), so the Worker and the app
// look a region up in the index instead of trying its file.

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
 * The region file for `region`: every provider, plan, add-on and bundle, each with only its regionPrices, and
 * meta.region set. Nothing else changes, so the version, build time, region list and counts are the full
 * snapshot's.
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
      providers: data.providers.map((provider) => ({
        ...provider,
        plans: provider.plans.map(trimmed),
        ...(provider.addOns && { addOns: provider.addOns.map(trimmed) }),
      })),
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

/**
 * The region whose file serves a buyer in `region`: its own, else its group's (EU for a Swede without Swedish
 * prices), or undefined for the full catalog.json, which every other country needs, since any region's price can
 * be the one pickPrice falls back to.
 */
export function regionFileFor(
  region: string,
  { regions }: Pick<CatalogIndex, 'regions'>,
): string | undefined {
  return [region, ...groupsOf(region)].find((code) => regions.includes(code));
}

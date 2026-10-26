import type { CatalogSnapshot, Price } from '@simply-sub/core';

// Catalog files for specs, as data:build writes them (BLUEPRINT §6.3): one provider with one plan, priced in Canada,
// the US and the EU. A region's file keeps only that region's price, so a spec can tell the files apart.

/** The regions with a file of their own, as index.json lists them. */
export const catalogRegions = ['CA', 'EU', 'US'];

const currencies: Record<string, string> = { CA: 'CAD', EU: 'EUR', US: 'USD' };

function price(region: string): Price {
  return {
    region,
    currency: currencies[region],
    amount: 5,
    interval: 'month',
    intervalCount: 1,
    autoRenew: true,
    lastVerified: '2026-10-20',
  };
}

/** data/catalog/<region>.json, or the full data/catalog.json when `region` is undefined. */
export function catalogFile(
  region: string | undefined,
  catalogVersion: string,
  generatedAt = '2026-10-22T12:00:00Z',
): CatalogSnapshot {
  return {
    data: {
      schemaVersion: 1,
      features: [],
      categories: {
        service: [{ id: 'vpn', name: 'VPN', icon: 'vpn_lock' }],
        feature: [{ id: 'vpn', name: 'VPN' }],
        spend: [{ id: 'software', name: 'Software' }],
      },
      providers: [
        {
          id: 'mullvad',
          name: 'Mullvad VPN',
          website: 'https://mullvad.net',
          category: 'vpn',
          spendCategory: 'software',
          plans: [
            {
              id: 'mullvad.vpn',
              name: 'Mullvad VPN',
              features: {},
              prices: (region === undefined ? catalogRegions : [region]).map(price),
            },
          ],
        },
      ],
      bundles: [],
    },
    meta: {
      catalogVersion,
      generatedAt,
      ...(region !== undefined && { region }),
      regions: catalogRegions,
      counts: { providers: 1, plans: 1, addOns: 0, bundles: 0, features: 0 },
    },
  };
}

/** data/catalog/index.json for a version. */
export function catalogIndex(catalogVersion: string, generatedAt = '2026-10-22T12:00:00Z') {
  return { catalogVersion, generatedAt, regions: catalogRegions };
}

/** The regions whose price a file keeps, to tell which file the store chose. */
export function pricedIn(data: CatalogSnapshot['data'] | undefined): string[] | undefined {
  return data?.providers[0].plans[0].prices.map((p) => p.region);
}

import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  buildCatalogMeta,
  buildSeedIndex,
  readCatalogSource,
  seedFormat,
  seedIndexSchema,
  seedProviderPath,
} from '../../src';
import { catalog } from './catalog-files';

// The seed index data:build publishes for the bot's seeding of what waits (M11.8). The steps themselves run against
// D1 in apps/api/test/seed.spec.ts.

const data = buildCatalogData(readCatalogSource(catalog()), 'https://sub.simplely.ca/icons/');
const snapshot = {
  data,
  meta: buildCatalogMeta(data, { catalogVersion: 'abc1234', generatedAt: '2026-11-03T12:00:00Z' }),
};
const hashes = new Map(data.providers.map((provider, n) => [provider.id, String(n).repeat(64)]));

describe('the seed index (M11.8)', () => {
  it('names each provider’s hash in the catalog’s order, with the features and bundles', () => {
    const index = buildSeedIndex(snapshot, hashes);
    expect(seedIndexSchema.parse(index)).toEqual(index);
    expect(index.providers).toEqual(
      data.providers.map((provider) => ({ id: provider.id, hash: hashes.get(provider.id) })),
    );
    expect(index).toMatchObject({
      catalogVersion: 'abc1234',
      seedFormat,
      features: data.features,
      bundles: data.bundles,
      // What provider_prices holds, for the catalog row (M11.8, shape 5).
      currencies: ['CAD', 'CHF', 'EUR', 'USD'],
    });
    expect(seedProviderPath('netflix')).toBe('data/seed/providers/netflix.json');
  });

  it('refuses a provider without a hash', () => {
    expect(() => buildSeedIndex(snapshot, new Map())).toThrow('No hash for provider crave');
  });
});

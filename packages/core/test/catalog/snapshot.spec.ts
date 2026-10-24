import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  buildCatalogMeta,
  catalogDataSchema,
  catalogMetaSchema,
  catalogSnapshotSchema,
  readCatalogSource,
  type CatalogData,
} from '../../src';
import { catalog, catalogWith } from './catalog-files';
import { issues } from './helpers';

const iconBaseUrl = 'https://sub.simplely.ca/icons/';
const stamp = { catalogVersion: 'abc1234', generatedAt: '2026-10-23T12:00:00Z' };

function dataOf(files = catalog()): CatalogData {
  return buildCatalogData(readCatalogSource(files), iconBaseUrl);
}

describe('readCatalogSource', () => {
  it('reads every file, with providers and bundles sorted by id', () => {
    const source = readCatalogSource(catalog());
    expect([...source.logos.keys()]).toEqual(['crave', 'mullvad', 'netflix', 'proton']);
    expect(source.providers.map((provider) => provider.id)).toEqual([
      'crave',
      'mullvad',
      'netflix',
      'proton',
    ]);
    expect(source.bundles.map((bundle) => bundle.id)).toEqual(['bundle.netflix-crave']);
    expect(source.features).toHaveLength(10);
    expect(source.categories.service.map((category) => category.id)).toEqual([
      'streaming',
      'vpn',
      'privacy-suite',
    ]);
  });

  it("doesn't depend on file order", () => {
    expect(readCatalogSource(catalog().reverse())).toEqual(readCatalogSource(catalog()));
  });

  it.each([
    ['fails its schema', catalogWith('data/providers/netflix.yaml', ['plans'], [])],
    [
      'is not valid YAML',
      [
        ...catalog().filter(({ file }) => file !== 'data/providers/netflix.yaml'),
        { file: 'data/providers/netflix.yaml', invalidYaml: true as const },
      ],
    ],
  ])('throws on a file that %s', (_case, files) => {
    expect(() => readCatalogSource(files)).toThrow(
      "data/providers/netflix.yaml doesn't match its schema: run npm run data:validate",
    );
  });

  it('needs features.yaml and categories.yaml', () => {
    const files = catalog().filter(({ file }) => file !== 'data/categories.yaml');
    expect(() => readCatalogSource(files)).toThrow(
      'data/features.yaml and data/categories.yaml are both needed',
    );
  });
});

describe('buildCatalogData', () => {
  it('keeps the source files and adds schemaVersion', () => {
    const source = readCatalogSource(catalog());
    const data = buildCatalogData(source, iconBaseUrl);
    expect(data.schemaVersion).toBe(1);
    expect(data.features).toEqual(source.features);
    expect(data.categories).toEqual(source.categories);
    expect(data.bundles).toEqual(source.bundles);
    expect(data.providers).toEqual(
      source.providers.map((provider) => ({ ...provider, iconUrl: expect.any(String) })),
    );
  });

  it('leaves out the icon URL of a provider without a logo', () => {
    const files = catalog().filter(({ file }) => file !== 'data/logos/crave.png');
    const [crave, mullvad] = dataOf(files).providers;
    expect('iconUrl' in crave).toBe(false);
    expect(mullvad.iconUrl).toBe('https://sub.simplely.ca/icons/mullvad.png');
    expect(issues(catalogDataSchema, dataOf(files))).toEqual([]);
  });

  it("adds each provider's icon URL after website, where the API examples have it", () => {
    const files = catalogWith('data/providers/mullvad.yaml', ['aliases'], ['mullvad']);
    const mullvad = dataOf(files).providers[1];
    expect(mullvad.iconUrl).toBe('https://sub.simplely.ca/icons/mullvad.png');
    expect(Object.keys(mullvad)).toEqual([
      'id',
      'name',
      'aliases',
      'website',
      'iconUrl',
      'category',
      'spendCategory',
      'billingCurrency',
      'plans',
    ]);
  });

  it('matches the snapshot schema', () => {
    const data = dataOf();
    const snapshot = { data, meta: buildCatalogMeta(data, stamp) };
    expect(issues(catalogSnapshotSchema, snapshot)).toEqual([]);
  });
});

describe('buildCatalogMeta', () => {
  it('lists the regions and counts', () => {
    expect(buildCatalogMeta(dataOf(), stamp)).toEqual({
      ...stamp,
      regions: ['CA', 'GLOBAL', 'US'],
      counts: { providers: 4, plans: 10, addOns: 2, bundles: 1, features: 10 },
    });
  });

  it.each([
    ['catalogVersion', 'C4F9A21', 'catalogVersion: Use 7 lowercase hex digits'],
    ['generatedAt', '2026-10-23', 'generatedAt: Invalid ISO datetime'],
  ])('rejects a malformed %s', (key, value, expected) => {
    const meta = { ...buildCatalogMeta(dataOf(), stamp), [key]: value };
    expect(issues(catalogMetaSchema, meta)).toEqual([expected]);
  });
});

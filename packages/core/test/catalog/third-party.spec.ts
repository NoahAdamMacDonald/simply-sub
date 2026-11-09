import { describe, expect, it } from 'vitest';
import { buildCatalogData, readCatalogSource, withoutThirdParty } from '../../src';
import { catalog, catalogWith } from './catalog-files';

// Settings' "Use third-party claims" off (M11.16): the app reads the catalog without its third-party values.

const netflix = 'data/providers/netflix.yaml';

const claim = {
  publisher: 'The Verge',
  url: 'https://www.theverge.com/netflix-plans',
  quote: 'Standard streams in 1080p.',
  lastVerified: '2026-10-20',
};

function data(files = catalog()) {
  return buildCatalogData(readCatalogSource(files), 'https://sub.simplely.ca/icons/');
}

describe('withoutThirdParty', () => {
  it('drops the values a publication gives, and keeps the rest', () => {
    const claimed = data(
      catalogWith(netflix, ['plans', 0, 'thirdParty'], { 'video.quality': claim }),
    );
    const plan = claimed.providers.find(({ id }) => id === 'netflix')?.plans[0];
    expect(plan?.features).toHaveProperty('video.quality');

    const without = withoutThirdParty(claimed);
    const stripped = without.providers.find(({ id }) => id === 'netflix')?.plans[0];
    expect(stripped).not.toHaveProperty('thirdParty');
    expect(stripped?.features).toEqual(
      Object.fromEntries(
        Object.entries(plan?.features ?? {}).filter(([id]) => id !== 'video.quality'),
      ),
    );
    expect(without.providers.find(({ id }) => id === 'netflix')?.plans[1]).toBe(
      claimed.providers.find(({ id }) => id === 'netflix')?.plans[1],
    );
  });

  it('gives back the same catalog when nothing in it is third-party', () => {
    const plain = data();
    expect(withoutThirdParty(plain)).toBe(plain);
  });
});

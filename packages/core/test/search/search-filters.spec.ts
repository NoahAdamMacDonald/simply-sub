import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  buildCatalogMeta,
  featureSuggestions,
  filterCount,
  priceRange,
  rankKeyLabel,
  readCatalogSource,
  regionSnapshot,
  searchFilterOptions,
  type CatalogData,
  type CatalogSearchContext,
  type CatalogSourceFile,
  type FeatureSuggestionGroup,
  type FxRates,
} from '../../src';
import { catalog, edited } from '../catalog/catalog-files';

// The fixture catalog (catalog-files.ts) for an Ontarian: Netflix (Premium in the US only), Crave (CA only), Mullvad
// VPN (EUR only) and Proton (GLOBAL prices, Duo in USD only).

const today = '2026-10-26';

/** Rates per Canadian dollar: Proton Duo's US$19.99 is CA$27.60. */
const cad: FxRates = {
  base: 'CAD',
  date: '2026-10-26',
  source: 'European Central Bank via Frankfurter',
  rates: { CHF: 0.581, EUR: 0.6372, USD: 0.7243 },
};

function regionData(region: string, files: CatalogSourceFile[] = catalog()): CatalogData {
  const data = buildCatalogData(readCatalogSource(files), 'https://sub.simplely.ca/icons/');
  const meta = buildCatalogMeta(data, {
    catalogVersion: '1234567',
    generatedAt: '2026-10-26T12:00:00.000Z',
  });
  return regionSnapshot({ data, meta }, region).data;
}

const ontario: Omit<CatalogSearchContext, 'items'> = {
  catalog: regionData('CA'),
  settings: { country: 'CA', subdivision: 'CA-ON', currency: 'CAD' },
  fx: cad,
  today,
};

describe('searchFilterOptions', () => {
  it('offers the categories and rank keys of what’s sold in the user’s country', () => {
    const options = searchFilterOptions(ontario);

    expect([...options.categories].sort()).toEqual(['privacy-suite', 'streaming', 'vpn']);
    // No plan sold in Canada has 5 streams, and cloud storage has no tiers to rank.
    expect(options.keys.map((option) => option.key)).toEqual([
      'video.quality=480p',
      'video.quality=720p',
      'video.quality=1080p',
      'video.quality=4k',
      'streaming.ad-free',
      'streaming.concurrent-streams=1',
      'streaming.concurrent-streams=2-4',
      'streaming.live=tv-channels',
      'streaming.live=sports',
      'vpn.included',
      'vpn.devices=1-5',
      'vpn.devices=6-10',
      'vpn.unlimited-traffic',
      'account.users=2-5',
    ]);
  });

  it('leaves out what only plans not sold there have', () => {
    // Crave Premium at 1080p leaves 4k to Netflix Premium, sold in the US only. Proton sold only in the US takes
    // its category with it.
    const files = edited(
      edited(
        catalog(),
        'data/providers/crave.yaml',
        ['plans', 1, 'features', 'video.quality'],
        '1080p',
      ),
      'data/providers/proton.yaml',
      ['availableIn'],
      ['US'],
    );
    const canada = searchFilterOptions({ ...ontario, catalog: regionData('CA', files) });
    const keys = (options: typeof canada) => options.keys.map((option) => option.key);

    expect(keys(canada)).not.toContain('video.quality=4k');
    expect(keys(canada)).not.toContain('account.users=2-5');
    expect([...canada.categories].sort()).toEqual(['streaming', 'vpn']);

    const states = searchFilterOptions({
      catalog: regionData('US', files),
      settings: { country: 'US', currency: 'USD' },
      today,
    });
    expect(keys(states)).toContain('video.quality=4k');
    expect([...states.categories]).toContain('privacy-suite');
  });

  it('offers a category that only a plan is in', () => {
    // Mullvad becomes a privacy suite, but Proton's plans are VPNs too.
    const files = edited(catalog(), 'data/providers/mullvad.yaml', ['category'], 'privacy-suite');
    const options = searchFilterOptions({ ...ontario, catalog: regionData('CA', files) });

    expect([...options.categories].sort()).toEqual(['privacy-suite', 'streaming', 'vpn']);
  });

  it('tops the price slider just above the priciest plan’s monthly equivalent, in the user’s currency', () => {
    // Proton Duo's US$19.99 is CA$27.60 a month.
    expect(searchFilterOptions(ontario).price).toEqual({ top: 30, step: 1 });
  });
});

describe('priceRange', () => {
  it('takes about 40 round steps to a top that’s five steps’ multiple', () => {
    expect(priceRange(28.19)).toEqual({ top: 30, step: 1 });
    expect(priceRange(23.99)).toEqual({ top: 25, step: 1 });
    expect(priceRange(30)).toEqual({ top: 30, step: 1 });
    expect(priceRange(150)).toEqual({ top: 150, step: 5 });
    expect(priceRange(3600)).toEqual({ top: 4000, step: 100 });
    expect(priceRange(4.2)).toEqual({ top: 5, step: 0.2 });
  });

  it('still gives a range when nothing costs anything', () => {
    const { top, step } = priceRange(0);
    expect(top).toBeGreaterThan(0);
    expect(top / step).toBe(5);
  });
});

describe('featureSuggestions', () => {
  const options = searchFilterOptions(ontario);
  const context = { keys: options.keys, categories: ontario.catalog.categories.feature };
  const suggest = (text: string, picked?: string[]) =>
    featureSuggestions(text, { ...context, ...(picked && { picked }) }).map(
      ({ label, keys }: FeatureSuggestionGroup) => [label, keys.map(rankKeyLabel)],
    );

  it('offers a feature’s keys for its name, then the rest of its category', () => {
    expect(suggest('Video quality')).toEqual([
      [
        'Matches',
        [
          'Video quality: 480p (SD)',
          'Video quality: 720p (HD)',
          'Video quality: 1080p (Full HD)',
          'Video quality: 4K (Ultra HD)',
        ],
      ],
      [
        'More in Streaming',
        [
          'Ad free',
          'Simultaneous streams: Single device',
          'Simultaneous streams: 2 to 4 devices',
          'Live TV and sports: Live TV channels',
          'Live TV and sports: Live sports',
        ],
      ],
    ]);
  });

  it('matches a key by its own name, from the start of a word, ignoring case, accents and punctuation', () => {
    expect(suggest('ultra')[0]).toEqual(['Matches', ['Video quality: 4K (Ultra HD)']]);
    expect(suggest('VIDÉO Q')[0][1]).toHaveLength(4);
    expect(suggest('hd')[0]).toEqual([
      'Matches',
      [
        'Video quality: 720p (HD)',
        'Video quality: 1080p (Full HD)',
        'Video quality: 4K (Ultra HD)',
      ],
    ]);
    expect(suggest('ad-fr')[0]).toEqual(['Matches', ['Ad free']]);
    expect(suggest('ree')).toEqual([]);
  });

  it('matches a plural’s singular, and groups the rest by category', () => {
    expect(suggest('devices')).toEqual([
      [
        'Matches',
        [
          'Simultaneous streams: Single device',
          'Simultaneous streams: 2 to 4 devices',
          'VPN devices: 1 to 5 devices',
          'VPN devices: 6 to 10 devices',
        ],
      ],
      [
        'More in Streaming',
        [
          'Video quality: 480p (SD)',
          'Video quality: 720p (HD)',
          'Video quality: 1080p (Full HD)',
          'Video quality: 4K (Ultra HD)',
          'Ad free',
          'Live TV and sports: Live TV channels',
          'Live TV and sports: Live sports',
        ],
      ],
      ['More in VPN', ['VPN', 'Unlimited VPN traffic']],
    ]);
  });

  it('leaves out the keys already picked', () => {
    expect(suggest('video', ['video.quality=4k', 'streaming.ad-free'])).toEqual([
      [
        'Matches',
        ['Video quality: 480p (SD)', 'Video quality: 720p (HD)', 'Video quality: 1080p (Full HD)'],
      ],
      [
        'More in Streaming',
        [
          'Simultaneous streams: Single device',
          'Simultaneous streams: 2 to 4 devices',
          'Live TV and sports: Live TV channels',
          'Live TV and sports: Live sports',
        ],
      ],
    ]);
  });

  it('offers every key by category with no text, and nothing for text that names none', () => {
    expect(suggest('  ').map(([label]) => label)).toEqual([
      'Streaming',
      'VPN',
      'Accounts & sharing',
    ]);
    expect(suggest('  ').flatMap(([, keys]) => keys)).toHaveLength(options.keys.length);
    expect(suggest('gym')).toEqual([]);
  });
});

describe('filterCount', () => {
  it('counts each feature, and one for each other filter', () => {
    expect(filterCount({})).toBe(0);
    expect(filterCount({ q: 'vpn', sort: 'name' })).toBe(0);
    expect(filterCount({ maxPrice: 20 })).toBe(1);
    expect(
      filterCount({
        minPrice: 5,
        maxPrice: 20,
        category: 'vpn',
        features: ['vpn.included', 'vpn.devices=6-10'],
        activity: ['active', 'inactive'],
        nativeOnly: true,
      }),
    ).toBe(6);
    expect(filterCount({ activity: [], features: [], nativeOnly: false })).toBe(0);
  });

  it('counts Sold in only when the user’s default is off', () => {
    expect(filterCount({ soldOnly: true })).toBe(1);
    expect(filterCount({ soldOnly: true }, { soldOnly: true })).toBe(0);
    expect(filterCount({}, { soldOnly: true })).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  readCatalogSource,
  searchProviders,
  type CatalogSourceFile,
  type FxRates,
  type ProviderMatch,
  type ProvidersQuery,
  type SearchContext,
} from '../../src';
import { catalog, edited } from '../catalog/catalog-files';

// The test catalog: Netflix (CA and US prices, Premium in the US only), Crave (CA only), Mullvad VPN (one GLOBAL
// EUR price) and Proton (GLOBAL prices, a free plan, Duo in USD only).

const fx: FxRates = {
  base: 'CAD',
  date: '2026-10-21',
  source: 'European Central Bank via Frankfurter',
  rates: { CHF: 0.581, EUR: 0.664, USD: 0.7243 },
};

function setup(files: CatalogSourceFile[] = catalog()) {
  const source = readCatalogSource(files);
  const { providers } = buildCatalogData(source, 'https://sub.simplely.ca/icons/');
  const context: SearchContext = {
    features: source.features,
    categories: source.categories,
    fx,
    today: '2026-10-23',
  };
  return { providers, context };
}

function search(query: Partial<ProvidersQuery>, files?: CatalogSourceFile[]): ProviderMatch[] {
  const { providers, context } = setup(files);
  return searchProviders(providers, { sort: 'name', limit: 20, ...query }, context);
}

const canada = { region: 'CA', currency: 'CAD' };

/** Each match as provider id → its plans' ids. */
function planIds(matches: readonly ProviderMatch[]): [string, string[]][] {
  return matches.map((match) => [match.provider.id, match.plans.map((plan) => plan.plan.id)]);
}

describe('searchProviders', () => {
  describe('without a region', () => {
    it('lists every provider by name, with every plan in file order and no prices', () => {
      const matches = search({});

      expect(planIds(matches)).toEqual([
        ['crave', ['crave.standard', 'crave.premium']],
        ['mullvad', ['mullvad.vpn']],
        ['netflix', ['netflix.standard-ads', 'netflix.standard', 'netflix.premium']],
        ['proton', ['proton.free', 'proton.vpn-plus', 'proton.unlimited', 'proton.duo']],
      ]);
      expect(matches[0].plans[0]).toEqual({
        plan: expect.objectContaining({ id: 'crave.standard' }),
        matchedKeys: [],
        lastVerified: '2026-10-20',
        stale: false,
      });
      expect(matches.every((match) => match.matchedOn.length === 0)).toBe(true);
    });

    it('keeps plans with a price for the interval asked for', () => {
      expect(planIds(search({ interval: 'year' }))).toEqual([
        ['crave', ['crave.standard']],
        ['mullvad', ['mullvad.vpn']],
      ]);
    });
  });

  describe('with a region', () => {
    it("picks each plan's prices, cheapest plan first, and leaves out plans not offered there", () => {
      const matches = search({ ...canada, sort: 'price_asc' });

      expect(planIds(matches)).toEqual([
        ['proton', ['proton.free', 'proton.vpn-plus', 'proton.unlimited', 'proton.duo']],
        ['mullvad', ['mullvad.vpn']],
        // Premium is sold in the US only.
        ['netflix', ['netflix.standard-ads', 'netflix.standard']],
        ['crave', ['crave.standard', 'crave.premium']],
      ]);
      const [proton, mullvad] = matches;
      expect(proton.plans.map((plan) => plan.bestMonthlyEquivalent)).toEqual([
        0,
        12.49,
        16.24,
        19.99 / 0.7243,
      ]);
      expect(mullvad.plans[0].pricing?.map((price) => [price.interval, price.native])).toEqual([
        ['month', false],
        ['year', false],
      ]);
      // 60 EUR a year is cheaper per month than 5 EUR a month.
      expect(mullvad.plans[0].bestMonthlyEquivalent).toBeCloseTo(60 / 0.664 / 12, 10);
    });

    it('keeps a plan whose availability is unknown there, with its fallback price', () => {
      const matches = search({ region: 'US', currency: 'USD', category: 'streaming' });

      expect(planIds(matches)).toEqual([
        // Crave has no US prices and no availableIn: unknown, so it stays.
        ['crave', ['crave.standard', 'crave.premium']],
        ['netflix', ['netflix.standard-ads', 'netflix.standard', 'netflix.premium']],
      ]);
      expect(matches[0].plans[0].pricing?.[0]).toMatchObject({ currency: 'USD', native: false });
    });

    it('sorts by price, high to low', () => {
      expect(search({ ...canada, sort: 'price_desc' }).map((match) => match.provider.id)).toEqual([
        'crave',
        'netflix',
        'mullvad',
        'proton',
      ]);
    });

    it('filters on the monthly equivalent, to the cent', () => {
      expect(planIds(search({ ...canada, maxPrice: 12 }))).toEqual([
        // 119.99 a year is 10.00 a month.
        ['crave', ['crave.standard']],
        ['mullvad', ['mullvad.vpn']],
        ['netflix', ['netflix.standard-ads']],
        ['proton', ['proton.free']],
      ]);
      expect(planIds(search({ ...canada, minPrice: 16.24, maxPrice: 18.99 }))).toEqual([
        ['netflix', ['netflix.standard']],
        ['proton', ['proton.unlimited']],
      ]);
    });

    it('counts only the interval asked for', () => {
      const [crave] = search({ ...canada, interval: 'year' });

      expect(crave.plans[0].bestMonthlyEquivalent).toBeCloseTo(119.99 / 12, 10);
      expect(crave.plans[0].pricing).toHaveLength(2);
    });

    it('leaves out converted prices with nativeOnly', () => {
      expect(planIds(search({ ...canada, nativeOnly: true }))).toEqual([
        ['crave', ['crave.standard', 'crave.premium']],
        ['netflix', ['netflix.standard-ads', 'netflix.standard']],
        // Duo is priced in USD only, and free is native everywhere.
        ['proton', ['proton.free', 'proton.vpn-plus', 'proton.unlimited']],
      ]);
    });

    it('dates a plan by the oldest price it shows, and marks it stale after 90 days', () => {
      const files = edited(
        catalog(),
        'data/providers/crave.yaml',
        ['plans', 0, 'prices', 1, 'lastVerified'],
        '2026-07-24',
      );
      const [crave] = search({ ...canada, category: 'streaming', sort: 'name' }, files);

      expect(crave.plans.find((plan) => plan.plan.id === 'crave.standard')).toMatchObject({
        lastVerified: '2026-07-24',
        stale: true,
      });
      const [notYet] = search(
        { ...canada, category: 'streaming', sort: 'name' },
        edited(
          catalog(),
          'data/providers/crave.yaml',
          ['plans', 0, 'prices', 1, 'lastVerified'],
          '2026-07-25',
        ),
      );
      expect(notYet.plans[0].stale).toBe(false);
    });
  });

  describe('filters', () => {
    it('keeps plans that provide every rank key, and says so', () => {
      const matches = search({ ...canada, feature: ['video.quality=4k'], sort: 'price_asc' });

      expect(planIds(matches)).toEqual([['crave', ['crave.premium']]]);
      expect(matches[0].plans[0].matchedKeys).toEqual(['video.quality=4k']);
      expect(matches[0].matchedOn).toEqual(['feature:video.quality=4k']);
    });

    it('counts a higher enum value, a number above a tier and a set value', () => {
      expect(
        planIds(search({ feature: ['video.quality=1080p', 'streaming.concurrent-streams=2-4'] })),
      ).toEqual([['netflix', ['netflix.standard-ads', 'netflix.standard']]]);
      expect(planIds(search({ feature: ['streaming.live=tv-channels'] }))).toEqual([
        ['crave', ['crave.premium']],
      ]);
      expect(planIds(search({ feature: ['vpn.devices=6-10'] }))).toEqual([
        ['proton', ['proton.vpn-plus', 'proton.unlimited', 'proton.duo']],
      ]);
    });

    it('keeps a category, and says so', () => {
      const matches = search({ category: 'vpn' });

      expect(planIds(matches)).toEqual([['mullvad', ['mullvad.vpn']]]);
      expect(matches[0].matchedOn).toEqual(['category:vpn']);
    });
  });

  describe('text', () => {
    it('matches a provider by name, category and feature, ahead of one matched by a feature only', () => {
      const matches = search({ ...canada, q: 'vpn', sort: 'relevance' });

      expect(matches.map((match) => [match.provider.id, match.relevance, match.matchedOn])).toEqual(
        [
          [
            'mullvad',
            2,
            ['name', 'category:vpn', 'feature:vpn.included', 'feature:vpn.unlimited-traffic'],
          ],
          // Its VPN Plus plan's name matches, and every plan has a VPN.
          ['proton', 4, ['plan:proton.vpn-plus', 'feature:vpn.included']],
        ],
      );
      // "VPN devices" is named too, but "vpn" names rank keys, which come first.
      expect(matches[1].plans.map((plan) => plan.matchedKeys)).toEqual([
        ['vpn.included'],
        ['vpn.included'],
        ['vpn.included'],
        ['vpn.included'],
      ]);
    });

    it('ranks a provider name that starts with the text, then one that contains it, then a plan name', () => {
      const files = edited(catalog(), 'data/providers/crave.yaml', ['name'], 'Crave Plus');

      expect(search({ q: 'crave', sort: 'relevance' }, files)[0].relevance).toBe(1);
      expect(
        search({ q: 'plus', sort: 'relevance' }, files).map((match) => [
          match.provider.id,
          match.relevance,
        ]),
      ).toEqual([
        ['crave', 2],
        // Only its VPN Plus plan's name has it.
        ['proton', 4],
      ]);
    });

    it('brings only the plans whose names match, when no provider name does', () => {
      const matches = search({ q: 'premium', sort: 'relevance' });

      expect(planIds(matches)).toEqual([
        ['crave', ['crave.premium']],
        ['netflix', ['netflix.premium']],
      ]);
      expect(matches.map((match) => [match.relevance, match.matchedOn])).toEqual([
        [4, ['plan:crave.premium']],
        [4, ['plan:netflix.premium']],
      ]);
    });

    it('brings every plan of a provider matched by name or alias', () => {
      const files = edited(catalog(), 'data/providers/proton.yaml', ['aliases'], ['proton mail']);

      expect(planIds(search({ q: 'NETFLIX', sort: 'relevance' }))).toEqual([
        ['netflix', ['netflix.standard-ads', 'netflix.standard', 'netflix.premium']],
      ]);
      const [proton] = search({ q: 'mail', sort: 'relevance' }, files);
      expect([proton.provider.id, proton.relevance, proton.matchedOn, proton.plans.length]).toEqual(
        ['proton', 3, ['alias:proton mail'], 4],
      );
    });

    it('matches a rank key by its value name or alias, and lists the plans that provide it', () => {
      for (const q of ['4K', 'ultra hd']) {
        const matches = search({ q, sort: 'relevance' });

        expect(planIds(matches)).toEqual([
          ['crave', ['crave.premium']],
          ['netflix', ['netflix.premium']],
        ]);
        expect(matches[0].matchedOn).toEqual(['feature:video.quality=4k']);
        expect(matches[0].plans[0].matchedKeys).toEqual(['video.quality=4k']);
      }
    });

    it('ignores case, accents and extra spaces', () => {
      expect(planIds(search({ q: '  MÜLLVAD   vpn ', sort: 'relevance' }))).toEqual([
        ['mullvad', ['mullvad.vpn']],
      ]);
    });

    it('lists the filter keys before the text keys a plan matched', () => {
      const matches = search({ q: 'vpn', feature: ['vpn.devices=1-5'], sort: 'relevance' });
      const mullvad = matches.find((match) => match.provider.id === 'mullvad');

      expect(mullvad?.plans[0].matchedKeys).toEqual([
        'vpn.devices=1-5',
        'vpn.included',
        'vpn.unlimited-traffic',
      ]);
    });

    it('finds nothing for text nothing matches', () => {
      expect(search({ q: 'gym', sort: 'relevance' })).toEqual([]);
    });

    it('matches every term: a provider’s name with a rank key or a plan’s name', () => {
      const fourK = search({ q: 'netflix 4k', sort: 'relevance' });

      expect(planIds(fourK)).toEqual([['netflix', ['netflix.premium']]]);
      // The best term's relevance: the name starts with "netflix".
      expect([fourK[0].relevance, fourK[0].matchedOn]).toEqual([
        1,
        ['name', 'feature:video.quality=4k'],
      ]);
      const premium = search({ q: 'crave premium', sort: 'relevance' });
      expect(planIds(premium)).toEqual([['crave', ['crave.premium']]]);
      expect(premium[0].matchedOn).toEqual(['name', 'plan:crave.premium']);
      // No provider is both.
      expect(search({ q: 'netflix crave', sort: 'relevance' })).toEqual([]);
    });

    it('matches a plan name word by word', () => {
      expect(planIds(search({ q: 'Standard with ads', sort: 'relevance' }))).toEqual([
        ['crave', ['crave.standard']],
        ['netflix', ['netflix.standard-ads']],
      ]);
    });

    it('names a feature by its own name, with the highest key each plan provides of it', () => {
      const matches = search({ q: 'video quality', sort: 'relevance' });

      // Crave's Standard has no video quality.
      expect(planIds(matches)).toEqual([
        ['crave', ['crave.premium']],
        ['netflix', ['netflix.standard-ads', 'netflix.standard', 'netflix.premium']],
      ]);
      expect(matches[1].plans.map((plan) => plan.matchedKeys)).toEqual([
        ['video.quality=1080p'],
        ['video.quality=1080p'],
        ['video.quality=4k'],
      ]);
      expect([matches[1].relevance, matches[1].matchedOn]).toEqual([
        5,
        ['feature:video.quality=1080p', 'feature:video.quality=4k'],
      ]);
    });

    it('matches a plural as its singular, but not a word that only ends in s', () => {
      expect(search({ q: 'VPNs', sort: 'relevance' })).toEqual(
        search({ q: 'vpn', sort: 'relevance' }),
      );
      // "plu" would match more than plus does.
      expect(search({ q: 'plus', sort: 'relevance' }).map((match) => match.provider.id)).toEqual([
        'proton',
      ]);
    });

    it('brings every plan of a category the text names, else the plans with a feature it names', () => {
      const files = edited(catalog(), 'data/providers/proton.yaml', ['plans', 0, 'features'], {
        'storage.cloud': 5,
      });

      // Proton Free has no VPN.
      expect(planIds(search({ q: 'vpn', category: 'privacy-suite' }, files))).toEqual([
        ['proton', ['proton.vpn-plus', 'proton.unlimited', 'proton.duo']],
      ]);
      const vpnCategory = edited(files, 'data/providers/proton.yaml', ['category'], 'vpn');
      expect(planIds(search({ q: 'vpn', category: 'vpn' }, vpnCategory))).toEqual([
        ['mullvad', ['mullvad.vpn']],
        ['proton', ['proton.free', 'proton.vpn-plus', 'proton.unlimited', 'proton.duo']],
      ]);
    });

    it('brings every plan of a provider the text names when none provides the key it names', () => {
      const files = edited(catalog(), 'data/providers/mullvad.yaml', ['name'], 'Mullvad Ultra');

      // "Ultra" is in 4K (Ultra HD), which Mullvad doesn't have.
      expect(
        search({ q: 'ultra', sort: 'relevance' }, files).map((match) => [
          match.provider.id,
          match.relevance,
          match.plans.map((plan) => plan.plan.id),
        ]),
      ).toEqual([
        ['mullvad', 2, ['mullvad.vpn']],
        ['crave', 5, ['crave.premium']],
        ['netflix', 5, ['netflix.premium']],
      ]);
    });
  });

  it('sorts by the number of rank keys the shown plan provides', () => {
    expect(search({ ...canada, sort: 'features' }).map((match) => match.provider.id)).toEqual([
      // Standard with ads: 480p, 720p and 1080p, and 1 and 2-4 streams.
      'netflix',
      // VPN, 1 to 5 devices and unlimited traffic.
      'mullvad',
      // Free: VPN and 1 to 5 devices.
      'proton',
      // Standard With Ads: live sports.
      'crave',
    ]);
  });
});

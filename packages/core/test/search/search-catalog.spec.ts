import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  buildCatalogMeta,
  readCatalogSource,
  regionSnapshot,
  searchCatalog,
  type CatalogData,
  type CatalogQuery,
  type CatalogResult,
  type CatalogSearchContext,
  type CatalogSourceFile,
  type FxRates,
  type ListItem,
} from '../../src';
import { catalog, edited } from '../catalog/catalog-files';

// The fixture catalog (catalog-files.ts): Netflix (CA and US prices, Premium in the US only), Crave (CA only), Mullvad
// VPN (one GLOBAL EUR price) and Proton (GLOBAL prices, a free plan, Duo in USD only), as the app reads it: the file
// for the user's country.

const today = '2026-10-26';

/** Rates per Canadian dollar: 1 EUR is about CA$1.5694, so Mullvad's €60 a year is CA$94.16. */
const cad: FxRates = {
  base: 'CAD',
  date: '2026-10-26',
  source: 'European Central Bank via Frankfurter',
  rates: { CHF: 0.581, EUR: 0.6372, USD: 0.7243 },
};

const usd: FxRates = { ...cad, base: 'USD', rates: { CAD: 1.3806, CHF: 0.8022, EUR: 0.8797 } };

function regionData(region: string, files: CatalogSourceFile[] = catalog()): CatalogData {
  const data = buildCatalogData(readCatalogSource(files), 'https://sub.simplely.ca/icons/');
  const meta = buildCatalogMeta(data, {
    catalogVersion: '1234567',
    generatedAt: '2026-10-26T12:00:00.000Z',
  });
  return regionSnapshot({ data, meta }, region).data;
}

const ontario: CatalogSearchContext = {
  catalog: regionData('CA'),
  settings: { country: 'CA', subdivision: 'CA-ON', currency: 'CAD' },
  fx: cad,
  items: [],
  today,
};

const american: CatalogSearchContext = {
  catalog: regionData('US'),
  settings: { country: 'US', currency: 'USD' },
  fx: usd,
  items: [],
  today,
};

const listId = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
let count = 0;

function item(planId: string, dates: { endDate?: string } = {}): ListItem {
  count += 1;
  return {
    id: `0192f1c4-7b2e-7c3a-9d41-5e8f2a1b${String(count).padStart(4, '0')}`,
    listId,
    source: { kind: 'catalog', planId },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-09-10',
      autoRenew: true,
      ...dates,
    },
    tagIds: [],
    rankOverrides: {},
    pinned: false,
    createdAt: '2026-10-20T12:00:00.000Z',
    updatedAt: '2026-10-20T12:00:00.000Z',
  };
}

/** Each card as its provider, the plan it shows and its chips, or "not offered". */
function cards(results: readonly CatalogResult[]): [string, string, string[]][] {
  return results.map((result) =>
    result.kind === 'priced'
      ? [result.provider.id, result.shownPlanId, result.plans.map((plan) => plan.plan.id)]
      : [result.provider.id, 'not offered', []],
  );
}

function search(query: CatalogQuery, context: Partial<CatalogSearchContext> = {}) {
  return searchCatalog(query, { ...ontario, ...context });
}

describe('searchCatalog', () => {
  it('shows each provider’s cheapest plan, cheapest provider first, and no plan that isn’t sold there', () => {
    expect(cards(search({}))).toEqual([
      [
        'proton',
        'proton.free',
        ['proton.free', 'proton.vpn-plus', 'proton.unlimited', 'proton.duo'],
      ],
      ['mullvad', 'mullvad.vpn', ['mullvad.vpn']],
      // Premium is sold in the US only.
      ['netflix', 'netflix.standard-ads', ['netflix.standard-ads', 'netflix.standard']],
      ['crave', 'crave.standard', ['crave.standard', 'crave.premium']],
    ]);
  });

  it('prices every plan for the user, with every interval priced there', () => {
    const [, mullvad] = search({});
    if (mullvad.kind !== 'priced') throw new Error('Mullvad is sold in Canada');

    expect(mullvad.plans[0]).toMatchObject({ availability: 'offered', stale: false });
    expect(mullvad.plans[0].bestMonthlyEquivalent).toBeCloseTo(60 / 0.6372 / 12, 10);
    expect(mullvad.plans[0].pricing.map((price) => [price.interval, price.native])).toEqual([
      ['month', false],
      ['year', false],
    ]);
  });

  it('ranks name, alias, plan and feature matches as P8 says, with Best match by default', () => {
    const files = edited(catalog(), 'data/providers/proton.yaml', ['aliases'], ['proton vpn']);
    const results = search({ q: 'vpn' }, { catalog: regionData('CA', files) });

    expect(results.map((result) => [result.provider.id, result.relevance])).toEqual([
      ['mullvad', 2],
      ['proton', 3],
    ]);
    expect(
      search({ q: 'premium' }).map((result) => [result.provider.id, result.relevance]),
    ).toEqual([['crave', 4]]);
    expect(search({ q: '4k' }).map((result) => [result.provider.id, result.relevance])).toEqual([
      ['crave', 5],
    ]);
  });

  describe('filters', () => {
    const fourK = edited(
      edited(
        catalog(),
        'data/providers/netflix.yaml',
        ['plans', 0, 'features', 'video.quality'],
        '4k',
      ),
      'data/providers/netflix.yaml',
      ['plans', 1, 'features', 'video.quality'],
      '4k',
    );

    it('shows each provider’s cheapest 4k plan for a 4k filter', () => {
      const results = search(
        { features: ['video.quality=4k'] },
        { catalog: regionData('CA', fourK) },
      );

      expect(cards(results)).toEqual([
        ['netflix', 'netflix.standard-ads', ['netflix.standard-ads', 'netflix.standard']],
        ['crave', 'crave.premium', ['crave.premium']],
      ]);
    });

    it('leaves out converted prices with Native pricing only', () => {
      expect(cards(search({ nativeOnly: true }))).toEqual([
        // Duo is priced in USD only, and free is native everywhere.
        ['proton', 'proton.free', ['proton.free', 'proton.vpn-plus', 'proton.unlimited']],
        ['netflix', 'netflix.standard-ads', ['netflix.standard-ads', 'netflix.standard']],
        ['crave', 'crave.standard', ['crave.standard', 'crave.premium']],
      ]);
      expect(
        search({ nativeOnly: true })
          .flatMap((result) => (result.kind === 'priced' ? result.plans : []))
          .flatMap((plan) => plan.pricing)
          .every((price) => price.native),
      ).toBe(true);
    });

    it('keeps a category and a price range, on the monthly equivalent before tax', () => {
      expect(cards(search({ category: 'streaming', minPrice: 8, maxPrice: 19 }))).toEqual([
        // Crave's 119.99 a year is 10.00 a month.
        ['crave', 'crave.standard', ['crave.standard']],
        ['netflix', 'netflix.standard', ['netflix.standard']],
      ]);
    });

    it('keeps providers by their place in the lists', () => {
      const items = [item('netflix.standard'), item('crave.premium', { endDate: '2026-10-01' })];
      const ids = (activity: CatalogQuery['activity']) =>
        search({ activity }, { items }).map((result) => result.provider.id);

      expect(ids(['active'])).toEqual(['netflix']);
      expect(ids(['inactive'])).toEqual(['crave']);
      expect(ids(['not-listed'])).toEqual(['proton', 'mullvad']);
      expect(ids(['active', 'not-listed'])).toEqual(['proton', 'mullvad', 'netflix']);
      expect(ids([])).toHaveLength(4);
    });
  });

  describe('the plan shown', () => {
    it('is the user’s own when it matches, an active one first, and price sorts use it', () => {
      const own = search({}, { items: [item('netflix.standard')] });

      expect(cards(own).map(([id, shown]) => [id, shown])).toEqual([
        ['proton', 'proton.free'],
        ['mullvad', 'mullvad.vpn'],
        // Crave's 10.00 a month is less than Standard's 18.99.
        ['crave', 'crave.standard'],
        ['netflix', 'netflix.standard'],
      ]);
      expect(own.find((result) => result.provider.id === 'netflix')?.activity).toEqual({
        kind: 'active',
        lists: 1,
        listIds: [expect.any(String)],
        plans: [{ planId: 'netflix.standard', kind: 'active' }],
      });

      const items = [
        item('netflix.standard', { endDate: '2026-10-01' }),
        item('crave.standard', { endDate: '2026-10-01' }),
        item('crave.premium'),
      ];
      const shown = search({ category: 'streaming', sort: 'name' }, { items }).map(
        (result) => result.kind === 'priced' && result.shownPlanId,
      );
      expect(shown).toEqual(['crave.premium', 'netflix.standard']);
    });

    it('is the query’s plan when the card has it, over the user’s own (View in Search)', () => {
      const items = [item('netflix.standard-ads'), item('netflix.standard')];

      expect(cards(search({ q: 'netflix' }, { items }))[0]?.[1]).toBe('netflix.standard-ads');
      expect(cards(search({ q: 'netflix', plan: 'netflix.standard' }, { items }))[0]?.[1]).toBe(
        'netflix.standard',
      );
      // A plan the filters leave out isn't shown: the card shows the user's own that matches.
      expect(
        cards(
          search({ features: ['streaming.ad-free'], plan: 'netflix.standard-ads' }, { items }),
        )[0]?.[1],
      ).toBe('netflix.standard');
    });

    it('is the cheapest that matches when the user’s own doesn’t', () => {
      const results = search(
        { features: ['streaming.ad-free'] },
        { items: [item('netflix.standard-ads')] },
      );

      expect(cards(results)).toEqual([['netflix', 'netflix.standard', ['netflix.standard']]]);
    });
  });

  describe('where it’s sold', () => {
    const craveInCanada = edited(catalog(), 'data/providers/crave.yaml', ['availableIn'], ['CA']);

    it('gives a plan with no price in the user’s country its fallback price, marked unknown', () => {
      const [crave] = searchCatalog({ q: 'crave' }, american);
      if (crave.kind !== 'priced') throw new Error('Crave’s availability in the US is unknown');

      expect(crave.plans.map((plan) => plan.availability)).toEqual(['unknown', 'unknown']);
      expect(crave.plans[0].pricing[0]).toMatchObject({
        currency: 'USD',
        native: false,
        source: { region: 'CA', amount: 11.99, currency: 'CAD' },
      });
    });

    it('shows a provider that isn’t sold there, without prices, only when the text names it', () => {
      const context = { ...american, catalog: regionData('US', craveInCanada) };

      expect(searchCatalog({ q: 'crave' }, context)).toEqual([
        expect.objectContaining({ kind: 'not-offered', relevance: 1, matchedOn: ['name'] }),
      ]);
      expect(cards(searchCatalog({ q: 'crave', features: ['video.quality=4k'] }, context))).toEqual(
        [['crave', 'not offered', []]],
      );
      // A feature or a plan doesn't name it, and it has no price to filter on.
      expect(cards(searchCatalog({ q: '4k' }, context))).toEqual([
        ['netflix', 'netflix.premium', ['netflix.premium']],
      ]);
      expect(searchCatalog({ q: 'premium' }, context).map((result) => result.provider.id)).toEqual([
        'netflix',
      ]);
      expect(searchCatalog({ q: 'crave', maxPrice: 50 }, context)).toEqual([]);
      expect(searchCatalog({ q: 'crave', nativeOnly: true }, context)).toEqual([]);
      expect(searchCatalog({ q: 'crave', features: ['vpn.included'] }, context)).toEqual([]);
    });

    it('keeps only what’s sold there with Sold in: no fallback price, and no provider that isn’t sold', () => {
      // Crave has Canadian prices only, so its availability in the US is unknown.
      expect(searchCatalog({}, american).map((result) => result.provider.id)).toContain('crave');
      expect(
        searchCatalog({ soldOnly: true }, american).map((result) => result.provider.id),
      ).not.toContain('crave');
      expect(searchCatalog({ q: 'crave', soldOnly: true }, american)).toEqual([]);

      const context = { ...american, catalog: regionData('US', craveInCanada) };
      expect(searchCatalog({ q: 'crave', soldOnly: true }, context)).toEqual([]);

      // Every plan Netflix shows is priced in the US.
      const [netflix] = searchCatalog({ q: 'netflix', soldOnly: true }, american);
      if (netflix.kind !== 'priced') throw new Error('Netflix is sold in the US');
      expect(netflix.plans.every((plan) => plan.availability === 'offered')).toBe(true);
    });

    it('puts a provider that isn’t sold there after the priced ones in the price sorts', () => {
      const context = { ...american, catalog: regionData('US', craveInCanada) };
      // "v" is in Crave's and Mullvad VPN's names.
      const ids = (sort: CatalogQuery['sort']) =>
        searchCatalog({ q: 'v', sort }, context)
          .filter((result) => result.relevance === 2)
          .map((result) => result.provider.id);

      expect(ids('relevance')).toEqual(['mullvad', 'crave']);
      expect(ids('price_asc')).toEqual(['mullvad', 'crave']);
      expect(ids('price_desc')).toEqual(['mullvad', 'crave']);
      expect(ids('name')).toEqual(['crave', 'mullvad']);
    });
  });

  describe('resellers', () => {
    const amazonCa = 'https://www.amazon.ca/Mullvad-VPN-Devices-Protect-Security/dp/B092M5G1G7/';
    const files: CatalogSourceFile[] = [
      ...edited(
        edited(
          catalog(),
          'data/providers/mullvad.yaml',
          ['plans', 0, 'prices'],
          [
            { region: 'GLOBAL', currency: 'EUR', amount: 60, interval: 'year', intervalCount: 1 },
          ].map((price) => ({
            ...price,
            autoRenew: false,
            taxIncluded: { quote: 'Including VAT.' },
            lastVerified: '2026-10-20',
          })),
        ),
        'data/providers/mullvad.yaml',
        ['resellers'],
        [
          {
            reseller: 'amazon',
            approvedBy: {
              url: 'https://mullvad.net/en/help/partnerships-and-resellers',
              quotes: ['Amazon - CA'],
            },
            offers: [
              {
                plan: 'mullvad.vpn',
                prices: [
                  {
                    region: 'CA',
                    currency: 'CAD',
                    amount: 87,
                    interval: 'month',
                    intervalCount: 12,
                    autoRenew: false,
                    lastVerified: '2026-10-20',
                    sourceUrl: amazonCa,
                  },
                ],
              },
            ],
          },
        ],
      ),
      {
        file: 'data/resellers.yaml',
        data: [
          {
            id: 'amazon',
            name: 'Amazon',
            website: 'https://www.amazon.com',
            domains: ['amazon.ca'],
          },
        ],
      },
    ];

    it('lists the ones that sell a plan for less per month after the user’s sales tax', () => {
      const deals = (subdivision: string) => {
        const results = search(
          { q: 'mullvad' },
          {
            catalog: regionData('CA', files),
            settings: { country: 'CA', subdivision, currency: 'CAD' },
          },
        );
        return results.flatMap((result) =>
          result.kind === 'priced'
            ? result.plans.flatMap((plan) =>
                plan.deals.map((deal) => [deal.reseller.id, deal.link]),
              )
            : [],
        );
      };

      // €60 a year, tax included, is CA$94.16. Amazon's CA$87 is CA$91.35 in Alberta, CA$98.31 in Ontario.
      expect(deals('CA-AB')).toEqual([['amazon', amazonCa]]);
      expect(deals('CA-ON')).toEqual([]);
    });
  });

  describe('the user’s ranks', () => {
    // VPN Plus's 10 devices Needed, a VPN and 4K Wanted, Ad free Unwanted.
    const profileRanks = new Map([
      ['vpn.devices=6-10', 'needed'],
      ['vpn.included', 'wanted'],
      ['video.quality=4k', 'wanted'],
      ['streaming.ad-free', 'unwanted'],
    ] as const);

    it('counts each plan’s keys by the user’s ranks', () => {
      const proton = search({}, { profileRanks }).find((result) => result.provider.id === 'proton');
      const plans = proton?.kind === 'priced' ? proton.plans : [];
      expect(plans.find((plan) => plan.plan.id === 'proton.vpn-plus')?.rankCounts).toMatchObject({
        needed: 1,
        wanted: 1,
        unwanted: 0,
      });
      expect(plans.find((plan) => plan.plan.id === 'proton.free')?.rankCounts).toMatchObject({
        needed: 0,
        wanted: 1,
      });
      // Without ranks, nothing counts.
      const counted = search({}).flatMap((result) =>
        result.kind === 'priced' ? result.plans : [],
      );
      expect(
        counted.every((plan) => Object.values(plan.rankCounts).every((count) => count === 0)),
      ).toBe(true);
    });

    it('sorts the best fits first, showing each provider’s best fit, the cheaper of two that fit as well', () => {
      expect(
        cards(search({ sort: 'ranks' }, { profileRanks })).map(([id, shown]) => [id, shown]),
      ).toEqual([
        // 10 devices and a VPN; Unlimited fits as well, but costs more.
        ['proton', 'proton.vpn-plus'],
        // A VPN each, and Mullvad is the cheaper.
        ['mullvad', 'mullvad.vpn'],
        ['crave', 'crave.premium'],
        // Standard's Ad free is Unwanted.
        ['netflix', 'netflix.standard-ads'],
      ]);
    });

    it('still shows the user’s own plan, by its own fit', () => {
      const results = search(
        { sort: 'ranks' },
        { profileRanks, items: [item('netflix.standard')] },
      );
      expect(cards(results).at(-1)?.slice(0, 2)).toEqual(['netflix', 'netflix.standard']);
    });

    it('sorts by price with no ranks', () => {
      expect(cards(search({ sort: 'ranks' })).map(([id]) => id)).toEqual(
        cards(search({})).map(([id]) => id),
      );
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  formatCatalogIssue,
  providerSchema,
  readCatalogSource,
  regionSnapshot,
  resellerDeals,
  validateCatalog,
  type CatalogSnapshot,
  type CatalogSourceFile,
  type DealContext,
  type FxRates,
  type ResellerListing,
  type ResellerPrice,
} from '../../src';
import { catalog, edited, today } from './catalog-files';
import { at, issues, pngBytes, withValue } from './helpers';

// Mullvad's resellers as read on 2026-10-26 (BLUEPRINT §4.9), on the fixture catalog: Amazon.ca's scratch cards, a
// Swedish shop, ProxyStore's tax-included prices everywhere and SerialCart's "excl. VAT" ones.

const mullvadFile = 'data/providers/mullvad.yaml';
const resellersFile = 'data/resellers.yaml';
const approval = 'https://mullvad.net/en/help/partnerships-and-resellers';
const amazonCa = 'https://www.amazon.ca/Mullvad-VPN-Devices-Protect-Security/dp/B092M5G1G7/';

const registry = [
  { id: 'amazon', name: 'Amazon', website: 'https://www.amazon.com', domains: ['amazon.ca'] },
  { id: 'webhallen', name: 'Webhallen', website: 'https://www.webhallen.com' },
  { id: 'proxystore', name: 'ProxyStore', website: 'https://proxystore.de' },
  { id: 'serialcart', name: 'SerialCart', website: 'https://serialcart.com' },
];

function price(
  region: string,
  currency: string,
  amount: number,
  interval: ResellerPrice['interval'],
  intervalCount: number,
  sourceUrl: string,
  extra: Partial<ResellerPrice> = {},
): ResellerPrice {
  return {
    region,
    currency,
    amount,
    interval,
    intervalCount,
    autoRenew: false,
    lastVerified: '2026-10-20',
    sourceUrl,
    ...extra,
  };
}

const included = { taxIncluded: { quote: 'It does not affect the price or the goods.' } };
const excluded = { taxExcluded: { quote: 'excl. VAT' } };

function listing(reseller: string, quote: string, prices: ResellerPrice[]): ResellerListing {
  return {
    reseller,
    approvedBy: { url: approval, quotes: [quote] },
    offers: [{ plan: 'mullvad.vpn', prices }],
  };
}

const listings: ResellerListing[] = [
  listing('amazon', 'Amazon - CA', [
    price('CA', 'CAD', 44, 'month', 6, amazonCa),
    price('CA', 'CAD', 87, 'month', 12, amazonCa),
  ]),
  listing('webhallen', 'we’ve partnered with Webhallen', [
    price('SE', 'SEK', 299, 'month', 6, 'https://www.webhallen.com/se/product/267703'),
    price('SE', 'SEK', 549, 'month', 12, 'https://www.webhallen.com/se/product/267706'),
  ]),
  listing('proxystore', 'we’ve partnered with ProxyStore', [
    price('GLOBAL', 'EUR', 27, 'month', 6, 'https://digitalgoods.proxystore.de/en', included),
    price('GLOBAL', 'EUR', 54, 'month', 12, 'https://digitalgoods.proxystore.de/en', included),
  ]),
  listing('serialcart', 'a distribution partnership with SerialCart', [
    price(
      'GLOBAL',
      'USD',
      35.63,
      'month',
      6,
      'https://serialcart.com/purchase/mullvad-vpn',
      excluded,
    ),
    price(
      'GLOBAL',
      'USD',
      71.26,
      'year',
      1,
      'https://serialcart.com/purchase/mullvad-vpn',
      excluded,
    ),
  ]),
];

/** Mullvad's own price, which includes tax everywhere. */
const mullvadPrices = [
  { region: 'GLOBAL', currency: 'EUR', amount: 5, interval: 'month', intervalCount: 1 },
  { region: 'GLOBAL', currency: 'EUR', amount: 60, interval: 'year', intervalCount: 1 },
].map((own) => ({
  ...own,
  autoRenew: false,
  taxIncluded: { quote: 'Including VAT.' },
  lastVerified: '2026-10-20',
}));

/** The fixture catalog with Mullvad's resellers, their registry and their logos. */
function withResellers(
  resellers: unknown = listings,
  file: unknown = registry,
  logos = registry.map(({ id }) => id),
): CatalogSourceFile[] {
  const mullvad = edited(
    edited(catalog(), mullvadFile, ['plans', 0, 'prices'], mullvadPrices),
    mullvadFile,
    ['resellers'],
    resellers,
  );
  return [
    ...mullvad,
    { file: resellersFile, data: file },
    ...logos.map((id) => ({ file: `data/logos/${id}.png`, bytes: pngBytes(64, 64) })),
  ];
}

function messages(files: readonly CatalogSourceFile[]): string[] {
  return validateCatalog(files, today).map(
    (issue) => `${issue.severity === 'warning' ? 'warning: ' : ''}${formatCatalogIssue(issue)}`,
  );
}

function mullvadData(files: readonly CatalogSourceFile[]): unknown {
  const source = files.find(({ file }) => file === mullvadFile);
  if (!source || !('data' in source)) throw new Error('No Mullvad file');
  return source.data;
}

function snapshot(files = withResellers()): CatalogSnapshot {
  const data = buildCatalogData(readCatalogSource(files), 'https://sub.simplely.ca/icons/');
  return {
    data,
    meta: {
      catalogVersion: '1234567',
      generatedAt: '2026-10-26T12:00:00Z',
      regions: ['CA', 'GLOBAL', 'US'],
      counts: { providers: 4, plans: 9, addOns: 2, bundles: 1, features: 11 },
    },
  };
}

describe('a provider’s resellers', () => {
  const mullvad = mullvadData(withResellers());

  it('are part of the provider schema', () => {
    expect(issues(providerSchema, mullvad)).toEqual([]);
  });

  it('sell the file’s own plans, one offer per plan and each reseller once', () => {
    expect(
      issues(
        providerSchema,
        withValue(mullvad, ['resellers', 0, 'offers', 0, 'plan'], 'mullvad.plus'),
      ),
    ).toEqual([
      'resellers.0.offers.0.plan: "mullvad.plus" isn\'t a plan in this file (mullvad.vpn)',
    ]);
    const twice = withValue(
      mullvad,
      ['resellers', 0, 'offers', 1],
      at(mullvad, 'resellers', 0, 'offers', 0),
    );
    expect(issues(providerSchema, twice)).toEqual([
      'resellers.0.offers.1.plan: "mullvad.vpn" is listed more than once',
    ]);
    expect(
      issues(providerSchema, withValue(mullvad, ['resellers', 1, 'reseller'], 'amazon')),
    ).toEqual(['resellers.1.reseller: "amazon" is listed more than once']);
  });

  it('link every price to the reseller’s page, which either includes tax or leaves it to be added', () => {
    expect(
      issues(
        providerSchema,
        withValue(mullvad, ['resellers', 0, 'offers', 0, 'prices', 0, 'sourceUrl'], undefined),
      ),
    ).toEqual(['resellers.0.offers.0.prices.0.sourceUrl: Use a full https:// URL']);
    const both = withValue(mullvad, ['resellers', 2, 'offers', 0, 'prices', 0, 'taxExcluded'], {
      quote: 'excl. VAT',
    });
    expect(issues(providerSchema, both)).toEqual([
      'resellers.2.offers.0.prices.0.taxExcluded: A price includes tax or excludes it: keep taxIncluded or taxExcluded',
    ]);
  });

  it('need an approval quote and at least one offer', () => {
    expect(
      issues(providerSchema, withValue(mullvad, ['resellers', 0, 'approvedBy', 'quotes'], [])),
    ).toEqual(['resellers.0.approvedBy.quotes: Quote the words that name it']);
    expect(issues(providerSchema, withValue(mullvad, ['resellers', 0, 'offers'], []))).toEqual([
      'resellers.0.offers: List at least one offer',
    ]);
  });
});

describe('validateCatalog with resellers', () => {
  it('accepts resellers the provider names, with their prices on their own pages', () => {
    expect(messages(withResellers())).toEqual([]);
  });

  it('needs every listed reseller in data/resellers.yaml', () => {
    const files = withResellers(withValue(listings, [0, 'reseller'], 'amazn'));
    expect(messages(files)).toContain(
      'data/providers/mullvad.yaml resellers.0.reseller: "amazn" isn\'t in data/resellers.yaml (did you mean amazon?)',
    );
  });

  it('takes the approval only from the provider’s own site', () => {
    const files = withResellers(
      withValue(
        listings,
        [3, 'approvedBy', 'url'],
        'https://serialcart.com/authorized-distributor',
      ),
    );
    expect(messages(files)).toEqual([
      "data/providers/mullvad.yaml resellers.3.approvedBy.url: Must be a page of Mullvad VPN's own sites, on mullvad.net: only the resellers it names are listed",
    ]);
  });

  it('takes it from one of the provider’s other sites too, once its domains name them (M1.15)', () => {
    const blog = withValue(
      listings,
      [3, 'approvedBy', 'url'],
      'https://mullvadvpn.example/blog/resellers',
    );
    expect(messages(withResellers(blog))).toEqual([
      "data/providers/mullvad.yaml resellers.3.approvedBy.url: Must be a page of Mullvad VPN's own sites, on mullvad.net: only the resellers it names are listed",
    ]);
    expect(
      messages(edited(withResellers(blog), mullvadFile, ['domains'], ['mullvadvpn.example'])),
    ).toEqual([]);
  });

  it('takes prices only from the reseller’s own pages, on its website or its listed domains', () => {
    const files = withResellers(
      withValue(
        listings,
        [0, 'offers', 0, 'prices', 0, 'sourceUrl'],
        'https://www.amazon.co.uk/dp/B092M55HJ2',
      ),
    );
    expect(messages(files)).toEqual([
      "data/providers/mullvad.yaml resellers.0.offers.0.prices.0.sourceUrl: Must be Amazon's page, on amazon.com or amazon.ca: if the domain is theirs, add it to their domains in data/resellers.yaml",
    ]);
  });

  it('checks reseller prices like any other', () => {
    const files = withResellers(withValue(listings, [1, 'offers', 0, 'prices', 0, 'region'], 'UK'));
    expect(messages(files).join('\n')).toContain('resellers.1.offers.0.prices.0.region:');
  });

  it('keeps reseller and provider ids apart, since their logos share a folder', () => {
    const files = withResellers(listings, [
      ...registry,
      { id: 'netflix', name: 'Netflix', website: 'https://www.netflix.com' },
    ]);
    expect(messages(files)).toContain(
      'data/resellers.yaml 4.id: "netflix" is already the id of a provider in data/providers/netflix.yaml',
    );
  });

  it('warns about a reseller without a logo, and one no provider lists', () => {
    const extra = [...registry, { id: 'inet', name: 'Inet', website: 'https://www.inet.se' }];
    expect(
      messages(withResellers(listings, extra, ['amazon', 'webhallen', 'serialcart', 'inet'])),
    ).toEqual([
      'warning: data/resellers.yaml 4.id: No provider lists this reseller: add it to the resellers of the providers whose plans it sells, or remove it',
      'warning: data/resellers.yaml 2.id: No logo, so the app shows a letter: run npm run data:icons to fetch data/logos/proxystore.png',
    ]);
  });

  it('accepts a logo named after a reseller', () => {
    expect(messages(withResellers()).filter((message) => message.includes('logos'))).toEqual([]);
  });

  it('reports a broken resellers file once, without flagging the providers that list its resellers', () => {
    const files = withResellers(listings, [
      { id: 'Amazon', name: 'Amazon', website: 'https://www.amazon.com' },
    ]);
    expect(messages(files).filter((message) => !message.startsWith('warning'))).toEqual([
      'data/resellers.yaml 0.id: Use a kebab-case id: lowercase letters and digits, joined by single hyphens (disney-plus)',
    ]);
  });

  it('needs no resellers file when no provider lists any', () => {
    expect(messages(catalog())).toEqual([]);
  });
});

describe('the snapshot', () => {
  it('lists the resellers by id, each with its icon when it has a logo', () => {
    const data = snapshot(withResellers(listings, registry, ['amazon', 'serialcart'])).data;
    expect(data.resellers).toEqual([
      {
        id: 'amazon',
        name: 'Amazon',
        website: 'https://www.amazon.com',
        iconUrl: 'https://sub.simplely.ca/icons/amazon.webp',
        domains: ['amazon.ca'],
      },
      { id: 'proxystore', name: 'ProxyStore', website: 'https://proxystore.de' },
      {
        id: 'serialcart',
        name: 'SerialCart',
        website: 'https://serialcart.com',
        iconUrl: 'https://sub.simplely.ca/icons/serialcart.webp',
      },
      { id: 'webhallen', name: 'Webhallen', website: 'https://www.webhallen.com' },
    ]);
    expect(data.providers.find(({ id }) => id === 'mullvad')?.resellers).toEqual(listings);
  });

  it('has none without a resellers file', () => {
    expect(snapshot(catalog()).data.resellers).toEqual([]);
  });

  describe('in a region’s file', () => {
    const resellersIn = (region: string) =>
      regionSnapshot(snapshot(), region)
        .data.providers.find(({ id }) => id === 'mullvad')
        ?.resellers?.map(
          ({ reseller, offers }) =>
            `${reseller}: ${offers[0].prices.map((p) => `${p.region} ${p.amount}`).join(', ')}`,
        );

    it('keeps the prices a buyer there can use: theirs, their group’s and GLOBAL ones', () => {
      expect(resellersIn('CA')).toEqual([
        'amazon: CA 44, CA 87',
        'proxystore: GLOBAL 27, GLOBAL 54',
        'serialcart: GLOBAL 35.63, GLOBAL 71.26',
      ]);
      expect(resellersIn('SE')).toEqual([
        'webhallen: SE 299, SE 549',
        'proxystore: GLOBAL 27, GLOBAL 54',
        'serialcart: GLOBAL 35.63, GLOBAL 71.26',
      ]);
    });

    it('keeps its members’ prices in a group’s file, which members without their own use', () => {
      expect(resellersIn('EU')?.[0]).toBe('webhallen: SE 299, SE 549');
    });

    it('leaves the key out when nothing is left', () => {
      const onlyAmazon = withResellers([listings[0]]);
      const mullvad = regionSnapshot(snapshot(onlyAmazon), 'SE').data.providers.find(
        ({ id }) => id === 'mullvad',
      );
      expect(mullvad).not.toHaveProperty('resellers');
    });
  });
});

describe('resellerDeals', () => {
  const data = snapshot().data;
  const mullvad = data.providers.find(({ id }) => id === 'mullvad');
  if (!mullvad) throw new Error('No Mullvad');

  /** The ECB's rates on 2026-10-26, per euro. */
  const fx: FxRates = {
    base: 'EUR',
    date: '2026-10-26',
    source: 'European Central Bank via Frankfurter',
    rates: { CAD: 1.5695, GBP: 0.8382, SEK: 11.1385, USD: 1.1188 },
  };

  const canadian = (subdivision: string): DealContext => ({
    region: 'CA',
    currency: 'CAD',
    fx,
    taxPlace: { country: 'CA', subdivision },
  });

  const deals = (context: DealContext) =>
    resellerDeals(mullvad, 'mullvad.vpn', data.resellers, context).map(
      (deal) =>
        `${deal.reseller.id} ${deal.price.amount.toFixed(2)} ${deal.price.currency} / ${deal.price.intervalCount} ${deal.price.interval}`,
    );

  it('compares after sales tax: Amazon.ca adds HST, and Mullvad’s own price includes tax', () => {
    // €60 a year is CA$94.17. Amazon's CA$87 is CA$98.31 in Ontario, CA$91.35 in Alberta.
    // ProxyStore's €27 for 6 months and €54 for 12 cost the same a month: the shorter one is shown.
    expect(deals(canadian('CA-ON'))).toEqual(['proxystore 42.38 CAD / 6 month']);
    expect(deals(canadian('CA-AB'))).toEqual([
      'proxystore 42.38 CAD / 6 month',
      'amazon 87.00 CAD / 12 month',
    ]);
  });

  it('gives the cost and saving per month with tax, and the page to buy from', () => {
    const [proxystore, amazon] = resellerDeals(
      mullvad,
      'mullvad.vpn',
      data.resellers,
      canadian('CA-AB'),
    );
    expect(amazon.link).toBe(amazonCa);
    expect(amazon.monthlyCost).toBeCloseTo((87 * 1.05) / 12);
    expect(amazon.monthlySaving).toBeCloseTo((60 * 1.5695) / 12 - (87 * 1.05) / 12);
    expect(amazon.reseller).toMatchObject({ id: 'amazon', name: 'Amazon' });
    expect(proxystore.monthlyCost).toBeCloseTo((54 * 1.5695) / 12);
  });

  it('offers only what a reseller sells where the buyer is', () => {
    expect(deals({ region: 'SE', currency: 'SEK', fx, taxPlace: { country: 'SE' } })).toEqual([
      'webhallen 549.00 SEK / 12 month',
      'proxystore 300.74 SEK / 6 month',
    ]);
  });

  it('compares a price that leaves VAT to be added only where the app knows the tax', () => {
    // SerialCart's "excl. VAT" in the UK: left out. In the US, with an 8% rate: US$76.96 a year against US$67.13.
    expect(deals({ region: 'GB', currency: 'GBP', fx, taxPlace: { country: 'GB' } })).toEqual([
      'proxystore 22.63 GBP / 6 month',
    ]);
    expect(
      deals({ region: 'US', currency: 'USD', fx, taxPlace: { country: 'US', salesTaxPercent: 8 } }),
    ).toEqual(['proxystore 30.21 USD / 6 month']);
    const cheaper = withResellers(withValue(listings, [3, 'offers', 0, 'prices', 1, 'amount'], 55));
    const sold = snapshot(cheaper).data;
    const us = resellerDeals(
      sold.providers.find(({ id }) => id === 'mullvad')!,
      'mullvad.vpn',
      sold.resellers,
      {
        region: 'US',
        currency: 'USD',
        fx,
        taxPlace: { country: 'US', salesTaxPercent: 8 },
      },
    );
    // US$55 a year is US$4.95 a month with tax, under ProxyStore's US$5.03.
    expect(us.map((deal) => deal.reseller.id)).toEqual(['serialcart', 'proxystore']);
  });

  it('compares nothing without rates, and nothing for another plan', () => {
    expect(
      deals({ region: 'CA', currency: 'CAD', taxPlace: { country: 'CA', subdivision: 'CA-AB' } }),
    ).toEqual([]);
    expect(resellerDeals(mullvad, 'mullvad.plus', data.resellers, canadian('CA-AB'))).toEqual([]);
  });

  it('leaves out a reseller the registry doesn’t have, and one that costs the same', () => {
    const others = data.resellers.filter(({ id }) => id !== 'proxystore');
    expect(resellerDeals(mullvad, 'mullvad.vpn', others, canadian('CA-ON'))).toEqual([]);
    // CA$89.69 is CA$94.17 a year with Alberta's 5%: exactly Mullvad's own.
    const same = withResellers(
      withValue(
        listings,
        [0, 'offers', 0, 'prices'],
        [price('CA', 'CAD', (60 * 1.5695) / 1.05, 'month', 12, amazonCa)],
      ),
    );
    const sameData = snapshot(same).data;
    const amazon = resellerDeals(
      sameData.providers.find(({ id }) => id === 'mullvad')!,
      'mullvad.vpn',
      sameData.resellers,
      canadian('CA-AB'),
    );
    expect(amazon.map((deal) => deal.reseller.id)).toEqual(['proxystore']);
  });
});

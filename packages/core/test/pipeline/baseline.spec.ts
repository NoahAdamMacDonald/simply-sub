import { describe, expect, it } from 'vitest';
import {
  baselineDiff,
  baselineLines,
  baselinePath,
  citedFacts,
  citedPages,
  pageShowsRate,
  ratesIn,
  readBaseline,
  servedCovers,
  writeBaseline,
  type Bundle,
  type Provider,
} from '../../src';

describe('baselinePath', () => {
  it('names the file after the host and the path, with a hash so two URLs never share one', () => {
    expect(baselinePath('https://help.netflix.com/en/node/24926/ca')).toMatch(
      /^data\/baselines\/help\.netflix\.com\/en-node-24926-ca-[0-9a-f]{8}\.txt$/,
    );
    expect(baselinePath('https://www.crave.ca/')).toMatch(
      /^data\/baselines\/crave\.ca\/index-[0-9a-f]{8}\.txt$/,
    );
    expect(baselinePath('https://example.com/a/b')).not.toBe(
      baselinePath('https://example.com/a-b'),
    );
  });
});

describe('baseline files', () => {
  it('write and read back', () => {
    const baseline = {
      url: 'https://mullvad.net/en/pricing',
      method: 'fetch' as const,
      saved: '2026-10-28',
      lines: ['€5 /month', 'Including VAT.'],
    };
    const text = writeBaseline(baseline);
    expect(text).toBe(
      'url: https://mullvad.net/en/pricing\nmethod: fetch\nsaved: 2026-10-28\n\n€5 /month\nIncluding VAT.\n',
    );
    expect(readBaseline(text)).toEqual(baseline);
    expect(readBaseline('url: x\nmethod: telepathy\nsaved: 2026-10-28\n\nx')).toBeUndefined();
  });

  it('keep a page’s lines, white space collapsed, empty ones left out', () => {
    expect(baselineLines('  Plans \n\n Standard:  $18.99 \r\n')).toEqual([
      'Plans',
      'Standard: $18.99',
    ]);
  });
});

describe('baselineDiff', () => {
  it('finds the lines gained and lost, repeats counted, order ignored', () => {
    expect(baselineDiff(['a', 'b', 'b', 'c'], ['c', 'b', 'a', 'd'])).toEqual({
      added: ['d'],
      removed: ['b'],
    });
    expect(baselineDiff(['a', 'b'], ['b', 'a'])).toEqual({ added: [], removed: [] });
  });
});

describe('servedCovers', () => {
  const shown =
    'Choose your plan\nStandard is $18.99 a month in Canada\nPremium is $23.99 a month in Canada';

  it('takes the HTML as served when it has what the page shows', () => {
    expect(servedCovers(`Menu ${shown} Footer`, shown)).toBe(true);
  });

  it('wants a browser when the page’s scripts fill it in', () => {
    expect(servedCovers('Loading… Choose your plan', shown)).toBe(false);
  });
});

const provider = {
  id: 'mullvad',
  name: 'Mullvad VPN',
  website: 'https://mullvad.net',
  category: 'vpn',
  spendCategory: 'software',
  cancelUrl: 'https://mullvad.net/en/help/refunds',
  sources: { pricing: 'https://mullvad.net/en/pricing' },
  acceptedNetworks: {
    GLOBAL: { networks: ['visa'], url: 'https://mullvad.net/en/help/payment', quotes: ['Visa'] },
  },
  plans: [
    {
      id: 'mullvad.vpn',
      name: 'Mullvad VPN',
      link: 'https://mullvad.net/en/pricing',
      features: {},
      prices: [
        {
          region: 'GLOBAL',
          currency: 'EUR',
          amount: 5,
          interval: 'month',
          intervalCount: 1,
          autoRenew: false,
          taxIncluded: { quote: 'Including VAT.' },
          lastVerified: '2026-10-26',
          sourceUrl: 'https://mullvad.net/en/pricing',
        },
      ],
    },
  ],
  policies: {
    links: [{ name: 'Terms of service', url: 'https://mullvad.net/en/help/terms-service' }],
    ratings: [
      {
        topic: 'billing.refunds',
        tier: 'great',
        reason: 'You can get unused time back.',
        sources: [{ url: 'https://mullvad.net/en/help/terms-service', quote: 'refund' }],
        lastVerified: '2026-10-27',
      },
    ],
  },
} as Provider;

const bundle = {
  id: 'bundle.mullvad-x',
  name: 'Mullvad and X',
  soldBy: 'mullvad',
  includes: ['mullvad.vpn', 'x.plan'],
  link: 'https://mullvad.net/en/bundle',
  prices: [
    {
      region: 'GLOBAL',
      currency: 'EUR',
      amount: 9,
      interval: 'month',
      intervalCount: 1,
      autoRenew: true,
      lastVerified: '2026-10-26',
      sourceUrl: 'https://mullvad.net/en/pricing',
    },
  ],
} as Bundle;

describe('citedPages', () => {
  it('lists every page the catalog cites, pricing before policies', () => {
    expect(citedPages([provider], [bundle])).toEqual([
      { url: 'https://mullvad.net/en/help/payment', type: 'pricing', owners: ['mullvad'] },
      { url: 'https://mullvad.net/en/help/terms-service', type: 'policies', owners: ['mullvad'] },
      {
        url: 'https://mullvad.net/en/pricing',
        type: 'pricing',
        owners: ['mullvad', 'bundle.mullvad-x'],
      },
    ]);
  });

  it('takes the policies’ pages from their index, as the nightly bot does with D1’s providers (M11.8)', () => {
    const asStored = { ...provider, policies: undefined };
    const shared = 'https://example.com/group-privacy';
    expect(
      citedPages([asStored], [], {
        providers: {
          mullvad: { links: ['https://mullvad.net/en/help/terms-service'], shared: ['group'] },
        },
        sets: { group: { links: [shared] } },
      }).filter(({ type }) => type === 'policies'),
    ).toEqual([
      { url: shared, type: 'policies', owners: ['mullvad'] },
      { url: 'https://mullvad.net/en/help/terms-service', type: 'policies', owners: ['mullvad'] },
    ]);
    expect(citedPages([asStored], []).filter(({ type }) => type === 'policies')).toEqual([]);
  });
});

describe('citedPages, for finance accounts (M11.14)', () => {
  it('cites an account’s posted rates as pricing, and its protection’s page as policies', () => {
    const bank = {
      ...provider,
      id: 'example-bank',
      plans: [
        {
          ...provider.plans[0],
          account: {
            kind: 'savings',
            currency: 'CAD',
            rates: {
              follows: 'none',
              applies: 'whole',
              tiers: [{ from: 0, rate: 2 }],
              sourceUrl: 'https://example.com/rates',
              lastVerified: '2026-10-20',
            },
            protection: {
              insurer: 'cdic',
              held: 'own-name',
              url: 'https://example.com/cdic',
              quotes: ['Protected by CDIC.'],
              lastVerified: '2026-10-20',
            },
          },
        },
      ],
    } as Provider;
    const pages = citedPages([bank], []);
    expect(pages).toContainEqual({
      url: 'https://example.com/rates',
      type: 'pricing',
      owners: ['example-bank'],
    });
    expect(pages).toContainEqual({
      url: 'https://example.com/cdic',
      type: 'policies',
      owners: ['example-bank'],
    });
  });
});

describe('a plan’s soldIn and notSoldIn pages (M11.20)', () => {
  const where = {
    ...provider,
    plans: [
      {
        ...provider.plans[0],
        soldIn: [
          {
            regions: ['CA'],
            url: 'https://mullvad.net/en/help/where',
            quotes: ['Sold in Canada'],
            lastVerified: '2026-11-13',
          },
        ],
        notSoldIn: [
          {
            regions: ['US'],
            url: 'https://mullvad.net/en/help/where',
            quotes: ['Not available'],
            lastVerified: '2026-11-13',
          },
          {
            regions: ['GB'],
            url: 'https://mullvad.net/en/help/gb',
            quotes: ['Not sold in the UK'],
            lastVerified: '2026-11-13',
          },
        ],
      },
    ],
  } as Provider;

  it('cites their pages as pricing', () => {
    const pages = citedPages([where], []);
    expect(pages).toContainEqual({
      url: 'https://mullvad.net/en/help/where',
      type: 'pricing',
      owners: ['mullvad'],
    });
    expect(pages).toContainEqual({
      url: 'https://mullvad.net/en/help/gb',
      type: 'pricing',
      owners: ['mullvad'],
    });
  });

  it('gives their quotes on each page', () => {
    expect(citedFacts([where], [], 'https://mullvad.net/en/help/where').quotes).toEqual([
      'Sold in Canada',
      'Not available',
    ]);
    expect(citedFacts([where], [], 'https://mullvad.net/en/help/gb').quotes).toEqual([
      'Not sold in the UK',
    ]);
  });
});

describe('ratesIn and pageShowsRate (M11.14)', () => {
  it('reads every rate a page writes, in percent', () => {
    const text = 'Earn 2.25% on savings, 2,5 % in Quebec, up to 4% bonus, 12.5% on cards';
    expect(ratesIn(text).map((mention) => mention.rate)).toEqual([2.25, 2.5, 4, 12.5]);
    expect(text.slice(ratesIn(text)[3].index)).toBe('12.5% on cards');
  });

  it('finds a rate near what the page calls the account, written any way', () => {
    const text = 'High Interest Savings: 2.250% a year. Chequing: 0.05%.';
    expect(pageShowsRate(text, 2.25, ['High Interest Savings'])).toBe(true);
    expect(pageShowsRate(text, 2.5, ['High Interest Savings'])).toBe(false);
    // 2.25 inside 12.25% isn't it.
    expect(pageShowsRate('Card rate 12.25%', 2.25, [])).toBe(false);
  });
});

describe('citedFacts', () => {
  it('collects the quotes and prices the catalog rests on a page', () => {
    expect(citedFacts([provider], [bundle], 'https://mullvad.net/en/pricing')).toEqual({
      quotes: ['Including VAT.'],
      prices: [
        {
          amount: 5,
          currency: 'EUR',
          intervalCount: 1,
          names: ['Mullvad VPN', 'Mullvad VPN Mullvad VPN'],
        },
        { amount: 9, currency: 'EUR', intervalCount: 1, names: ['Mullvad and X'] },
      ],
    });
    expect(citedFacts([provider], [], 'https://mullvad.net/en/help/terms-service').quotes).toEqual([
      'refund',
    ]);
  });
});

describe('the provider facts’ pages (M11.5)', () => {
  const withFacts = {
    ...provider,
    currencies: [
      {
        codes: ['EUR', 'CAD'],
        methods: ['cash'],
        page: 'Terms of service',
        url: 'https://mullvad.net/en/help/terms-service',
        quotes: ['cash in bills (EUR, CAD)'],
      },
    ],
    renewalAnchor: {
      kind: 'not-stated',
      pages: ['https://mullvad.net/en/help/billing'],
      lastVerified: '2026-10-27',
    },
    sourceRepo: {
      url: 'https://github.com/mullvad/mullvadvpn-app',
      page: { name: 'Open source', url: 'https://mullvad.net/en/open-source' },
      quotes: ['Code is open source'],
      lastVerified: '2026-10-27',
    },
  } as Provider;

  it('cites the currencies’ page as pricing, and the renewal day’s and source code’s as policies', () => {
    expect(citedPages([withFacts], []).map(({ url, type }) => `${type} ${url}`)).toEqual([
      'policies https://mullvad.net/en/help/billing',
      'pricing https://mullvad.net/en/help/payment',
      'pricing https://mullvad.net/en/help/terms-service',
      'policies https://mullvad.net/en/open-source',
      'pricing https://mullvad.net/en/pricing',
    ]);
  });

  it('checks their quotes on their pages', () => {
    expect(citedFacts([withFacts], [], 'https://mullvad.net/en/help/terms-service').quotes).toEqual(
      ['cash in bills (EUR, CAD)', 'refund'],
    );
    expect(citedFacts([withFacts], [], 'https://mullvad.net/en/open-source').quotes).toEqual([
      'Code is open source',
    ]);
    const stated = {
      ...withFacts,
      renewalAnchor: {
        kind: 'same-date',
        page: 'Billing',
        url: 'https://mullvad.net/en/help/billing',
        quotes: ['the date you signed up'],
        lastVerified: '2026-10-27',
      },
    } as Provider;
    expect(citedFacts([stated], [], 'https://mullvad.net/en/help/billing').quotes).toEqual([
      'the date you signed up',
    ]);
  });
});

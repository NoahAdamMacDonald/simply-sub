import { describe, expect, it } from 'vitest';
import {
  baselineDiff,
  baselineLines,
  baselinePath,
  citedFacts,
  citedPages,
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
        topic: 'billing.cancel-refunds',
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

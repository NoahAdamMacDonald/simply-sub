import { describe, expect, it } from 'vitest';
import { bundleFeatures, bundleSavings, type Feature, type PickedPrice } from '../../src';

const registry = [
  {
    id: 'video.quality',
    name: 'Video quality',
    category: 'streaming',
    type: 'enum',
    values: [
      { id: '720p', name: '720p (HD)' },
      { id: '1080p', name: '1080p (Full HD)' },
      { id: '4k', name: '4K (Ultra HD)' },
    ],
  },
  { id: 'streaming.ad-free', name: 'Ad free', category: 'streaming', type: 'boolean' },
  {
    id: 'streaming.concurrent-streams',
    name: 'Simultaneous streams',
    category: 'streaming',
    type: 'number',
  },
  {
    id: 'streaming.live',
    name: 'Live TV and sports',
    category: 'streaming',
    type: 'set',
    values: [
      { id: 'tv-channels', name: 'Live TV channels' },
      { id: 'sports', name: 'Live sports' },
    ],
  },
] satisfies Feature[];

describe('bundleFeatures', () => {
  it("ORs booleans, takes the higher number or enum value and merges sets, in the order they're first listed", () => {
    const union = bundleFeatures(
      [
        {
          features: {
            'video.quality': '4k',
            'streaming.ad-free': false,
            'streaming.concurrent-streams': 2,
            'streaming.live': ['sports'],
          },
        },
        {
          features: {
            'streaming.live': ['tv-channels', 'sports'],
            'video.quality': '1080p',
            'streaming.concurrent-streams': 4,
            'streaming.ad-free': true,
          },
        },
      ],
      registry,
    );

    expect(union).toEqual({
      'video.quality': '4k',
      'streaming.ad-free': true,
      'streaming.concurrent-streams': 4,
      'streaming.live': ['sports', 'tv-channels'],
    });
    expect(Object.keys(union)).toEqual([
      'video.quality',
      'streaming.ad-free',
      'streaming.concurrent-streams',
      'streaming.live',
    ]);
  });

  it('puts unlimited above any number, and keeps what only one plan lists', () => {
    expect(
      bundleFeatures(
        [
          { features: { 'streaming.concurrent-streams': 'unlimited', 'video.quality': '720p' } },
          { features: { 'streaming.concurrent-streams': 6, 'streaming.ad-free': false } },
        ],
        registry,
      ),
    ).toEqual({
      'streaming.concurrent-streams': 'unlimited',
      'video.quality': '720p',
      'streaming.ad-free': false,
    });
  });
});

function picked(
  amount: number,
  interval: PickedPrice['interval'] = 'month',
  currency = 'CAD',
): PickedPrice {
  return {
    interval,
    intervalCount: 1,
    amount,
    currency,
    monthlyEquivalent: interval === 'year' ? amount / 12 : amount,
    autoRenew: true,
    native: true,
    source: { region: 'CA', amount, currency },
  };
}

const offered = (...pricing: PickedPrice[]) => ({ pricing, offered: true });

describe('bundleSavings', () => {
  it("subtracts the bundle's price from the plans' on each interval they share", () => {
    const savings = bundleSavings(offered(picked(29.25), picked(290, 'year')), [
      offered(picked(16.99), picked(169.99, 'year')),
      offered(picked(22), picked(220, 'year')),
    ]);

    expect(savings).toEqual([
      {
        interval: 'month',
        intervalCount: 1,
        standaloneTotal: expect.closeTo(38.99, 10),
        bundlePrice: 29.25,
        amount: expect.closeTo(9.74, 10),
        currency: 'CAD',
        percent: expect.closeTo((9.74 / 38.99) * 100, 10),
      },
      {
        interval: 'year',
        intervalCount: 1,
        standaloneTotal: expect.closeTo(389.99, 10),
        bundlePrice: 290,
        amount: expect.closeTo(99.99, 10),
        currency: 'CAD',
        percent: expect.closeTo((99.99 / 389.99) * 100, 10),
      },
    ]);
  });

  it('leaves out an interval a plan has no price for, or prices in another currency', () => {
    expect(
      bundleSavings(offered(picked(29.25), picked(290, 'year')), [
        offered(picked(16.99), picked(169.99, 'year')),
        offered(picked(22)),
      ]).map((saving) => saving.interval),
    ).toEqual(['month']);
    expect(
      bundleSavings(offered(picked(29.25)), [
        offered(picked(16.99)),
        offered(picked(22, 'month', 'USD')),
      ]),
    ).toEqual([]);
    expect(
      bundleSavings(offered(picked(29.25)), [
        offered(picked(16.99)),
        offered({ ...picked(22), intervalCount: 3 }),
      ]),
    ).toEqual([]);
  });

  it('compares nothing when the bundle or a plan is not offered in the region', () => {
    expect(
      bundleSavings({ pricing: [picked(29.25)], offered: false }, [
        offered(picked(16.99)),
        offered(picked(22)),
      ]),
    ).toEqual([]);
    expect(
      bundleSavings(offered(picked(29.25)), [
        offered(picked(16.99)),
        { pricing: [picked(22)], offered: false },
      ]),
    ).toEqual([]);
  });

  it('saves nothing, to the cent, when the bundle costs as much or more', () => {
    expect(
      bundleSavings(offered(picked(38.99)), [offered(picked(16.99)), offered(picked(22))]),
    ).toEqual([]);
    expect(
      bundleSavings(offered(picked(38.986)), [offered(picked(16.99)), offered(picked(22))]),
    ).toEqual([]);
    expect(
      bundleSavings(offered(picked(45)), [offered(picked(16.99)), offered(picked(22))]),
    ).toEqual([]);
  });
});

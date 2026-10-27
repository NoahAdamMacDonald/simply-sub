import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  readCatalogSource,
  resolveItem,
  type CustomSubscription,
  type FxRates,
  type ItemResolution,
  type ListItem,
  type ResolveContext,
  type ResolvedItem,
  type UnresolvedReason,
} from '../../src';
import { catalog } from '../catalog/catalog-files';

const data = buildCatalogData(readCatalogSource(catalog()), 'https://sub.simplely.ca/icons/');

/** GET /fx's example rates: per Canadian dollar. */
const fx: FxRates = {
  base: 'CAD',
  date: '2026-10-21',
  source: 'European Central Bank via Frankfurter',
  rates: { EUR: 0.664, USD: 0.7243 },
};

const listId = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const gymId = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c50';
const gymPlanId = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c51';

const gym: CustomSubscription = {
  id: gymId,
  name: 'Local Gym',
  link: 'https://www.LocalGym.ca/join?from=app',
  cancelUrl: 'https://www.localgym.ca/cancel',
  plans: [
    {
      id: gymPlanId,
      name: 'Basic',
      features: { 'streaming.ad-free': true },
      price: { amount: 29.99, currency: 'CAD', interval: 'month', intervalCount: 1 },
      autoRenewAvailable: true,
    },
  ],
  createdAt: '2026-10-20T12:00:00.000Z',
  updatedAt: '2026-10-20T12:00:00.000Z',
};

const canadian: ResolveContext = {
  catalog: data,
  customSubs: new Map([[gymId, gym]]),
  country: 'CA',
  currency: 'CAD',
  fx,
  today: '2026-10-26',
  profileRanks: new Map(),
};

function item(source: ListItem['source'], extra: Partial<ListItem> = {}): ListItem {
  return {
    id: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c60',
    listId,
    source,
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-11-12',
      autoRenew: true,
    },
    tagIds: [],
    rankOverrides: {},
    pinned: false,
    createdAt: '2026-10-20T12:00:00.000Z',
    updatedAt: '2026-10-20T12:00:00.000Z',
    ...extra,
  };
}

const yearly: ListItem['billing'] = {
  mode: 'recurring',
  interval: 'year',
  intervalCount: 1,
  anchorDate: '2026-11-12',
  autoRenew: true,
};

function resolved(result: ItemResolution): ResolvedItem {
  if (!result.ok) throw new Error(`Unresolved: ${result.unresolved.reason}`);
  return result.resolved;
}

function reason(result: ItemResolution): UnresolvedReason | undefined {
  return result.ok ? undefined : result.unresolved.reason;
}

describe('resolveItem', () => {
  describe('a catalog plan', () => {
    it('is named, priced in the user’s region and currency, and lists what it provides', () => {
      const netflix = resolved(
        resolveItem(item({ kind: 'catalog', planId: 'netflix.standard' }), canadian),
      );
      expect(netflix).toMatchObject({
        listId,
        providerId: 'netflix',
        planId: 'netflix.standard',
        name: 'Netflix',
        planName: 'Standard',
        iconUrl: 'icons/netflix.webp',
        link: 'https://www.netflix.com/signup',
        cancelUrl: 'https://www.netflix.com/cancelplan',
        region: 'CA',
        price: { amount: 18.99, currency: 'CAD', interval: 'month', native: true },
        addOns: [],
        monthlyEquivalent: 18.99,
      });
      expect(netflix).not.toHaveProperty('override');
      expect(netflix.features).toEqual({
        'video.quality': '1080p',
        'streaming.ad-free': true,
        'streaming.concurrent-streams': 2,
      });
      expect(netflix.providedKeys).toEqual([
        'video.quality=480p',
        'video.quality=720p',
        'video.quality=1080p',
        'streaming.ad-free',
        'streaming.concurrent-streams=1',
        'streaming.concurrent-streams=2-4',
      ]);
    });

    it('takes the price for the item’s billing period', () => {
      const crave = resolved(
        resolveItem(
          item({ kind: 'catalog', planId: 'crave.standard' }, { billing: yearly }),
          canadian,
        ),
      );
      expect(crave.price).toMatchObject({ amount: 119.99, interval: 'year' });
      expect(crave.monthlyEquivalent).toBeCloseTo(119.99 / 12);
    });

    it('converts a price in another currency, and keeps it in its own without a rate', () => {
      const mullvad = item({ kind: 'catalog', planId: 'mullvad.vpn' }, { billing: yearly });
      const converted = resolved(resolveItem(mullvad, canadian));
      expect(converted.price).toMatchObject({
        currency: 'CAD',
        native: false,
        source: { amount: 60 },
      });
      expect(converted.price.amount).toBeCloseTo(60 / 0.664);
      expect(converted.monthlyEquivalent).toBeCloseTo(60 / 0.664 / 12);
      // Mullvad renews by hand: the item's price says so.
      expect(converted.price.autoRenew).toBe(false);

      const noRates = { ...canadian };
      delete noRates.fx;
      expect(resolved(resolveItem(mullvad, noRates)).price).toMatchObject({
        amount: 60,
        currency: 'EUR',
        native: false,
      });
    });

    it('is priced where it was bought', () => {
      const netflix = resolved(
        resolveItem(
          item({ kind: 'catalog', planId: 'netflix.standard' }, { region: 'US' }),
          canadian,
        ),
      );
      expect(netflix.region).toBe('US');
      expect(netflix.price).toMatchObject({
        source: { region: 'US', amount: 19.99, currency: 'USD' },
      });
      expect(netflix.price.amount).toBeCloseTo(19.99 / 0.7243);
    });

    it('is priced even where it isn’t sold any more: the user has it', () => {
      // Premium is sold in the US only, and has a US price.
      const premium = resolved(
        resolveItem(item({ kind: 'catalog', planId: 'netflix.premium' }), canadian),
      );
      expect(premium.price.source).toEqual({ region: 'US', amount: 26.99, currency: 'USD' });
    });

    it('shows a free plan as free', () => {
      const free = resolved(
        resolveItem(item({ kind: 'catalog', planId: 'proton.free' }), canadian),
      );
      expect(free.price).toMatchObject({ amount: 0, currency: 'CAD', native: true });
      expect(free.monthlyEquivalent).toBe(0);
    });

    it('adds its add-ons, each times its quantity', () => {
      const netflix = resolved(
        resolveItem(
          item({
            kind: 'catalog',
            planId: 'netflix.standard',
            addOns: [{ id: 'netflix.extra-member', quantity: 1 }],
          }),
          canadian,
        ),
      );
      expect(netflix.addOns).toEqual([
        {
          id: 'netflix.extra-member',
          name: 'Extra member',
          quantity: 1,
          price: expect.objectContaining({ amount: 7.99 }),
        },
      ]);
      expect(netflix.monthlyEquivalent).toBeCloseTo(18.99 + 7.99);
    });

    it('bills an add-on sold only monthly by the month, on a yearly plan', () => {
      const crave = resolved(
        resolveItem(
          item(
            {
              kind: 'catalog',
              planId: 'crave.standard',
              addOns: [{ id: 'crave.starz', quantity: 2 }],
            },
            { billing: yearly },
          ),
          canadian,
        ),
      );
      expect(crave.addOns[0].price).toMatchObject({ amount: 7.99, interval: 'month' });
      expect(crave.monthlyEquivalent).toBeCloseTo(119.99 / 12 + 2 * 7.99);
    });
  });

  describe('a bundle', () => {
    it('takes the seller’s icon and its plans’ features together', () => {
      const bundle = resolved(
        resolveItem(item({ kind: 'bundle', bundleId: 'bundle.netflix-crave' }), canadian),
      );
      expect(bundle).toMatchObject({
        providerId: 'crave',
        bundleId: 'bundle.netflix-crave',
        name: 'Netflix and Crave',
        planName: 'Netflix Standard + Crave Premium',
        iconUrl: 'icons/crave.webp',
        price: { amount: 35, currency: 'CAD' },
        monthlyEquivalent: 35,
        features: {
          'video.quality': '4k',
          'streaming.ad-free': true,
          'streaming.concurrent-streams': 2,
          'streaming.live': ['tv-channels', 'sports'],
        },
      });
      expect(bundle).not.toHaveProperty('planId');
      expect(bundle.providedKeys).toContain('video.quality=4k');
      expect(bundle.providedKeys).toContain('streaming.live=tv-channels');
    });
  });

  describe('its ranks (M6.1)', () => {
    it('ranks each key it provides by its override, else the profile’s rank, else not ranked', () => {
      const netflix = resolved(
        resolveItem(
          item(
            { kind: 'catalog', planId: 'netflix.standard' },
            {
              rankOverrides: {
                'streaming.ad-free': 'essential',
                // Not ranked overrides the profile's Wanted.
                'video.quality=1080p': 'not-ranked',
                // A key the plan doesn't provide has no effect.
                'video.quality=4k': 'critical',
              },
            },
          ),
          {
            ...canadian,
            profileRanks: new Map([
              ['video.quality=1080p', 'wanted'],
              ['video.quality=720p', 'needed'],
              ['streaming.ad-free', 'unwanted'],
              ['vpn.included', 'needed'],
            ]),
          },
        ),
      );

      // Every provided key, in providedKeys' order: the quality ladder up to 1080p, the stream tiers up to 2-4.
      expect(Object.entries(netflix.effectiveRanks)).toEqual([
        ['video.quality=480p', 'not-ranked'],
        ['video.quality=720p', 'needed'],
        ['video.quality=1080p', 'not-ranked'],
        ['streaming.ad-free', 'essential'],
        ['streaming.concurrent-streams=1', 'not-ranked'],
        ['streaming.concurrent-streams=2-4', 'not-ranked'],
      ]);
    });

    it('ranks a bundle’s keys, from its plans together', () => {
      const bundle = resolved(
        resolveItem(item({ kind: 'bundle', bundleId: 'bundle.netflix-crave' }), {
          ...canadian,
          profileRanks: new Map([['streaming.live=sports', 'uses']]),
        }),
      );
      expect(bundle.effectiveRanks['streaming.live=sports']).toBe('uses');
      expect(bundle.effectiveRanks['video.quality=4k']).toBe('not-ranked');
    });
  });

  describe('a custom plan', () => {
    const custom = item({ kind: 'custom', customSubId: gymId, customPlanId: gymPlanId });

    it('is priced as typed, tax included, with its icon from its link’s domain', () => {
      const basic = resolved(resolveItem(custom, canadian));
      expect(basic).toMatchObject({
        customSubId: gymId,
        name: 'Local Gym',
        planName: 'Basic',
        iconUrl: 'api/v1/icon?domain=www.localgym.ca',
        link: 'https://www.LocalGym.ca/join?from=app',
        cancelUrl: 'https://www.localgym.ca/cancel',
        price: {
          amount: 29.99,
          currency: 'CAD',
          native: true,
          taxIncluded: true,
          autoRenew: true,
          source: { region: 'CA', amount: 29.99, currency: 'CAD' },
        },
        monthlyEquivalent: 29.99,
        providedKeys: ['streaming.ad-free'],
      });
      expect(basic).not.toHaveProperty('providerId');
    });

    it('converts a price typed in another currency, and leaves tax to be added when it’s marked plus tax', () => {
      const plan = {
        ...gym.plans[0],
        price: { ...gym.plans[0].price, currency: 'USD', amount: 10, plusTax: true },
      };
      const sub = { ...gym, plans: [plan] };
      delete (sub as Partial<CustomSubscription>).link;
      const result = resolved(
        resolveItem(custom, { ...canadian, customSubs: new Map([[gymId, sub]]) }),
      );
      expect(result.price.amount).toBeCloseTo(10 / 0.7243);
      expect(result.price).not.toHaveProperty('taxIncluded');
      expect(result).not.toHaveProperty('iconUrl');
    });
  });

  describe('a price override', () => {
    const netflix = (priceOverride: ListItem['priceOverride']) =>
      item(
        {
          kind: 'catalog',
          planId: 'netflix.standard',
          addOns: [{ id: 'netflix.extra-member', quantity: 1 }],
        },
        { priceOverride },
      );

    it('replaces the plan and its add-ons in what it costs, with the item’s period', () => {
      const result = resolved(resolveItem(netflix({ amount: 15.99, currency: 'CAD' }), canadian));
      expect(result.override).toMatchObject({
        amount: 15.99,
        currency: 'CAD',
        interval: 'month',
        native: true,
        taxIncluded: true,
      });
      expect(result.monthlyEquivalent).toBe(15.99);
      // The catalog's own prices stay, for comparison.
      expect(result.price.amount).toBe(18.99);
    });

    it('applies until its end date, and not from that day on', () => {
      const until = (date: string) =>
        resolved(resolveItem(netflix({ amount: 9.99, currency: 'CAD', until: date }), canadian));
      expect(until('2026-10-27').override?.amount).toBe(9.99);
      expect(until('2026-10-26')).not.toHaveProperty('override');
      expect(until('2026-10-26').monthlyEquivalent).toBeCloseTo(18.99 + 7.99);
    });

    it('converts an amount in another currency, before tax when marked plus tax', () => {
      const result = resolved(
        resolveItem(netflix({ amount: 10, currency: 'USD', plusTax: true }), canadian),
      );
      expect(result.override?.amount).toBeCloseTo(10 / 0.7243);
      expect(result.override).not.toHaveProperty('taxIncluded');
    });
  });

  describe('an item it can’t resolve', () => {
    it.each<{
      what: string;
      source: ListItem['source'];
      billing?: ListItem['billing'];
      expected: UnresolvedReason;
    }>([
      {
        what: 'a plan no longer in the catalog',
        source: { kind: 'catalog', planId: 'netflix.basic' },
        expected: 'plan-gone',
      },
      {
        what: 'an add-on no longer in the catalog',
        source: {
          kind: 'catalog',
          planId: 'netflix.standard',
          addOns: [{ id: 'netflix.extra-member-hd', quantity: 1 }],
        },
        expected: 'add-on-gone',
      },
      {
        what: 'a bundle no longer in the catalog',
        source: { kind: 'bundle', bundleId: 'bundle.gone' },
        expected: 'bundle-gone',
      },
      {
        what: 'a deleted custom subscription',
        source: {
          kind: 'custom',
          customSubId: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c99',
          customPlanId: gymPlanId,
        },
        expected: 'custom-gone',
      },
      {
        what: 'a deleted custom plan',
        source: {
          kind: 'custom',
          customSubId: gymId,
          customPlanId: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c99',
        },
        expected: 'custom-gone',
      },
      {
        what: 'a period the plan has no price for',
        source: { kind: 'catalog', planId: 'netflix.standard' },
        billing: yearly,
        expected: 'no-price',
      },
    ])('$what: $expected', ({ source, billing, expected }) => {
      const result = resolveItem(item(source, billing && { billing }), canadian);
      expect(reason(result)).toBe(expected);
      expect(result).toMatchObject({ ok: false, unresolved: { listId, item: { source } } });
    });

    it('waits for the catalog, and for the custom subscriptions', () => {
      const catalogItem = item({ kind: 'catalog', planId: 'netflix.standard' });
      const custom = item({ kind: 'custom', customSubId: gymId, customPlanId: gymPlanId });
      expect(reason(resolveItem(catalogItem, { ...canadian, catalog: undefined }))).toBe('pending');
      expect(reason(resolveItem(custom, { ...canadian, catalog: undefined }))).toBe('pending');
      expect(reason(resolveItem(custom, { ...canadian, customSubs: undefined }))).toBe('pending');
    });
  });
});

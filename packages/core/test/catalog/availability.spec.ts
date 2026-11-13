import { describe, expect, it } from 'vitest';
import {
  availability,
  providerAvailability,
  type Price,
  type Provider,
  type SoldItem,
  type SoldRegions,
} from '../../src';

function price(region: string, currency: string): Price {
  return {
    region,
    currency,
    amount: 9.99,
    interval: 'month',
    intervalCount: 1,
    autoRenew: true,
    lastVerified: '2026-10-20',
  };
}

type Seller = Pick<Provider, 'plans' | 'availableIn'>;

function seller(plans: Price[][], availableIn?: string[]): Seller {
  return sellerOf(
    plans.map((prices) => ({ prices })),
    availableIn,
  );
}

/** A provider selling these items as its plans, each with its prices and its own soldIn or notSoldIn. */
function sellerOf(items: SoldItem[], availableIn?: string[]): Seller {
  return {
    plans: items.map((item, index) => ({
      id: `example.plan-${index}`,
      name: `Plan ${index}`,
      link: 'https://example.com/plans',
      features: {},
      ...item,
    })),
    ...(availableIn && { availableIn }),
  };
}

/** An entry of soldIn or notSoldIn: the provider's own page says so of these regions. */
function sold(...regions: string[]): SoldRegions {
  return {
    regions,
    url: 'https://example.com/where',
    quotes: ['Not available'],
    lastVerified: '2026-11-13',
  };
}

describe('providerAvailability', () => {
  it('is offered where a plan has a price: the region, its group or GLOBAL', () => {
    const disney = seller([[price('CA', 'CAD'), price('US', 'USD')]]);
    expect(providerAvailability(disney, 'CA')).toBe('offered');
    expect(providerAvailability(seller([[price('EU', 'EUR')]]), 'SE')).toBe('offered');
    expect(providerAvailability(seller([[price('GLOBAL', 'EUR')]]), 'JP')).toBe('offered');
  });

  it('is unknown elsewhere, since the catalog fills Canada first', () => {
    expect(providerAvailability(seller([[price('CA', 'CAD'), price('US', 'USD')]]), 'DE')).toBe(
      'unknown',
    );
  });

  it('follows availableIn when it is set, groups included', () => {
    const hulu = seller([[price('US', 'USD')]], ['US']);
    expect(providerAvailability(hulu, 'US')).toBe('offered');
    expect(providerAvailability(hulu, 'CA')).toBe('not-offered');
    // A GLOBAL price applies only in the listed regions.
    const european = seller([[price('GLOBAL', 'EUR')]], ['EU', 'NO']);
    expect(providerAvailability(european, 'SE')).toBe('offered');
    expect(providerAvailability(european, 'NO')).toBe('offered');
    expect(providerAvailability(european, 'CA')).toBe('not-offered');
  });
});

describe('availability', () => {
  it('is offered when the item has a price for the region', () => {
    const provider = seller([[price('CA', 'CAD')]]);
    expect(availability({ prices: [price('CA', 'CAD')] }, provider, 'CA')).toBe('offered');
    expect(availability({ prices: [price('GLOBAL', 'USD')] }, provider, 'CA')).toBe('offered');
  });

  it('is not offered where the provider has prices but the item has none', () => {
    // Disney+ With Ads (4K) is a US plan; Canada's plans are priced, and it isn't one of them.
    const usOnly = [price('US', 'USD')];
    const disney = seller([[price('CA', 'CAD'), price('US', 'USD')], usOnly]);
    expect(availability({ prices: usOnly }, disney, 'CA')).toBe('not-offered');
    expect(availability({ prices: usOnly }, disney, 'US')).toBe('offered');
  });

  it('is unknown where the catalog has no prices for the provider', () => {
    const usOnly = [price('US', 'USD')];
    expect(availability({ prices: usOnly }, seller([usOnly]), 'GB')).toBe('unknown');
  });

  it('is offered without a local price where availableIn lists the region', () => {
    const usOnly = [price('US', 'USD')];
    expect(availability({ prices: usOnly }, seller([usOnly], ['US', 'CA']), 'CA')).toBe('offered');
  });

  it('is not offered wherever the provider isn’t', () => {
    const global = [price('GLOBAL', 'USD')];
    expect(availability({ prices: global }, seller([global], ['US']), 'CA')).toBe('not-offered');
  });

  describe('with a plan’s own soldIn and notSoldIn (M11.20)', () => {
    it('is not offered where its notSoldIn names the region, though availableIn lists it', () => {
      // F1 TV: three plans priced in Canada, sold in 132 countries, Pro and Premium not in the US, Premium not in France.
      const access = { prices: [price('CA', 'CAD')] };
      const pro = { prices: [price('CA', 'CAD')], notSoldIn: [sold('US')] };
      const premium = { prices: [price('CA', 'CAD')], notSoldIn: [sold('US', 'FR')] };
      const f1 = sellerOf([access, pro, premium], ['CA', 'US', 'FR', 'NZ']);
      expect(availability(pro, f1, 'US')).toBe('not-offered');
      expect(availability(pro, f1, 'NZ')).toBe('offered');
      expect(availability(pro, f1, 'CA')).toBe('offered');
      expect(availability(pro, f1, 'FR')).toBe('offered');
      expect(availability(premium, f1, 'FR')).toBe('not-offered');
      expect(availability(access, f1, 'US')).toBe('offered');
    });

    it('is offered where its soldIn names the region, though only another plan is priced there', () => {
      // MLB.TV: sold outside the US at a price no page states, while MLB+ (outside the US) is priced there.
      const mlbTv = { prices: [price('US', 'USD')], soldIn: [sold('CA', 'GB')] };
      const mlbPlus = { prices: [price('US', 'USD')] };
      const international = { prices: [price('CA', 'USD'), price('GB', 'USD')] };
      const mlb = sellerOf([mlbTv, mlbPlus, international]);
      expect(availability(mlbTv, mlb, 'CA')).toBe('offered');
      expect(availability(mlbPlus, mlb, 'CA')).toBe('not-offered');
      expect(availability(international, mlb, 'US')).toBe('not-offered');
      expect(availability(mlbTv, mlb, 'IE')).toBe('unknown');
    });

    it('lets notSoldIn carve a region out of a wider price', () => {
      const global = { prices: [price('GLOBAL', 'USD')], notSoldIn: [sold('US')] };
      expect(availability(global, sellerOf([global]), 'US')).toBe('not-offered');
      expect(availability(global, sellerOf([global]), 'CA')).toBe('offered');
      const european = { prices: [price('EU', 'EUR')], notSoldIn: [sold('DE')] };
      expect(availability(european, sellerOf([european]), 'DE')).toBe('not-offered');
      expect(availability(european, sellerOf([european]), 'FR')).toBe('offered');
    });

    it('reads groups', () => {
      const inEurope = { prices: [price('US', 'USD')], soldIn: [sold('EU')] };
      const notInEurope = { prices: [price('GLOBAL', 'USD')], notSoldIn: [sold('EU')] };
      const notInGermany = { prices: [price('EU', 'EUR')], notSoldIn: [sold('DE')] };
      const provider = sellerOf([inEurope, notInEurope, notInGermany]);
      expect(availability(inEurope, provider, 'SE')).toBe('offered');
      expect(availability(notInEurope, provider, 'SE')).toBe('not-offered');
      expect(availability(notInEurope, provider, 'US')).toBe('offered');
      expect(availability(notInGermany, provider, 'FR')).toBe('offered');
    });

    it('doesn’t take a sibling’s soldIn as the region’s plans being known', () => {
      const withSoldIn = { prices: [price('CA', 'CAD')], soldIn: [sold('NZ')] };
      const without = { prices: [price('CA', 'CAD')] };
      expect(availability(without, sellerOf([withSoldIn, without], ['CA', 'NZ']), 'NZ')).toBe(
        'offered',
      );
    });

    it('is never offered where the provider isn’t', () => {
      const canada = { prices: [price('US', 'USD')], soldIn: [sold('CA')] };
      expect(availability(canada, sellerOf([canada], ['US']), 'CA')).toBe('not-offered');
    });
  });
});

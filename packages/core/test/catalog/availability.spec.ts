import { describe, expect, it } from 'vitest';
import { availability, providerAvailability, type Price, type Provider } from '../../src';

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
  return {
    plans: plans.map((prices, index) => ({
      id: `example.plan-${index}`,
      name: `Plan ${index}`,
      features: {},
      prices,
    })),
    ...(availableIn && { availableIn }),
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
    expect(availability([price('CA', 'CAD')], provider, 'CA')).toBe('offered');
    expect(availability([price('GLOBAL', 'USD')], provider, 'CA')).toBe('offered');
  });

  it('is not offered where the provider has prices but the item has none', () => {
    // Disney+ With Ads (4K) is a US plan; Canada's plans are priced, and it isn't one of them.
    const usOnly = [price('US', 'USD')];
    const disney = seller([[price('CA', 'CAD'), price('US', 'USD')], usOnly]);
    expect(availability(usOnly, disney, 'CA')).toBe('not-offered');
    expect(availability(usOnly, disney, 'US')).toBe('offered');
  });

  it('is unknown where the catalog has no prices for the provider', () => {
    const usOnly = [price('US', 'USD')];
    expect(availability(usOnly, seller([usOnly]), 'GB')).toBe('unknown');
  });

  it('is offered without a local price where availableIn lists the region', () => {
    const usOnly = [price('US', 'USD')];
    expect(availability(usOnly, seller([usOnly], ['US', 'CA']), 'CA')).toBe('offered');
  });

  it('is not offered wherever the provider isn’t', () => {
    const global = [price('GLOBAL', 'USD')];
    expect(availability(global, seller([global], ['US']), 'CA')).toBe('not-offered');
  });
});

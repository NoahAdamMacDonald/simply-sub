import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { bundleSchema, providerSchema } from '@simply-sub/core';
import { withLastVerified, withPrice, withoutReseller, withoutTaxIncluded } from '../src/yaml-edit';
import bundleYaml from '../../../data/bundles/disney-crave-premium.yaml?raw';
import mullvadYaml from '../../../data/providers/mullvad.yaml?raw';
import netflixYaml from '../../../data/providers/netflix.yaml?raw';

// The pull request's edits on the real files: only the lines they change, and a file its schema still accepts.

const monthlyCa = { region: 'CA', currency: 'CAD', interval: 'month', intervalCount: 1 } as const;

function differing(before: string, after: string): number {
  const old = before.split('\n');
  const now = after.split('\n');
  return (
    Math.abs(old.length - now.length) + old.filter((line, index) => line !== now[index]).length
  );
}

describe('YAML edits', () => {
  it('set a plan’s price and lastVerified, leaving the rest as written', () => {
    const edited = withPrice(
      netflixYaml,
      { owner: { kind: 'plan', id: 'netflix.standard' }, price: monthlyCa },
      19.99,
      '2026-10-29',
    );
    expect(edited).toBeDefined();
    expect(differing(netflixYaml, edited ?? '')).toBe(2);
    const provider = providerSchema.parse(parse(edited ?? ''));
    const price = provider.plans.find((plan) => plan.id === 'netflix.standard')?.prices[0];
    expect(price).toMatchObject({ region: 'CA', amount: 19.99, lastVerified: '2026-10-29' });
    // The US price, the comments and the other plans are as they were.
    expect(provider.plans.find((plan) => plan.id === 'netflix.standard')?.prices[1]).toMatchObject({
      amount: 19.99,
      region: 'US',
      lastVerified: '2026-10-23',
    });
    expect(edited).toContain(netflixYaml.split('\n').find((line) => line.startsWith('#')) ?? '');
  });

  it('find an add-on’s price, a reseller’s offer and a bundle’s', () => {
    const addOn = withLastVerified(
      netflixYaml,
      { owner: { kind: 'addOn', id: 'netflix.extra-member' }, price: monthlyCa },
      '2026-11-30',
    );
    expect(providerSchema.parse(parse(addOn ?? '')).addOns?.[1].prices[0].lastVerified).toBe(
      '2026-11-30',
    );
    const offer = withPrice(
      mullvadYaml,
      {
        owner: { kind: 'reseller', reseller: 'amazon', plan: 'mullvad.vpn' },
        price: { region: 'CA', currency: 'CAD', interval: 'month', intervalCount: 12 },
      },
      89,
      '2026-10-29',
    );
    const amazon = providerSchema.parse(parse(offer ?? '')).resellers?.[0].offers[0].prices[1];
    expect(amazon).toMatchObject({ amount: 89, intervalCount: 12, lastVerified: '2026-10-29' });
    const bundle = withPrice(
      bundleYaml,
      { owner: { kind: 'bundle', id: 'bundle.disney-crave-premium' }, price: monthlyCa },
      30.25,
      '2026-10-29',
    );
    expect(bundleSchema.parse(parse(bundle ?? '')).prices[0].amount).toBe(30.25);
  });

  it('take a taxIncluded quote out of one price', () => {
    const edited = withoutTaxIncluded(
      mullvadYaml,
      {
        owner: { kind: 'plan', id: 'mullvad.vpn' },
        price: { region: 'GLOBAL', currency: 'EUR', interval: 'month', intervalCount: 1 },
      },
      '2026-10-29',
    );
    const prices = providerSchema.parse(parse(edited ?? '')).plans[0].prices;
    expect(prices[0].taxIncluded).toBeUndefined();
    expect(prices[0].lastVerified).toBe('2026-10-29');
    expect(prices[1].taxIncluded).toEqual({ quote: 'Including VAT.' });
  });

  it('remove a reseller’s listing, and the resellers key with the last one', () => {
    const edited = withoutReseller(mullvadYaml, 'webhallen') ?? '';
    const provider = providerSchema.parse(parse(edited));
    expect(provider.resellers?.map((listing) => listing.reseller)).not.toContain('webhallen');
    expect(provider.resellers).toHaveLength(5);
    let all = mullvadYaml;
    for (const reseller of [
      'amazon',
      'inet',
      'laptopwithlinux',
      'proxystore',
      'serialcart',
      'webhallen',
    ]) {
      all = withoutReseller(all, reseller) ?? all;
    }
    expect(all).not.toContain('resellers:');
    expect(providerSchema.safeParse(parse(all)).success).toBe(true);
  });

  it('give undefined for a price or reseller the file doesn’t have', () => {
    expect(
      withPrice(
        netflixYaml,
        { owner: { kind: 'plan', id: 'netflix.gone' }, price: monthlyCa },
        1,
        '2026-10-29',
      ),
    ).toBeUndefined();
    expect(
      withPrice(
        netflixYaml,
        { owner: { kind: 'plan', id: 'netflix.standard' }, price: { ...monthlyCa, region: 'GB' } },
        1,
        '2026-10-29',
      ),
    ).toBeUndefined();
    expect(withoutReseller(netflixYaml, 'amazon')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import {
  coverageGaps,
  coverageNotes,
  coverageRegions,
  explains,
  type Plan,
  type Price,
  type Provider,
} from '../../src';

// Regional coverage (M11.7, the guide's §3.2): the regions a provider is sold in where a paid plan has no price, and
// the notes in its file that explain them.

function price(region: string, amount: number, extra: Partial<Price> = {}): Price {
  return {
    region,
    currency: region === 'CA' ? 'CAD' : region === 'EU' || region === 'DE' ? 'EUR' : 'USD',
    amount,
    interval: 'month',
    intervalCount: 1,
    autoRenew: true,
    lastVerified: '2026-10-20',
    ...extra,
  };
}

function plan(id: string, prices: Price[], extra: Partial<Plan> = {}): Plan {
  return { id, name: id, link: 'https://example.com', features: {}, prices, ...extra };
}

function provider(id: string, plans: Plan[], extra: Partial<Provider> = {}): Provider {
  return {
    id,
    name: id,
    website: 'https://example.com',
    category: 'ai',
    spendCategory: 'software',
    cancelUrl: 'https://example.com/cancel',
    plans,
    ...extra,
  };
}

/** Claude before M10.17: Free for everywhere, its paid plans priced in the US only. */
const claude = provider('claude', [
  plan('claude.free', [price('GLOBAL', 0)]),
  plan('claude.pro', [price('US', 20)]),
  plan('claude.max', [price('US', 100)]),
]);

describe('coverageGaps', () => {
  it('flags a provider like Claude before M10.17: no CA for its paid plans, though Free sells everywhere', () => {
    expect(coverageGaps([claude])).toEqual([
      { provider: 'claude', plan: 'claude.pro', region: 'CA', why: 'global' },
      { provider: 'claude', plan: 'claude.max', region: 'CA', why: 'global' },
    ]);
    expect([...coverageRegions(claude)]).toEqual([
      ['US', 'priced'],
      ['CA', 'global'],
    ]);
  });

  it('flags a plan priced in some of the provider’s regions and not others, and where availableIn sells', () => {
    const netflix = provider(
      'netflix',
      [
        plan('netflix.standard', [price('CA', 18.99), price('US', 17.99)]),
        plan('netflix.premium', [price('US', 24.99)]),
      ],
      { availableIn: ['CA', 'US', 'GB'] },
    );
    expect(coverageGaps([netflix])).toEqual([
      { provider: 'netflix', plan: 'netflix.standard', region: 'GB', why: 'available' },
      { provider: 'netflix', plan: 'netflix.premium', region: 'CA', why: 'priced' },
      { provider: 'netflix', plan: 'netflix.premium', region: 'GB', why: 'available' },
    ]);
  });

  it('flags a provider whose availability in Canada or the US is unknown, as Mixcloud was in Canada', () => {
    const mixcloud = provider('mixcloud', [
      plan('mixcloud.free', [price('US', 0)]),
      plan('mixcloud.premium', [price('US', 7.99)]),
    ]);
    expect(coverageGaps([mixcloud])).toEqual([
      { provider: 'mixcloud', plan: 'mixcloud.*', region: 'CA', why: 'home' },
    ]);
    // Priced in Canada too, or listed as sold only in the US, it's known there.
    const priced = provider('mixcloud', [
      plan('mixcloud.premium', [price('US', 7.99), price('CA', 7.99)]),
    ]);
    expect(coverageGaps([priced])).toEqual([]);
    expect(coverageGaps([{ ...mixcloud, availableIn: ['US'] }])).toEqual([]);
  });

  it('takes a group’s and everywhere’s prices for a region in them', () => {
    const vpn = provider('vpn', [
      plan('vpn.basic', [price('EU', 5), price('US', 6)]),
      plan('vpn.plus', [price('GLOBAL', 9)]),
      plan('vpn.pro', [price('DE', 12)]),
    ]);
    // DE is in EU, which Basic has a price for; Pro's DE price isn't the EU's. Plus sells everywhere, so CA counts.
    expect(coverageGaps([vpn])).toEqual([
      { provider: 'vpn', plan: 'vpn.basic', region: 'CA', why: 'global' },
      { provider: 'vpn', plan: 'vpn.pro', region: 'EU', why: 'priced' },
      { provider: 'vpn', plan: 'vpn.pro', region: 'US', why: 'priced' },
      { provider: 'vpn', plan: 'vpn.pro', region: 'CA', why: 'global' },
    ]);
  });

  it('leaves out free plans, retired plans and prices, and retired providers', () => {
    const gone = provider('gone', [
      plan('gone.free', [price('GLOBAL', 0)]),
      plan('gone.old', [price('US', 9)], { retired: '2026-10-01' }),
      plan('gone.ca', [price('CA', 9)]),
      plan('gone.us', [price('US', 9), price('CA', 9, { retired: '2026-10-01' })]),
    ]);
    expect(coverageGaps([gone])).toEqual([
      { provider: 'gone', plan: 'gone.ca', region: 'US', why: 'priced' },
      { provider: 'gone', plan: 'gone.us', region: 'CA', why: 'priced' },
    ]);
    expect(coverageGaps([{ ...gone, retired: '2026-10-01' }])).toEqual([]);
  });
});

describe('"Coverage:" notes', () => {
  const file = [
    '# Prices read 2026-10-26 on its help centre.',
    "# Coverage: netflix.standard-ads isn't sold in NZ, IE or NL: each country's page lists no ads plan",
    '# (help.netflix.com/en/node/24926/nz).',
    '',
    '# Coverage: bitdefender.* in GB and AU: not read yet.',
    'id: netflix',
  ].join('\n');

  it('are comment blocks of their own, their lines joined', () => {
    expect(coverageNotes(file).map((note) => note.text)).toEqual([
      "Coverage: netflix.standard-ads isn't sold in NZ, IE or NL: each country's page lists no ads plan (help.netflix.com/en/node/24926/nz).",
      'Coverage: bitdefender.* in GB and AU: not read yet.',
    ]);
  });

  it('explain a gap when they name its plan, or every plan, and its region as words', () => {
    const [ads, bitdefender] = coverageNotes(file);
    expect(explains(ads, { plan: 'netflix.standard-ads', region: 'NZ' })).toBe(true);
    expect(explains(ads, { plan: 'netflix.standard-ads', region: 'CA' })).toBe(false);
    // netflix.standard is another plan, and CA isn't in "CAD".
    expect(explains(ads, { plan: 'netflix.standard', region: 'NZ' })).toBe(false);
    expect(explains(bitdefender, { plan: 'bitdefender.premium-vpn', region: 'AU' })).toBe(true);
    expect(explains(bitdefender, { plan: 'bitdefender.premium-vpn', region: 'NZ' })).toBe(false);
  });
});

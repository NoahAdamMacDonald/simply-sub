import { describe, expect, it } from 'vitest';
import {
  optimize,
  resolveItem,
  type CatalogData,
  type ListItem,
  type Plan,
  type ProfileRank,
} from '../../src';
import { cards, catalog, fx, item, today } from './fixtures';

// A third-party value (M11.16) is a feature value a publication gives, which no official page states: the optimizer
// counts it for a feature ranked Wanted or lower, never for one ranked Needed or higher, and a card that rests on one
// names its source.

const claim = {
  publisher: 'The Verge',
  url: 'https://www.theverge.com/netflix-standard-hdr',
  quote: 'Standard now streams in HDR.',
  lastVerified: '2026-10-01',
};

/** The fixture catalog with some plans changed. */
function catalogWith(changes: Record<string, Partial<Plan>>): CatalogData {
  return {
    ...catalog,
    providers: catalog.providers.map((provider) => ({
      ...provider,
      plans: provider.plans.map((plan) => ({ ...plan, ...changes[plan.id] })),
    })),
  };
}

/** Netflix Standard with HDR, from a publication or (`thirdParty` false) from its own page. */
function withHdr(thirdParty = true): CatalogData {
  return catalogWith({
    'netflix.standard': {
      features: { 'video.quality': '1080p', 'video.hdr': true, 'streaming.ad-free': true },
      ...(thirdParty && { thirdParty: { 'video.hdr': claim } }),
    },
    'disney-plus.premium': {
      features: { 'video.quality': '4k', 'video.hdr': true, 'streaming.ad-free': true },
      ...(thirdParty && { thirdParty: { 'video.hdr': claim } }),
    },
  });
}

function run(data: CatalogData, items: readonly ListItem[], ranks: Record<string, ProfileRank>) {
  const context = {
    today,
    country: 'CA',
    currency: 'CAD',
    fx,
    place: { country: 'CA', subdivision: 'CA-AB' },
    profileRanks: new Map(Object.entries(ranks)),
  };
  return optimize({
    items: items.map((listItem) => {
      const result = resolveItem(listItem, {
        catalog: data,
        customSubs: new Map(),
        ...context,
        taxPlace: context.place,
      });
      if (!result.ok) throw new Error(result.unresolved.reason);
      return result.resolved;
    }),
    catalogs: new Map([['CA', data]]),
    context,
  });
}

describe('optimize: third-party values (M11.16)', () => {
  it('keep a Wanted feature, and the card names the publication', () => {
    const result = run(withHdr(), [item('netflix.premium')], {
      'video.quality=4k': 'unwanted',
      'video.hdr': 'wanted',
    });
    expect(cards(result)).toMatchInlineSnapshot(`
      [
        "red | Downgrade Netflix Premium → Standard | save 63.00 | lose video.quality=4k (unwanted)",
        "yellow | Downgrade Netflix Premium → Standard with ads | save 201.60 | lose video.quality=4k (unwanted), video.hdr (wanted), streaming.ad-free (not-ranked)",
      ]
    `);
    expect(result.suggestions[0].thirdParty).toEqual([
      { key: 'video.hdr', label: 'HDR', publisher: 'The Verge', url: claim.url },
    ]);
    expect(result.suggestions[1].thirdParty).toBeUndefined();
  });

  it('never keep a Needed feature: only an official value does', () => {
    const ranks = { 'video.quality=4k': 'unwanted', 'video.hdr': 'needed' } as const;
    expect(cards(run(withHdr(), [item('netflix.premium')], ranks))).toEqual([]);
    expect(cards(run(withHdr(false), [item('netflix.premium')], ranks))).toMatchInlineSnapshot(`
      [
        "red | Downgrade Netflix Premium → Standard | save 63.00 | lose video.quality=4k (unwanted)",
      ]
    `);
  });

  it('never block a change to how the item’s own plan is billed', () => {
    const result = run(withHdr(), [item('disney-plus.premium')], { 'video.hdr': 'needed' });
    expect(cards(result)).toMatchInlineSnapshot(`
      [
        "free | Switch Disney+ Premium to annual billing | save 35.58",
      ]
    `);
    expect(result.suggestions.every((suggestion) => !suggestion.thirdParty)).toBe(true);
  });

  it('never keep a removed item’s Needed feature through another’s claim, and name it for a Wanted one', () => {
    const data = catalogWith({
      'mullvad.vpn': {
        features: { 'vpn.included': true, 'vpn.multi-hop': true },
        thirdParty: { 'vpn.multi-hop': claim },
      },
    });
    const items = [item('mullvad.vpn'), item('ivpn.pro')];
    const needed = run(data, items, { 'vpn.included': 'needed', 'vpn.multi-hop': 'needed' });
    expect(cards(needed)).toMatchInlineSnapshot(`
      [
        "yellow | Remove Mullvad VPN | save 93.75 | estimated | lose Mullvad VPN",
      ]
    `);
    const wanted = run(data, items, { 'vpn.included': 'needed', 'vpn.multi-hop': 'wanted' });
    expect(cards(wanted)).toMatchInlineSnapshot(`
      [
        "yellow | Remove IVPN Pro | save 153.72 | lose IVPN Pro",
      ]
    `);
    expect(wanted.suggestions.map((suggestion) => suggestion.thirdParty)).toMatchInlineSnapshot(`
      [
        [
          {
            "key": "vpn.multi-hop",
            "label": "Multi-hop",
            "publisher": "The Verge",
            "url": "https://www.theverge.com/netflix-standard-hdr",
          },
        ],
      ]
    `);
  });

  it('name the claim an extra member rests on', () => {
    const result = run(withHdr(), [item('netflix.premium'), item('netflix.premium')], {
      'video.quality=4k': 'unwanted',
      'video.hdr': 'wanted',
    });
    expect(cards(result)).toMatchInlineSnapshot(`
      [
        "red | Make Netflix Premium an extra member on Netflix Premium | save 201.60 | lose video.quality=4k (unwanted)",
        "yellow | Downgrade Netflix Premium → Standard with ads | save 201.60 | lose video.quality=4k (unwanted), video.hdr (wanted), streaming.ad-free (not-ranked)",
        "yellow | Downgrade Netflix Premium → Standard with ads | save 201.60 | lose video.quality=4k (unwanted), video.hdr (wanted), streaming.ad-free (not-ranked)",
      ]
    `);
    expect(result.suggestions.map((suggestion) => suggestion.thirdParty)).toMatchInlineSnapshot(`
      [
        [
          {
            "key": "video.hdr",
            "label": "HDR",
            "publisher": "The Verge",
            "url": "https://www.theverge.com/netflix-standard-hdr",
          },
        ],
        undefined,
        undefined,
      ]
    `);
  });

  it('count for an item reaching the plan it has through an extra member or a bundle', () => {
    const standard = run(withHdr(), [item('netflix.standard'), item('netflix.standard')], {
      'video.hdr': 'needed',
    });
    expect(cards(standard)).toMatchInlineSnapshot(`
      [
        "free | Make Netflix Standard an extra member on Netflix Standard | save 138.60",
      ]
    `);
    const data = catalogWith({ 'crave.premium': { thirdParty: { 'streaming.ad-free': claim } } });
    const bundled = run(data, [item('disney-plus.premium'), item('crave.premium')], {
      'streaming.ad-free': 'needed',
    });
    expect(cards(bundled)).toMatchInlineSnapshot(`
      [
        "free | Replace Disney+ Premium and Crave Premium with Disney+ and Crave Premium Bundle | save 122.72",
        "yellow | Downgrade Disney+ Premium → Standard, annual billing + Remove Crave Premium | save 354.78 | lose Crave Premium, video.quality=4k (not-ranked), video.hdr (not-ranked)",
      ]
    `);
    expect([...standard.suggestions, ...bundled.suggestions].some((s) => s.thirdParty)).toBe(false);
  });
});

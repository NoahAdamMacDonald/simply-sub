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
});

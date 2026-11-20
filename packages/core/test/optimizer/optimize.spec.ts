import { describe, expect, it } from 'vitest';
import {
  isDismissed,
  optimize,
  resolveItem,
  suggestionSummary,
  type ListItem,
  type ProfileRank,
} from '../../src';
import { cards, catalog, item, resolveAll, run, today } from './fixtures';

// Core's lib has no DOM or Node types; Vitest runs on Node, which has a performance clock.
const { performance } = globalThis as unknown as { performance: { now(): number } };

// The optimizer's fixtures (BLUEPRINT §10.5, PROJECT-PLAN P14): each list's cards, with their sections (the colours),
// changes, savings over the next 12 months (tax included, Alberta's 5%) and what they lose or gain.

describe('optimize: free savings', () => {
  it('switches a monthly plan that renews by itself to annual billing, and suggests the cheaper plan apart', () => {
    const result = run([item('disney-plus.premium')]);
    expect(cards(result)).toMatchInlineSnapshot(`
      [
        "free | Switch Disney+ Premium to annual billing | save 35.58",
        "red | Downgrade Disney+ Premium → Standard, annual billing | save 77.58 | lose video.quality=4k (not-ranked), video.hdr (not-ranked)",
      ]
    `);
    // 12 × $16.99 against $129.99 for Standard yearly, with GST: Save up to is the best plan's.
    expect(result.bestSavings).toBeCloseTo((12 * 16.99 - 129.99) * 1.05, 6);
    expect(result.search).toBe('exhaustive');
  });

  it('never moves a plan renewed by hand to annual billing', () => {
    expect(cards(run([item('disney-plus.premium', { autoRenew: false })]))).toMatchInlineSnapshot(`
      [
        "red | Downgrade Disney+ Premium → Standard | save 50.40 | lose video.quality=4k (not-ranked), video.hdr (not-ranked)",
      ]
    `);
  });

  it('replaces two plans with the bundle of them, and three Proton plans with the suite that includes them', () => {
    expect(cards(run([item('disney-plus.premium'), item('crave.premium')]))).toMatchInlineSnapshot(`
      [
        "free | Replace Disney+ Premium and Crave Premium with Disney+ and Crave Premium Bundle | save 122.72",
        "red | Downgrade Disney+ Premium → Standard, annual billing | save 77.58 | lose video.quality=4k (not-ranked), video.hdr (not-ranked)",
        "yellow | Remove Crave Premium | save 277.20 | lose Crave Premium",
      ]
    `);
    expect(
      cards(
        run([item('proton.mail-plus'), item('proton.vpn-plus'), item('proton.pass-plus')], {
          'email.addresses=10-plus': 'needed',
          'vpn.included': 'needed',
          'password-manager': 'needed',
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "free | Replace Proton Mail Plus, Proton VPN Plus and Proton Pass Plus with Proton Unlimited | save 150.95 | gain storage.cloud=100-plus",
      ]
    `);
  });
});

describe('optimize: a change a card (M10.33)', () => {
  it('splits a plan’s changes into cards of one change, each in the section of what it alone gives up', () => {
    // The yellow plan downgrades Disney+ and removes Crave. Each is a card of its own: the downgrade alone loses only
    // unranked features (red), and the removal loses Crave itself (yellow).
    const result = run([item('disney-plus.premium'), item('crave.premium')]);
    const changes = result.suggestions.filter((suggestion) => suggestion.severity !== 'free');
    expect(changes.map((suggestion) => suggestion.actions.length)).toEqual([1, 1]);
    expect(changes.map((suggestion) => suggestion.severity)).toEqual(['red', 'yellow']);
    // Each saves what it saves alone, judged against the list as it is.
    const [downgrade, removal] = changes;
    expect(downgrade.savings + removal.savings).toBeCloseTo(77.58 + 277.2, 2);
    expect(new Set(result.suggestions.map((suggestion) => suggestion.fingerprint)).size).toBe(
      result.suggestions.length,
    );
  });
});

describe('optimize: severities', () => {
  it('downgrades Netflix Premium to Standard in red when 4K and HDR are Unwanted, and to ads in yellow', () => {
    const result = run([item('netflix.premium')], {
      'video.quality=4k': 'unwanted',
      'video.hdr': 'unwanted',
      'streaming.ad-free': 'wanted',
    });
    expect(cards(result)).toMatchInlineSnapshot(`
      [
        "red | Downgrade Netflix Premium → Standard | save 63.00 | lose video.quality=4k (unwanted), video.hdr (unwanted)",
        "yellow | Downgrade Netflix Premium → Standard with ads | save 201.60 | lose video.quality=4k (unwanted), video.hdr (unwanted), streaming.ad-free (wanted)",
      ]
    `);
  });

  it('suggests in orange what loses an Unused feature', () => {
    expect(
      cards(
        run([item('netflix.premium')], {
          'video.quality=4k': 'unused',
          'video.hdr': 'unwanted',
          'streaming.ad-free': 'needed',
        }),
      ),
    ).toMatchInlineSnapshot(`
      [
        "orange | Downgrade Netflix Premium → Standard | save 63.00 | lose video.quality=4k (unused), video.hdr (unwanted)",
      ]
    `);
  });
});

describe('optimize: hard constraints (BLUEPRINT §10.2)', () => {
  it('2 VPNs, VPN ranked Needed: removes one, never both, the pricier when they are alike', () => {
    expect(cards(run([item('mullvad.vpn'), item('ivpn.pro')], { 'vpn.included': 'needed' })))
      .toMatchInlineSnapshot(`
        [
          "red | Downgrade IVPN Pro → Standard | save 51.66 | lose vpn.multi-hop (not-ranked)",
          "yellow | Remove IVPN Pro | save 153.72 | lose IVPN Pro, vpn.multi-hop (not-ranked)",
        ]
      `);
  });

  it('2 VPNs, VPN ranked Needed: removes the cheaper one when only the pricier has another Needed feature', () => {
    const result = run([item('mullvad.vpn'), item('ivpn.pro')], {
      'vpn.included': 'needed',
      'vpn.multi-hop': 'needed',
    });
    // Mullvad's €5 includes tax everywhere, converted at 1.5625: an estimate.
    expect(cards(result)).toMatchInlineSnapshot(`
      [
        "yellow | Remove Mullvad VPN | save 93.75 | estimated | lose Mullvad VPN",
      ]
    `);
    expect(result.bestEstimated).toBe(true);
  });

  it('an Essential feature blocks a downgrade, and leaves only changes that keep the plan', () => {
    const essential = item(
      'netflix.premium',
      {},
      { rankOverrides: { 'video.quality=4k': 'essential' } },
    );
    expect(cards(run([essential], { 'video.hdr': 'unwanted' }))).toEqual([]);
    const yearly = item('disney-plus.premium', {}, { rankOverrides: { 'video.hdr': 'essential' } });
    expect(cards(run([yearly]))).toMatchInlineSnapshot(`
      [
        "free | Switch Disney+ Premium to annual billing | save 35.58",
      ]
    `);
  });

  it('a Critical feature allows a same-provider downgrade that keeps it, but blocks removal', () => {
    const netflix = item(
      'netflix.premium',
      {},
      { rankOverrides: { 'streaming.ad-free': 'critical' } },
    );
    // Disney+ gives everything Netflix does, so without Critical removing Netflix would be a choice.
    const found = cards(run([netflix, item('disney-plus.premium', { autoRenew: false })]));
    expect(found).toMatchInlineSnapshot(`
      [
        "red | Downgrade Netflix Premium → Standard | save 63.00 | lose video.quality=4k (not-ranked), video.hdr (not-ranked)",
        "red | Downgrade Disney+ Premium → Standard | save 50.40 | lose video.quality=4k (not-ranked), video.hdr (not-ranked)",
        "yellow | Remove Disney+ Premium | save 214.07 | lose Disney+ Premium",
      ]
    `);
    expect(found.join('\n')).not.toMatch(/Remove Netflix|Standard with ads/);
  });

  it('a limited Sep–Oct window keeps a Needed feature covered only in its months', () => {
    const netflix = item('netflix.premium');
    const disney = item('disney-plus.premium', {
      mode: 'limited',
      windows: [{ start: '2026-09-01', end: '2026-10-31', repeatYearly: true }],
    } as Partial<ListItem['billing']>);
    const found = cards(run([netflix, disney], { 'video.quality=4k': 'needed' }));
    // Disney+ can go, since Netflix gives 4K all year; Netflix can't, since Disney+ gives it in Sep and Oct only.
    expect(found).toMatchInlineSnapshot(`
      [
        "yellow | Remove Disney+ Premium | save 35.68 | lose Disney+ Premium",
      ]
    `);
    expect(found.join('\n')).not.toMatch(/Remove Netflix/);
  });
});

describe('optimize: ranked perks (M11.6)', () => {
  const ultimate = (rankOverrides: ListItem['rankOverrides'] = {}) =>
    item('game-pass.ultimate', {}, { rankOverrides });

  it('suggests the cheaper plan when its perk is unranked', () => {
    expect(cards(run([ultimate()]))).toMatchInlineSnapshot(`
      [
        "red | Downgrade Game Pass Ultimate → Essential | save 151.20 | lose perk:game-pass/fortnite-crew (not-ranked)",
      ]
    `);
  });

  it('never drops a perk ranked Needed, a lost Wanted one is yellow, and names it', () => {
    expect(cards(run([ultimate({ 'perk:game-pass/fortnite-crew': 'needed' })]))).toEqual([]);
    expect(cards(run([ultimate({ 'perk:game-pass/fortnite-crew': 'wanted' })])))
      .toMatchInlineSnapshot(`
      [
        "yellow | Downgrade Game Pass Ultimate → Essential | save 151.20 | lose perk:game-pass/fortnite-crew (wanted)",
      ]
    `);
    const result = run([ultimate({ 'perk:game-pass/fortnite-crew': 'wanted' })]);
    expect(result.suggestions[0]?.lost.map((change) => change.label)).toContain('Fortnite Crew');
  });
});

describe('optimize: duplicates, family members and extra members', () => {
  it('never removes one of two accounts of the same provider, and suggests an extra member instead', () => {
    const mine = item('netflix.standard', {}, { nickname: 'Mine' });
    const sams = item('netflix.standard', { anchorDate: '2026-11-20' }, { nickname: "Sam's" });
    const result = run([mine, sams], { 'streaming.ad-free': 'wanted' });
    // Sam's extra member joins on Sam's next charge, so it adds nothing to Mine's charge before (M8.5).
    expect(cards(result)).toMatchInlineSnapshot(`
      [
        "free | Make Sam's (Netflix Standard) an extra member on Mine (Netflix Standard) | save 146.99",
        "yellow | Downgrade Mine (Netflix Standard) → Standard with ads | save 138.60 | lose streaming.ad-free (wanted)",
        "yellow | Downgrade Sam's (Netflix Standard) → Standard with ads | save 138.60 | lose streaming.ad-free (wanted)",
      ]
    `);
    expect(cards(result).join('\n')).not.toMatch(/Remove/);
  });

  it('counts every copy toward the totals, and fits two extra members on Premium', () => {
    const items = [item('netflix.premium'), item('netflix.standard'), item('netflix.standard')];
    const result = run(items, { 'streaming.ad-free': 'needed' });
    expect(result.next12).toBeCloseTo((23.99 + 2 * 18.99) * 12 * 1.05, 6);
    expect(cards(result)).toMatchInlineSnapshot(`
      [
        "free | Make Netflix Standard an extra member on Netflix Premium + Make Netflix Standard an extra member on Netflix Premium | save 277.20",
      ]
    `);
  });
});

describe('optimize: billing dates', () => {
  it('a plan billed on the 31st is charged every month, and moves to annual billing on its next charge', () => {
    // Billed on the 31st since Sep 30, the last day of a shorter month: next Oct 31, then Nov 30, Dec 31…
    const disney = item('disney-plus.premium', { anchorDate: '2026-09-30', billingDay: 31 });
    const [annual] = run([disney]).suggestions;
    expect(annual.actions).toMatchObject([{ kind: 'interval', on: '2026-10-31' }]);
    // Oct 31, Nov 30, Dec 31 … Sep 30: 12 charges in the next 12 months, against one yearly charge.
    expect(annual.savings).toBeCloseTo((12 * 16.99 - 169.99) * 1.05, 6);
  });

  it('changes a window plan in place: no annual billing, and the saving counts its charges alone', () => {
    const disney = item('disney-plus.premium', {
      mode: 'limited',
      windows: [{ start: '2026-09-01', end: '2026-10-31', repeatYearly: true }],
    } as Partial<ListItem['billing']>);
    const result = run([disney], { 'video.quality=4k': 'unwanted', 'video.hdr': 'unwanted' });
    expect(cards(result)).toMatchInlineSnapshot(`
      [
        "red | Downgrade Disney+ Premium → Standard | save 8.40 | lose video.quality=4k (unwanted), video.hdr (unwanted)",
      ]
    `);
    // Its next charges are Sep 1 and Oct 1, 2027, after the window of today.
    expect(result.suggestions[0].actions[0]).toMatchObject({ on: '2027-09-01' });
    expect(result.suggestions[0].savings).toBeCloseTo(2 * (16.99 - 12.99) * 1.05, 6);
  });

  it('includes the payment due today, and leaves out an item that has nothing left to pay', () => {
    const ended = item('netflix.premium', { anchorDate: '2026-10-01', endDate: '2026-10-20' });
    const result = run([ended, item('disney-plus.premium', { anchorDate: today })]);
    expect(result.next12).toBeCloseTo(12 * 16.99 * 1.05, 6);
    expect(cards(result)).toMatchInlineSnapshot(`
      [
        "free | Switch Disney+ Premium to annual billing | save 35.58",
        "red | Downgrade Disney+ Premium → Standard, annual billing | save 77.58 | lose video.quality=4k (not-ranked), video.hdr (not-ranked)",
      ]
    `);
  });
});

describe('optimize: a list too big for exhaustive search', () => {
  const ranks: Record<string, ProfileRank> = {
    'vpn.included': 'needed',
    'streaming.ad-free': 'wanted',
    'video.quality=4k': 'unused',
    'video.hdr': 'unwanted',
    'password-manager': 'needed',
  };
  const big = () => [
    item('netflix.premium', { anchorDate: '2026-11-03' }, { nickname: 'Mine' }),
    item('netflix.standard', { anchorDate: '2026-11-05' }, { nickname: "Sam's" }),
    item('netflix.standard', { anchorDate: '2026-11-07' }, { nickname: "Alex's" }),
    item('disney-plus.premium', { anchorDate: '2026-11-09' }),
    item('crave.premium', { anchorDate: '2026-11-11' }),
    item('proton.mail-plus', { anchorDate: '2026-11-13' }),
    item('proton.vpn-plus', { anchorDate: '2026-11-15' }),
    item('proton.pass-plus', { anchorDate: '2026-11-17' }),
    item('ivpn.pro', { anchorDate: '2026-11-19' }),
    item('mullvad.vpn', { anchorDate: '2026-11-21' }),
    item('disney-plus.standard', { anchorDate: '2026-11-23' }, { nickname: 'Kids' }),
    item('netflix.standard-ads', { anchorDate: '2026-11-25' }, { nickname: 'Den' }),
    item('netflix.premium', { anchorDate: '2026-11-27' }, { nickname: 'Office' }),
    item('crave.premium', { anchorDate: '2026-11-29' }, { nickname: 'Cabin' }),
    item('disney-plus.premium', { anchorDate: '2026-12-01' }, { nickname: 'Cabin' }),
    item('netflix.standard', { anchorDate: '2026-12-03' }, { nickname: "Jo's" }),
  ];

  it('falls back to greedy search with local improvement, still within the hard constraints', () => {
    const result = run(big(), ranks);
    expect(result.search).toBe('greedy');
    expect(cards(result)).toMatchInlineSnapshot(`
      [
        "free | Make Sam's (Netflix Standard) an extra member on Mine (Netflix Premium) + Make Alex's (Netflix Standard) an extra member on Mine (Netflix Premium) | save 293.98",
        "free | Replace Proton Mail Plus, Proton VPN Plus and Proton Pass Plus with Proton Unlimited | save 150.95 | gain storage.cloud=100-plus",
        "free | Make Alex's (Netflix Standard) an extra member on Jo's (Netflix Standard) | save 146.99",
        "free | Make Jo's (Netflix Standard) an extra member on Office (Netflix Premium) | save 127.05",
        "free | Replace Disney+ Premium and Crave Premium with Disney+ and Crave Premium Bundle | save 122.72",
        "free | Replace Cabin (Disney+ Premium) and Cabin (Crave Premium) with Disney+ and Crave Premium Bundle | save 112.50",
        "free | Switch Proton VPN Plus to annual billing | save 47.25",
        "free | Switch Proton Pass Plus to annual billing | save 28.35",
        "free | Switch Kids (Disney+ Standard) to annual billing | save 27.18",
        "red | Downgrade Proton Mail Plus → Free | save 78.62 | lose email.addresses=10-plus (not-ranked)",
        "red | Downgrade IVPN Pro → Standard | save 51.66 | lose vpn.multi-hop (not-ranked)",
        "orange | Make Sam's (Netflix Standard) an extra member on Mine (Netflix Premium) + Make Office (Netflix Premium) an extra member on Mine (Netflix Premium) | save 356.98 | lose video.quality=4k (unused), video.hdr (unwanted)",
        "yellow | Remove Mine (Netflix Premium) | save 302.27 | lose Mine (Netflix Premium)",
        "yellow | Remove Office (Netflix Premium) | save 302.27 | lose Office (Netflix Premium)",
        "yellow | Remove Crave Premium | save 277.20 | lose Crave Premium",
        "yellow | Remove Cabin (Crave Premium) | save 254.10 | lose Cabin (Crave Premium)",
        "yellow | Remove Alex's (Netflix Standard) | save 239.27 | lose Alex's (Netflix Standard)",
        "yellow | Remove Sam's (Netflix Standard) | save 239.27 | lose Sam's (Netflix Standard)",
        "yellow | Remove Disney+ Premium | save 214.07 | lose Disney+ Premium",
        "yellow | Remove Cabin (Disney+ Premium) | save 196.23 | lose Cabin (Disney+ Premium)",
        "yellow | Remove Proton VPN Plus | save 157.37 | lose Proton VPN Plus",
        "yellow | Remove IVPN Pro | save 153.72 | lose IVPN Pro",
        "yellow | Downgrade Jo's (Netflix Standard) → Standard with ads | save 127.05 | lose streaming.ad-free (wanted)",
        "yellow | Remove Den (Netflix Standard with ads) | save 100.67 | lose Den (Netflix Standard with ads)",
      ]
    `);
    expect(result.bestSavings).toBeGreaterThan(0);
  });

  it('runs in well under a second', () => {
    const input = {
      items: resolveAll(big(), ranks),
      catalogs: new Map([['CA', catalog]]),
      context: {
        today,
        country: 'CA',
        currency: 'CAD',
        place: { country: 'CA', subdivision: 'CA-AB' },
        profileRanks: new Map(Object.entries(ranks)),
      },
    };
    const started = performance.now();
    optimize(input);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('optimize: fingerprints', () => {
  it('stay the same for the same list, and change when the list does', () => {
    const items = [item('disney-plus.premium'), item('crave.premium')];
    const first = run(items).suggestions.map((suggestion) => suggestion.fingerprint);
    expect(run(items).suggestions.map((suggestion) => suggestion.fingerprint)).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
    expect(first.every((fingerprint) => /^[0-9a-f]{16}$/.test(fingerprint))).toBe(true);
    const moved = [
      items[0],
      { ...items[1], billing: { ...items[1].billing, anchorDate: '2026-11-11' } },
    ] as ListItem[];
    const after = run(moved).suggestions.map((suggestion) => suggestion.fingerprint);
    expect(after.some((fingerprint) => first.includes(fingerprint))).toBe(false);
    // A rank that changes how the list is judged is a change to it too.
    const ranked = run(items, { 'video.hdr': 'unwanted' }).suggestions;
    expect(ranked.some((suggestion) => first.includes(suggestion.fingerprint))).toBe(false);
  });
});

describe('optimize: an item with no exchange rate (M10.37)', () => {
  it('keeps it as it is and still suggests for the rest, rather than failing', () => {
    // No rates: Mullvad's euro price can't be converted, so it's kept, never changed, and still gives its VPN.
    const place = { country: 'CA', subdivision: 'CA-AB' };
    const context = { today, country: 'CA', currency: 'CAD', place, profileRanks: new Map() };
    const resolved = [item('mullvad.vpn'), item('disney-plus.premium')].flatMap((listItem) => {
      const resolution = resolveItem(listItem, {
        ...context,
        catalog,
        customSubs: new Map(),
        taxPlace: place,
      });
      return resolution.ok ? [resolution.resolved] : [];
    });
    expect(resolved).toHaveLength(2);
    const result = optimize({ items: resolved, catalogs: new Map([['CA', catalog]]), context });
    expect(cards(result)).toEqual([
      'free | Switch Disney+ Premium to annual billing | save 35.58',
      'red | Downgrade Disney+ Premium → Standard, annual billing | save 77.58 | lose video.quality=4k (not-ranked), video.hdr (not-ranked)',
    ]);
    expect(
      result.suggestions.every((suggestion) =>
        suggestion.actions.every((action) => !('item' in action) || action.item.name !== 'Mullvad'),
      ),
    ).toBe(true);
  });
});

describe('optimize: dismissals from before M10.33 (M10.37)', () => {
  it('keeps a dismissal of a card of several changes from before the split', () => {
    const result = run([item('disney-plus.premium'), item('crave.premium')]);
    const split = result.suggestions.filter((suggestion) => suggestion.groupFingerprint);
    expect(split).toHaveLength(2);
    const [{ groupFingerprint }] = split;
    expect(split.every((suggestion) => suggestion.groupFingerprint === groupFingerprint)).toBe(
      true,
    );
    // The old card's fingerprint, stored as dismissed, hides both; their own fingerprints are new.
    const dismissed = new Set([groupFingerprint ?? '']);
    expect(split.every((suggestion) => isDismissed(suggestion, dismissed))).toBe(true);
    expect(split.some((suggestion) => suggestion.fingerprint === groupFingerprint)).toBe(false);
    expect(suggestionSummary(result.suggestions, dismissed).count).toBe(
      result.suggestions.length - 2,
    );
  });
});

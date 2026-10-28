import { describe, expect, it } from 'vitest';
import {
  countedRanks,
  effectiveRanks,
  featureSummary,
  providedKeys,
  rankCounts,
  type Feature,
  type ListItem,
  type Plan,
  type ProfileRanks,
  type RankOverrides,
} from '../../src';

// Rank counts and the feature summary (PROJECT-PLAN §3.2) over a small registry: video quality's ladder (1080p and
// 4K are headlines), simultaneous streams' tiers, Ad free, VPN (a headline) and live TV's set.

const quality = {
  id: 'video.quality',
  name: 'Video quality',
  category: 'streaming',
  type: 'enum',
  values: [
    { id: '480p', name: '480p (SD)' },
    { id: '1080p', name: '1080p (Full HD)', headline: true },
    { id: '4k', name: '4K (Ultra HD)', headline: true },
  ],
} satisfies Feature;

const streams = {
  id: 'streaming.concurrent-streams',
  name: 'Simultaneous streams',
  category: 'streaming',
  type: 'number',
  tiers: [
    { id: '1', name: 'Single device', min: 1, max: 1 },
    { id: '2-4', name: '2 to 4 devices', min: 2, max: 4 },
    { id: '5+', name: 'More than 4 devices', min: 5 },
  ],
} satisfies Feature;

const adFree = {
  id: 'streaming.ad-free',
  name: 'Ad free',
  category: 'streaming',
  type: 'boolean',
} satisfies Feature;

const vpn = {
  id: 'vpn.included',
  name: 'VPN',
  category: 'vpn',
  type: 'boolean',
  headline: true,
} satisfies Feature;

const live = {
  id: 'streaming.live',
  name: 'Live TV and sports',
  category: 'streaming',
  type: 'set',
  values: [
    { id: 'tv-channels', name: 'Live TV channels' },
    { id: 'sports', name: 'Live sports' },
  ],
} satisfies Feature;

const registry: Feature[] = [quality, streams, adFree, vpn, live];

const profile: ProfileRanks = new Map([
  ['video.quality=1080p', 'wanted'],
  ['video.quality=4k', 'needed'],
  ['streaming.concurrent-streams=2-4', 'wanted'],
  ['streaming.concurrent-streams=5+', 'sometimes'],
  ['streaming.ad-free', 'uses'],
  ['streaming.live=sports', 'unwanted'],
]);

const today = '2026-10-27';

/** An item with `features`, resolved as resolveItem would: its provided keys and their ranks. */
function owned(
  features: Plan['features'],
  { overrides = {}, endDate }: { overrides?: RankOverrides; endDate?: string } = {},
) {
  const keys = providedKeys(features, registry);
  const item: ListItem = {
    id: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c60',
    listId: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d',
    source: { kind: 'catalog', planId: 'example.plan' },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-11-12',
      autoRenew: true,
      ...(endDate && { endDate }),
    },
    tagIds: [],
    rankOverrides: overrides as ListItem['rankOverrides'],
    pinned: false,
    createdAt: '2026-10-20T12:00:00.000Z',
    updatedAt: '2026-10-20T12:00:00.000Z',
  };
  return { item, providedKeys: keys, effectiveRanks: effectiveRanks(keys, overrides, profile) };
}

const zero = Object.fromEntries(countedRanks.map((rank) => [rank, 0]));

describe('rankCounts', () => {
  it('has every rank from Essential to Unwanted, at zero for no items', () => {
    expect(rankCounts([])).toEqual(zero);
    expect(Object.keys(rankCounts([]))).toEqual([...countedRanks]);
  });

  it('counts each rung of the quality ladder a plan reaches', () => {
    // 4K provides 480p (not ranked), 1080p (Wanted) and 4K (Needed); 1080p stops at 1080p.
    expect(rankCounts([owned({ 'video.quality': '4k' })])).toEqual({
      ...zero,
      needed: 1,
      wanted: 1,
    });
    expect(rankCounts([owned({ 'video.quality': '1080p' })])).toEqual({ ...zero, wanted: 1 });
    expect(rankCounts([owned({ 'video.quality': '480p' })])).toEqual(zero);
  });

  it('counts each tier a number reaches, unlimited reaching them all', () => {
    // 3 streams: Single device (not ranked) and 2 to 4 (Wanted); 6 and unlimited add More than 4 (Sometimes).
    expect(rankCounts([owned({ 'streaming.concurrent-streams': 3 })])).toEqual({
      ...zero,
      wanted: 1,
    });
    expect(rankCounts([owned({ 'streaming.concurrent-streams': 6 })])).toEqual({
      ...zero,
      wanted: 1,
      sometimes: 1,
    });
    expect(rankCounts([owned({ 'streaming.concurrent-streams': 'unlimited' })])).toEqual(
      rankCounts([owned({ 'streaming.concurrent-streams': 6 })]),
    );
  });

  it('counts an item’s overrides over the profile, and Not ranked as nothing', () => {
    const counts = rankCounts([
      owned(
        { 'video.quality': '4k', 'streaming.ad-free': true, 'streaming.live': ['sports'] },
        {
          overrides: {
            'video.quality=4k': 'essential',
            'streaming.ad-free': 'critical',
            'video.quality=1080p': 'not-ranked',
          },
        },
      ),
    ]);
    expect(counts).toEqual({ ...zero, essential: 1, critical: 1, unwanted: 1 });
  });

  it('counts the same plan twice when it’s listed twice', () => {
    const plan = { 'video.quality': '4k', 'streaming.ad-free': true } as const;
    expect(rankCounts([owned(plan), owned(plan)])).toEqual({
      ...zero,
      needed: 2,
      wanted: 2,
      uses: 2,
    });
  });
});

describe('featureSummary', () => {
  const rows = (...items: ReturnType<typeof owned>[]) =>
    featureSummary(items, registry, today).map(
      ({ label, active, total }) => `${label} ${active} / ${total}`,
    );

  it('shows headlines, ranked keys and what each item has itself, active items out of all that provide them', () => {
    expect(
      rows(
        owned({ 'video.quality': '4k', 'streaming.concurrent-streams': 4, 'vpn.included': true }),
        owned({ 'video.quality': '1080p', 'streaming.ad-free': true }),
        // Ended on Oct 1: in the list, but not active.
        owned({ 'video.quality': '4k', 'vpn.included': true }, { endDate: '2026-10-01' }),
      ),
    ).toEqual([
      // Needed, then the Wanted keys (the headline first), then Ad free (Uses), then the headline no one ranked.
      'Video quality: 4K (Ultra HD) 1 / 2',
      'Video quality: 1080p (Full HD) 2 / 3',
      'Simultaneous streams: 2 to 4 devices 1 / 1',
      'Ad free 1 / 1',
      'VPN 1 / 2',
    ]);
  });

  it('shows what an item has itself, whatever its rank: a boolean and its own rung of a ladder, not a set value', () => {
    // Ad free is Uses, Live sports Unwanted, 480p and Single device not ranked.
    expect(
      rows(
        owned({
          'video.quality': '480p',
          'streaming.ad-free': true,
          'streaming.live': ['sports'],
          'streaming.concurrent-streams': 1,
        }),
      ),
    ).toEqual([
      'Ad free 1 / 1',
      'Simultaneous streams: Single device 1 / 1',
      'Video quality: 480p (SD) 1 / 1',
    ]);
  });

  it('leaves out the lower rungs a higher one provides, unless they’re headlines or ranked, and keys no item provides', () => {
    // 4 streams provide Single device too, and 4K provides 480p: neither is ranked or a headline. Nothing has a VPN.
    expect(rows(owned({ 'video.quality': '4k', 'streaming.concurrent-streams': 4 }))).toEqual([
      'Video quality: 4K (Ultra HD) 1 / 1',
      'Video quality: 1080p (Full HD) 1 / 1',
      'Simultaneous streams: 2 to 4 devices 1 / 1',
    ]);
  });

  it('adds keys an item ranks Essential or Critical, ordered by their highest rank across the items', () => {
    expect(
      rows(
        owned(
          { 'streaming.live': ['tv-channels'], 'video.quality': '1080p' },
          { overrides: { 'streaming.live=tv-channels': 'critical' } },
        ),
        owned({ 'video.quality': '1080p' }, { overrides: { 'video.quality=1080p': 'essential' } }),
      ),
    ).toEqual([
      'Video quality: 1080p (Full HD) 2 / 2',
      'Live TV and sports: Live TV channels 1 / 1',
    ]);
  });

  it('orders a key by its highest rank across the items, so one an item ranks lower keeps the profile’s place', () => {
    const lower = owned(
      { 'streaming.concurrent-streams': 3, 'streaming.ad-free': true },
      { overrides: { 'streaming.concurrent-streams=2-4': 'unused' } },
    );
    // Ad free is Uses: before the streams an item ranks Unused, after them once another item has them at Wanted.
    expect(rows(lower)).toEqual(['Ad free 1 / 1', 'Simultaneous streams: 2 to 4 devices 1 / 1']);
    expect(rows(owned({ 'streaming.concurrent-streams': 3 }), lower)).toEqual([
      'Simultaneous streams: 2 to 4 devices 2 / 2',
      'Ad free 1 / 1',
    ]);
  });

  it('gives each row its key, and takes every key of a valued feature marked headline', () => {
    const headlined: Feature[] = [{ ...live, headline: true }];
    expect(
      featureSummary(
        [owned({ 'streaming.live': ['tv-channels', 'sports'] })],
        headlined,
        today,
      ).map(({ key, label }) => [key, label]),
    ).toEqual([
      // Live sports is Unwanted, after the unranked Live TV channels.
      ['streaming.live=tv-channels', 'Live TV and sports: Live TV channels'],
      ['streaming.live=sports', 'Live TV and sports: Live sports'],
    ]);
  });
});

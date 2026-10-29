import { describe, expect, it } from 'vitest';
import {
  rankChanges,
  rankGroup,
  rankSiblings,
  sharedRankEdits,
  sharedRanksFor,
  type RankSibling,
} from '../../src';

// Shared ranks (P6, M6.14): a rank changed in one plan's dialog goes to its provider's other plans in the list.

const custom = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c50';

function sibling(
  id: string,
  planId: string,
  rankOverrides: RankSibling['item']['rankOverrides'] = {},
  extra: Partial<RankSibling['item']> = {},
  providedKeys = ['streaming.ad-free', 'video.quality=4k'],
): RankSibling {
  return {
    item: { id, source: { kind: 'catalog', planId }, rankOverrides, ...extra },
    providedKeys,
  };
}

describe('rankGroup', () => {
  it('is a catalog plan’s provider or a custom subscription, and none for a bundle', () => {
    expect(rankGroup({ kind: 'catalog', planId: 'netflix.standard' })).toBe('provider netflix');
    expect(rankGroup({ kind: 'custom', customSubId: custom, customPlanId: custom })).toBe(
      `custom ${custom}`,
    );
    expect(rankGroup({ kind: 'bundle', bundleId: 'bundle.netflix-crave' })).toBeUndefined();
  });
});

describe('rankChanges', () => {
  it('gives the keys whose rank changed, a cleared one as undefined, and only the keys asked about', () => {
    const changes = rankChanges(
      { 'streaming.ad-free': 'needed', 'video.quality=4k': 'wanted', 'vpn.included': 'needed' },
      { 'streaming.ad-free': 'critical', 'video.quality=4k': 'wanted' },
      ['streaming.ad-free', 'video.quality=4k', 'live-tv'],
    );
    expect([...changes]).toEqual([['streaming.ad-free', 'critical']]);
    expect([...rankChanges({ 'streaming.ad-free': 'needed' }, {}, ['streaming.ad-free'])]).toEqual([
      ['streaming.ad-free', undefined],
    ]);
  });
});

describe('sharedRankEdits', () => {
  const standard = sibling('a', 'netflix.standard');
  const ads = sibling('b', 'netflix.standard-ads', { 'video.quality=4k': 'unwanted' }, {}, [
    'video.quality=4k',
  ]);
  const premium = sibling('c', 'netflix.premium', { 'streaming.ad-free': 'essential' });
  const crave = sibling('d', 'crave.premium');

  it('gives the changes to the provider’s other plans that provide each key, leaving other providers alone', () => {
    const edits = sharedRankEdits(
      standard.item,
      new Map([
        ['video.quality=4k', 'needed'],
        ['streaming.ad-free', 'critical'],
      ]),
      [standard, ads, premium, crave],
    );
    expect(edits).toEqual([
      // Standard with ads doesn't provide ad free.
      { kind: 'change', itemId: 'b', changes: { rankOverrides: { 'video.quality=4k': 'needed' } } },
      // Premium keeps its Essential.
      {
        kind: 'change',
        itemId: 'c',
        changes: {
          rankOverrides: { 'streaming.ad-free': 'essential', 'video.quality=4k': 'needed' },
        },
      },
    ]);
  });

  it('clears a cleared rank, and never shares Essential', () => {
    expect(
      sharedRankEdits(standard.item, new Map([['video.quality=4k', undefined]]), [standard, ads]),
    ).toEqual([{ kind: 'change', itemId: 'b', changes: { rankOverrides: {} } }]);
    expect(
      sharedRankEdits(standard.item, new Map([['video.quality=4k', 'essential']]), [standard, ads]),
    ).toEqual([]);
  });

  it('shares nothing from or to a plan with ranks of its own', () => {
    const own = sibling('e', 'netflix.standard', {}, { ownRanks: true });
    const change = new Map([['video.quality=4k', 'needed' as const]]);
    expect(sharedRankEdits(own.item, change, [own, ads])).toEqual([]);
    expect(sharedRankEdits(standard.item, change, [standard, own])).toEqual([]);
  });

  it('makes no edit for a sibling that has the rank already', () => {
    expect(
      sharedRankEdits(standard.item, new Map([['video.quality=4k', 'unwanted']]), [standard, ads]),
    ).toEqual([]);
  });
});

describe('sharedRanksFor', () => {
  it('starts a new plan with each key’s rank from the first sibling that ranks it, but not Essential', () => {
    const premium = sibling('c', 'netflix.premium', {
      'streaming.ad-free': 'essential',
      'video.quality=4k': 'needed',
    });
    const ads = sibling('b', 'netflix.standard-ads', {
      'streaming.ad-free': 'wanted',
      'video.quality=4k': 'unwanted',
    });
    const added = { id: 'new', source: { kind: 'catalog' as const, planId: 'netflix.standard' } };
    expect(sharedRanksFor(added, [premium])).toEqual({ 'video.quality=4k': 'needed' });
    expect(sharedRanksFor(added, [premium, ads])).toEqual({
      'video.quality=4k': 'needed',
      'streaming.ad-free': 'wanted',
    });
    expect(
      sharedRanksFor(added, [sibling('d', 'crave.premium', { 'video.quality=4k': 'needed' })]),
    ).toEqual({});
    expect(rankSiblings({ ...added, ownRanks: true }, [premium])).toEqual([]);
  });
});

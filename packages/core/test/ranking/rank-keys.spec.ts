import { describe, expect, it } from 'vitest';
import {
  providedKeys,
  providesKey,
  rankKeyOptions,
  type Feature,
  type RankKeyOption,
} from '../../src';

const quality = {
  id: 'video.quality',
  name: 'Video quality',
  category: 'streaming',
  type: 'enum',
  values: [
    { id: '1080p', name: '1080p (Full HD)' },
    { id: '4k', name: '4K (Ultra HD)', aliases: ['uhd'] },
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
  ],
} satisfies Feature;

const adFree = {
  id: 'streaming.ad-free',
  name: 'Ad free',
  category: 'streaming',
  type: 'boolean',
  aliases: ['no ads'],
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

function option(feature: Feature, key: string): RankKeyOption {
  const found = rankKeyOptions(feature).find((candidate) => candidate.key === key);
  if (!found) {
    throw new Error(`No rank key ${key}`);
  }
  return found;
}

describe('rankKeyOptions', () => {
  it("gives a boolean one key, with the feature's name and aliases", () => {
    expect(rankKeyOptions(adFree)).toEqual([
      { key: 'streaming.ad-free', feature: adFree, name: 'Ad free', aliases: ['no ads'] },
    ]);
  });

  it('gives an enum one key per value, a number one per tier and a set one per value', () => {
    expect(rankKeyOptions(quality)).toEqual([
      {
        key: 'video.quality=1080p',
        feature: quality,
        option: '1080p',
        name: '1080p (Full HD)',
        aliases: [],
      },
      {
        key: 'video.quality=4k',
        feature: quality,
        option: '4k',
        name: '4K (Ultra HD)',
        aliases: ['uhd'],
      },
    ]);
    expect(rankKeyOptions(streams).map((found) => found.key)).toEqual([
      'streaming.concurrent-streams=1',
      'streaming.concurrent-streams=2-4',
    ]);
    expect(rankKeyOptions(live).map((found) => found.key)).toEqual([
      'streaming.live=tv-channels',
      'streaming.live=sports',
    ]);
  });

  it('gives none to a feature that is not rankable, a number without tiers or a set of provider ids', () => {
    expect(rankKeyOptions({ ...adFree, rankable: false })).toEqual([]);
    expect(
      rankKeyOptions({ id: 'storage.cloud', name: 'Cloud', category: 'storage', type: 'number' }),
    ).toEqual([]);
    expect(
      rankKeyOptions({
        id: 'includes-subscription',
        name: 'Includes',
        category: 'bundle',
        type: 'set',
        valuesFrom: 'providers',
      }),
    ).toEqual([]);
  });
});

describe('providesKey', () => {
  it('needs a boolean to be true', () => {
    expect(providesKey({ 'streaming.ad-free': true }, option(adFree, 'streaming.ad-free'))).toBe(
      true,
    );
    expect(providesKey({ 'streaming.ad-free': false }, option(adFree, 'streaming.ad-free'))).toBe(
      false,
    );
    expect(providesKey({}, option(adFree, 'streaming.ad-free'))).toBe(false);
  });

  it('counts an enum value as providing every value below it', () => {
    const fullHd = option(quality, 'video.quality=1080p');
    const uhd = option(quality, 'video.quality=4k');

    expect(providesKey({ 'video.quality': '4k' }, fullHd)).toBe(true);
    expect(providesKey({ 'video.quality': '4k' }, uhd)).toBe(true);
    expect(providesKey({ 'video.quality': '1080p' }, uhd)).toBe(false);
    expect(providesKey({}, fullHd)).toBe(false);
  });

  it("counts a number from its tier's min, and unlimited as every tier", () => {
    const some = option(streams, 'streaming.concurrent-streams=2-4');

    expect(providesKey({ 'streaming.concurrent-streams': 2 }, some)).toBe(true);
    expect(providesKey({ 'streaming.concurrent-streams': 6 }, some)).toBe(true);
    expect(providesKey({ 'streaming.concurrent-streams': 1 }, some)).toBe(false);
    expect(providesKey({ 'streaming.concurrent-streams': 'unlimited' }, some)).toBe(true);
  });

  it('needs a set to contain the value', () => {
    const sports = option(live, 'streaming.live=sports');

    expect(providesKey({ 'streaming.live': ['tv-channels', 'sports'] }, sports)).toBe(true);
    expect(providesKey({ 'streaming.live': ['tv-channels'] }, sports)).toBe(false);
    expect(providesKey({}, sports)).toBe(false);
  });
});

describe('providedKeys', () => {
  it('lists every key the features provide, in registry order, whatever order the plan lists them in', () => {
    const features = {
      'streaming.live': ['sports'],
      'streaming.concurrent-streams': 4,
      'streaming.ad-free': true,
      'video.quality': '4k',
    };

    expect(providedKeys(features, [quality, streams, adFree, live])).toEqual([
      'video.quality=1080p',
      'video.quality=4k',
      'streaming.concurrent-streams=1',
      'streaming.concurrent-streams=2-4',
      'streaming.ad-free',
      'streaming.live=sports',
    ]);
  });

  it('lists none for features that provide nothing', () => {
    expect(providedKeys({ 'streaming.ad-free': false }, [quality, adFree])).toEqual([]);
  });
});

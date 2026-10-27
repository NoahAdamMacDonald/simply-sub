import { describe, expect, it } from 'vitest';
import { effectiveRanks, resolveRank, type ProfileRanks } from '../../src';

// PROJECT-PLAN §3.2's resolution order: the item's override, then the profile's rank, then not ranked.

const profile: ProfileRanks = new Map([
  ['video.quality=4k', 'needed'],
  ['streaming.ad-free', 'wanted'],
  ['password-manager', 'needed'],
]);

describe('resolveRank', () => {
  it('takes the item’s override first, then the profile’s rank, then not ranked', () => {
    const overrides = { 'video.quality=4k': 'essential' } as const;

    expect(resolveRank('video.quality=4k', overrides, profile)).toBe('essential');
    expect(resolveRank('streaming.ad-free', overrides, profile)).toBe('wanted');
    expect(resolveRank('vpn.included', overrides, profile)).toBe('not-ranked');
    expect(resolveRank('vpn.included', {}, new Map())).toBe('not-ranked');
  });

  it('takes an override of Not ranked as one, hiding the profile’s rank', () => {
    expect(resolveRank('streaming.ad-free', { 'streaming.ad-free': 'not-ranked' }, profile)).toBe(
      'not-ranked',
    );
  });

  it('gets Essential and Critical only from an override', () => {
    expect(resolveRank('vpn.included', { 'vpn.included': 'critical' }, profile)).toBe('critical');
  });

  it('never takes a group’s rank for its children', () => {
    expect(resolveRank('password-manager.item-types=passkey', {}, profile)).toBe('not-ranked');
    expect(resolveRank('password-manager', {}, profile)).toBe('needed');
  });

  it('reads only the item’s own overrides, not what objects inherit', () => {
    expect(resolveRank('toString', {}, new Map())).toBe('not-ranked');
  });
});

describe('effectiveRanks', () => {
  it('ranks each key given, in their order, not ranked ones included', () => {
    const ranks = effectiveRanks(
      ['video.quality=1080p', 'video.quality=4k', 'streaming.ad-free'],
      { 'streaming.ad-free': 'unused', 'vpn.included': 'essential' },
      profile,
    );

    expect(Object.entries(ranks)).toEqual([
      ['video.quality=1080p', 'not-ranked'],
      ['video.quality=4k', 'needed'],
      ['streaming.ad-free', 'unused'],
    ]);
  });
});

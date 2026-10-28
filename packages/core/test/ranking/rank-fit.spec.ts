import { describe, expect, it } from 'vitest';
import { countedRanks, rankScore, rankWeights, type RankCounts } from '../../src';

// How well a plan fits the user's ranks (P8's cards and its "Best for my ranks" sort).

const none = Object.fromEntries(countedRanks.map((rank) => [rank, 0])) as RankCounts;

describe('rankScore', () => {
  it('weighs Needed most of a profile’s ranks, then Wanted, Uses and Sometimes', () => {
    expect(rankScore(none)).toBe(0);
    expect(rankScore({ ...none, needed: 1 })).toBeGreaterThan(rankScore({ ...none, wanted: 1 }));
    expect(rankScore({ ...none, wanted: 1 })).toBeGreaterThan(rankScore({ ...none, uses: 1 }));
    expect(rankScore({ ...none, uses: 1 })).toBeGreaterThan(rankScore({ ...none, sometimes: 1 }));
    expect(rankScore({ ...none, unused: 3 })).toBe(0);
  });

  it('counts an Unwanted key against a plan, as much as a Needed one counts for it', () => {
    expect(rankScore({ ...none, needed: 1, unwanted: 1 })).toBe(0);
    expect(rankWeights.unwanted).toBe(-rankWeights.needed);
  });
});

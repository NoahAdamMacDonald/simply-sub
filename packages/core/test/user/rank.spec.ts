import { describe, expect, it } from 'vitest';
import { countedRanks, rankChoices } from '../../src';

describe('rankChoices', () => {
  it('offers a profile Not ranked first, then Needed to Unwanted', () => {
    expect(rankChoices('profile')).toEqual([
      'not-ranked',
      'needed',
      'wanted',
      'uses',
      'sometimes',
      'unused',
      'unwanted',
    ]);
  });

  it('adds Essential and Critical for a subscription, with Not ranked in its place', () => {
    expect(rankChoices('subscription')).toEqual([
      'essential',
      'critical',
      'needed',
      'wanted',
      'uses',
      'sometimes',
      'not-ranked',
      'unused',
      'unwanted',
    ]);
  });
});

describe('countedRanks', () => {
  it('has the eight ranks from Essential to Unwanted', () => {
    expect(countedRanks).toEqual([
      'essential',
      'critical',
      'needed',
      'wanted',
      'uses',
      'sometimes',
      'unused',
      'unwanted',
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { closestMatch } from '../../src/catalog/checks';

describe('closestMatch', () => {
  it('finds the candidate a few edits away: at most a third of the length, and at least one', () => {
    expect(closestMatch('netflx', ['crave', 'netflix', 'proton'])).toBe('netflix');
    expect(closestMatch('dinsey-plus', ['disney-plus'])).toBe('disney-plus');
    expect(closestMatch('ab', ['ac'])).toBe('ac');
    expect(closestMatch('streamco', ['crave', 'netflix', 'proton'])).toBeUndefined();
  });

  it('prefers the closest candidate, then the first of equally close ones', () => {
    expect(closestMatch('proton.vpn-plux', ['proton.vpn-pluss', 'proton.vpn-plus'])).toBe(
      'proton.vpn-plus',
    );
    expect(closestMatch('mail-plus', ['mail-plu', 'mail-pluss'])).toBe('mail-plu');
  });

  it('skips candidates whose length alone is too far off', () => {
    expect(closestMatch('vpn', ['vpn-plus-unlimited', 'vpm'])).toBe('vpm');
    expect(closestMatch('', ['a', 'ab'])).toBe('a');
  });
});

import { describe, expect, it } from 'vitest';
import {
  groupsOf,
  isCatalogRegion,
  isoRegions,
  membersOf,
  regionGroups,
  regionProblem,
} from '../../src';

describe('regions', () => {
  it('lists the 249 ISO 3166-1 alpha-2 codes, each one a named region', () => {
    expect(isoRegions.size).toBe(249);
    const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
    expect([...isoRegions].filter((code) => !names.of(code))).toEqual([]);
  });

  it('accepts ISO codes, groups and GLOBAL, and nothing else', () => {
    for (const code of ['CA', 'GB', 'SE', 'EU', 'GLOBAL']) {
      expect(isCatalogRegion(code)).toBe(true);
    }
    // UK is a common mistake for GB, and XK (Kosovo) isn't officially assigned.
    for (const code of ['UK', 'XK', 'ZZ', 'EL']) {
      expect(isCatalogRegion(code)).toBe(false);
    }
  });

  it('knows the 27 EU member states', () => {
    expect(membersOf('EU')).toHaveLength(27);
    expect(membersOf('EU').filter((code) => !isoRegions.has(code))).toEqual([]);
    expect(groupsOf('SE')).toEqual(['EU']);
    expect(groupsOf('GB')).toEqual([]);
    expect(membersOf('CA')).toEqual([]);
  });

  it('has only groups whose codes aren’t ISO codes too', () => {
    expect(Object.keys(regionGroups).filter((group) => isoRegions.has(group))).toEqual([]);
  });

  it('explains what to write instead', () => {
    expect(regionProblem('UK')).toBe(
      '"UK" isn\'t an ISO 3166-1 region code: use GB for the United Kingdom',
    );
    expect(regionProblem('XX')).toBe(
      '"XX" isn\'t an ISO 3166-1 alpha-2 region code (CA, US, GB), a group (EU) or GLOBAL',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { settingsSchema, subdivisionName, subdivisionsOf, taxAddedRegions } from '../../src';

describe('subdivisionsOf', () => {
  it('lists Canada’s 13 provinces and territories', () => {
    const codes = subdivisionsOf('CA').map((subdivision) => subdivision.code);
    expect(codes).toHaveLength(13);
    expect(codes).toContain('CA-ON');
    expect(codes).toContain('CA-YT');
  });

  it('lists the 50 US states and DC, not the territories with codes of their own', () => {
    const codes = subdivisionsOf('US').map((subdivision) => subdivision.code);
    expect(codes).toHaveLength(51);
    expect(codes).toContain('US-DC');
    expect(codes).not.toContain('US-PR');
  });

  it('has a list for every tax-added country, and none elsewhere', () => {
    for (const country of taxAddedRegions) {
      expect(subdivisionsOf(country).length).toBeGreaterThan(0);
    }
    expect(subdivisionsOf('GB')).toEqual([]);
    expect(subdivisionsOf('PR')).toEqual([]);
  });

  it.each([...taxAddedRegions])(
    'lists %s in name order, with unique codes the settings accept',
    (country) => {
      const subdivisions = subdivisionsOf(country);
      const names = subdivisions.map((subdivision) => subdivision.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
      expect(new Set(subdivisions.map((subdivision) => subdivision.code)).size).toBe(names.length);
      for (const { code } of subdivisions) {
        const settings = {
          key: 'settings',
          country,
          subdivision: code,
          currency: 'CAD',
          theme: 'system',
          updatedAt: '2026-10-26T12:00:00.000Z',
        };
        expect(settingsSchema.safeParse(settings).success).toBe(true);
      }
    },
  );
});

describe('subdivisionName', () => {
  it('names a province or state', () => {
    expect(subdivisionName('CA-ON')).toBe('Ontario');
    expect(subdivisionName('CA-NL')).toBe('Newfoundland and Labrador');
    expect(subdivisionName('US-DC')).toBe('District of Columbia');
  });

  it('has no name for a code the lists don’t have', () => {
    expect(subdivisionName('CA-XX')).toBeUndefined();
    expect(subdivisionName('GB-ENG')).toBeUndefined();
    expect(subdivisionName('')).toBeUndefined();
  });
});

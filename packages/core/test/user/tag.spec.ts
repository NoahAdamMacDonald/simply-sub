import { describe, expect, it } from 'vitest';
import { tagColorPresets, tagColorSchema } from '../../src';

describe('tagColorPresets', () => {
  it('has 12 colours a tag can store, each named once', () => {
    expect(tagColorPresets).toHaveLength(12);
    for (const { color } of tagColorPresets) expect(tagColorSchema.parse(color)).toBe(color);
    expect(new Set(tagColorPresets.map((preset) => preset.name)).size).toBe(12);
    expect(new Set(tagColorPresets.map((preset) => preset.color)).size).toBe(12);
  });
});

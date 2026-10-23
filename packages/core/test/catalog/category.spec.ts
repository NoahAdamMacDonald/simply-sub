import { describe, expect, it } from 'vitest';
import { categoriesFileSchema } from '../../src';
import { categories } from './fixtures';
import { issues, withValue } from './helpers';

describe('categoriesFileSchema', () => {
  it('accepts service, feature and spend categories', () => {
    expect(categoriesFileSchema.parse(categories)).toEqual(categories);
  });

  it.each([
    [
      'a service category without an icon',
      withValue(categories, ['service', 0, 'icon'], undefined),
      'service.0.icon: Invalid input: expected string, received undefined',
    ],
    [
      'an icon on a feature category',
      withValue(categories, ['feature', 0, 'icon'], 'live_tv'),
      'feature.0: Unrecognized key: "icon"',
    ],
    ['an empty list', withValue(categories, ['spend'], []), 'spend: List at least one category'],
    [
      'a missing list',
      withValue(categories, ['spend'], undefined),
      'spend: Invalid input: expected array, received undefined',
    ],
    ['an unknown list', withValue(categories, ['payment'], []), ': Unrecognized key: "payment"'],
    [
      'a badly formed icon',
      withValue(categories, ['service', 0, 'icon'], 'Live TV'),
      'service.0.icon: Use a Material Symbols icon name (live_tv)',
    ],
  ])('rejects %s', (_name, value, expected) => {
    expect(issues(categoriesFileSchema, value)).toEqual([expected]);
  });
});

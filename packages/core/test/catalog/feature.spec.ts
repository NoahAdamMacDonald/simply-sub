import { describe, expect, it } from 'vitest';
import { featureSchema, featuresFileSchema, featureValueSchema } from '../../src';
import { features } from './fixtures';
import { issues, withValue } from './helpers';

const [booleanFeature, enumFeature, numberFeature, , setFeature, providersSetFeature] = features;

describe('featuresFileSchema', () => {
  it('accepts every feature type and returns the data unchanged', () => {
    expect(featuresFileSchema.parse(features)).toEqual(features);
  });

  it('reports the index of the feature that is wrong', () => {
    expect(issues(featuresFileSchema, withValue(features, [2, 'unit'], ''))).toEqual([
      '2.unit: Must not be empty',
    ]);
  });
});

describe('featureSchema', () => {
  it.each([
    [
      'a typo in a key',
      withValue(booleanFeature, ['nmae'], 'Ad free'),
      [': Unrecognized key: "nmae"'],
    ],
    [
      'a missing category',
      withValue(booleanFeature, ['category'], undefined),
      ['category: Invalid input: expected string, received undefined'],
    ],
    [
      'an unknown type',
      withValue(booleanFeature, ['type'], 'bool'),
      ["type: Invalid discriminator value. Expected 'boolean' | 'number' | 'enum' | 'set'"],
    ],
    [
      'a key that belongs to another type',
      withValue(booleanFeature, ['tiers'], []),
      [': Unrecognized key: "tiers"'],
    ],
    [
      'an enum without values',
      withValue(enumFeature, ['values'], undefined),
      ['values: Invalid input: expected array, received undefined'],
    ],
    [
      'shorthand values instead of objects',
      withValue(enumFeature, ['values'], ['720p', '4k']),
      [
        'values.0: Invalid input: expected object, received string',
        'values.1: Invalid input: expected object, received string',
      ],
    ],
    [
      'a duplicated value id',
      withValue(enumFeature, ['values', 2, 'id'], '720p'),
      ['values.2.id: "720p" is listed more than once'],
    ],
    [
      'an unquoted tier id',
      withValue(numberFeature, ['tiers', 0, 'id'], 1),
      [
        'tiers.0.id: Use a tier id such as 1, 2-4 or 5+ (in YAML, quote ids that are plain numbers: "1")',
      ],
    ],
    [
      'a tier whose max is below its min',
      withValue(numberFeature, ['tiers', 1, 'max'], 1),
      ['tiers.1.max: max must be at least min'],
    ],
    [
      'a duplicated tier id',
      withValue(numberFeature, ['tiers', 2, 'id'], '1'),
      ['tiers.2.id: "1" is listed more than once'],
    ],
    [
      'a set with both values and valuesFrom',
      withValue(setFeature, ['valuesFrom'], 'providers'),
      ['valuesFrom: Use values or valuesFrom, not both'],
    ],
    [
      'a set with neither values nor valuesFrom',
      withValue(providersSetFeature, ['valuesFrom'], undefined),
      [': List values, or set valuesFrom: providers'],
    ],
    [
      'valuesFrom other than providers',
      withValue(providersSetFeature, ['valuesFrom'], 'plans'),
      ['valuesFrom: Invalid input: expected "providers"'],
    ],
    [
      'a badly formed id',
      withValue(setFeature, ['parent'], 'Password Manager'),
      [
        'parent: Use kebab-case segments joined by dots (video.quality, password-manager.item-types)',
      ],
    ],
  ])('rejects %s', (_name, feature, expected) => {
    expect(issues(featureSchema, feature)).toEqual(expected);
  });
});

describe('featureValueSchema', () => {
  it.each([
    true,
    false,
    0,
    4,
    2.5,
    'unlimited',
    '4k',
    ['login', 'passkey'],
    ['proton.pass-plus'],
    [],
  ])('accepts %j', (value) => {
    expect(issues(featureValueSchema, value)).toEqual([]);
  });

  it.each([
    [-1, ': Must be 0 or more'],
    [
      '4K',
      ': Use a kebab-case id: lowercase letters and digits, joined by single hyphens (disney-plus)',
    ],
    [
      'Unlimited',
      ': Use a kebab-case id: lowercase letters and digits, joined by single hyphens (disney-plus)',
    ],
    [
      ['Login'],
      '0: Use kebab-case segments joined by dots (video.quality, password-manager.item-types)',
    ],
    [[1], ': Use true or false, a number, unlimited, a value id, or a list of value ids'],
    [{}, ': Use true or false, a number, unlimited, a value id, or a list of value ids'],
    [null, ': Use true or false, a number, unlimited, a value id, or a list of value ids'],
  ])('rejects %j', (value, expected) => {
    expect(issues(featureValueSchema, value)).toEqual([expected]);
  });
});

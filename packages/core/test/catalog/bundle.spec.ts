import { describe, expect, it } from 'vitest';
import { bundleSchema } from '../../src';
import { bundle } from './fixtures';
import { issues, withValue } from './helpers';

describe('bundleSchema', () => {
  it('accepts a valid bundle and returns it unchanged', () => {
    expect(bundleSchema.parse(bundle)).toEqual(bundle);
  });

  it.each([
    [
      'an id without the bundle. prefix',
      ['id'],
      'disney-crave-premium',
      ['id: Use bundle.<slug> (bundle.disney-crave-premium)'],
    ],
    [
      'a provider id among the plans',
      ['includes', 1],
      'crave',
      ['includes.1: Use <provider id>.<slug> (netflix.standard)'],
    ],
    [
      'a single plan',
      ['includes'],
      ['crave.premium'],
      ['includes: A bundle includes at least two plans'],
    ],
    [
      'a plan listed twice',
      ['includes'],
      ['crave.premium', 'crave.premium'],
      ['includes.1: "crave.premium" is listed more than once'],
    ],
    ['no prices', ['prices'], [], ['prices: List at least one price']],
  ])('rejects %s', (_name, path, value, expected) => {
    expect(issues(bundleSchema, withValue(bundle, path, value))).toEqual(expected);
  });

  it('rejects the old provider key for the seller', () => {
    const old = withValue(withValue(bundle, ['soldBy'], undefined), ['provider'], 'crave');
    expect(issues(bundleSchema, old)).toEqual([
      'soldBy: Invalid input: expected string, received undefined',
      ': Unrecognized key: "provider"',
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { catalogJsonSchemas } from '../../src';
import { at } from './helpers';

const schemas = catalogJsonSchemas();

describe('catalogJsonSchemas', () => {
  it('describes every kind of catalog file', () => {
    expect(Object.keys(schemas)).toEqual([
      'features',
      'categories',
      'provider',
      'bundle',
      'resellers',
      'policy-topics',
    ]);
    for (const schema of Object.values(schemas)) {
      expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(schema.title).toMatch(/^Simply Sub /);
    }
  });

  it('rejects unknown keys at every level, so the editor flags typos', () => {
    const plan = at(schemas.provider, 'properties', 'plans', 'items');
    expect(at(schemas.provider, 'additionalProperties')).toBe(false);
    expect(at(plan, 'additionalProperties')).toBe(false);
    expect(at(plan, 'properties', 'prices', 'items', 'additionalProperties')).toBe(false);
    expect(at(schemas.provider, 'properties', 'sources', 'additionalProperties')).toBe(false);
    expect(at(schemas.bundle, 'additionalProperties')).toBe(false);
    expect(at(schemas.categories, 'properties', 'service', 'items', 'additionalProperties')).toBe(
      false,
    );
  });

  it('lists the required keys', () => {
    expect(at(schemas.provider, 'required')).toEqual([
      'id',
      'name',
      'website',
      'category',
      'spendCategory',
      'cancelUrl',
      'plans',
    ]);
    expect(at(schemas.provider, 'properties', 'plans', 'items', 'required')).toEqual([
      'id',
      'name',
      'link',
      'features',
      'prices',
    ]);
    expect(at(schemas.bundle, 'required')).toEqual([
      'id',
      'name',
      'soldBy',
      'includes',
      'link',
      'prices',
    ]);
    expect(
      at(
        schemas.provider,
        'properties',
        'plans',
        'items',
        'properties',
        'prices',
        'items',
        'required',
      ),
    ).toEqual([
      'region',
      'currency',
      'amount',
      'interval',
      'intervalCount',
      'autoRenew',
      'lastVerified',
    ]);
  });

  it('offers one branch per feature type, so the editor suggests the keys that type allows', () => {
    const branches = at(schemas.features, 'items', 'oneOf') as unknown[];
    expect(branches.map((branch) => at(branch, 'properties', 'type', 'const'))).toEqual([
      'boolean',
      'number',
      'enum',
      'set',
    ]);
    expect(Object.keys(at(branches[0], 'properties') as object)).not.toContain('values');
    expect(at(branches[2], 'required')).toContain('values');
  });

  it('carries the readable format messages and descriptions for the editor', () => {
    const price = at(schemas.bundle, 'properties', 'prices', 'items', 'properties');
    expect(at(price, 'currency', 'pattern')).toBe('^[A-Z]{3}$');
    expect(at(price, 'currency', 'patternErrorMessage')).toBe(
      'Use a three-letter ISO 4217 currency code in capitals (CAD)',
    );
    expect(at(price, 'amount', 'description')).toBe(
      "In the currency's major unit: 18.99 means $18.99. 0 means a free plan",
    );
    expect(at(price, 'sourceUrl', 'pattern')).toBe('^https://');
    expect(at(price, 'interval', 'enum')).toEqual(['day', 'week', 'month', 'year']);
  });
});

import { describe, expect, it } from 'vitest';
import {
  catalogCacheSchema,
  customSubscriptionSchema,
  fxCacheSchema,
  paymentCardSchema,
  profileRankingSchema,
  settingsSchema,
  subscriptionListSchema,
  tagSchema,
} from '../../src';
import { issues, withValue } from '../catalog/helpers';
import {
  card,
  catalogCache,
  customPlanId,
  customSub,
  fullCatalogCache,
  fxCache,
  list,
  ranking,
  settings,
  tag,
} from './fixtures';

describe('subscriptionListSchema', () => {
  it('accepts a list and returns it unchanged', () => {
    expect(subscriptionListSchema.parse(list)).toEqual(list);
  });

  it('trims the name', () => {
    expect(subscriptionListSchema.parse({ ...list, name: '  Family  ' }).name).toBe('Family');
  });

  it.each([
    ['empty', '  ', 'name: Must not be empty'],
    ['over 60 characters', 'x'.repeat(61), 'name: Use at most 60 characters'],
  ])('rejects a name that is %s', (_name, name, expected) => {
    expect(issues(subscriptionListSchema, { ...list, name })).toEqual([expected]);
  });

  it('accepts a soft-deleted list', () => {
    const deleted = { ...list, deletedAt: list.updatedAt };
    expect(issues(subscriptionListSchema, deleted)).toEqual([]);
  });
});

describe('customSubscriptionSchema', () => {
  it('accepts a custom subscription and returns it unchanged', () => {
    expect(customSubscriptionSchema.parse(customSub)).toEqual(customSub);
  });

  it('accepts a free plan', () => {
    const free = withValue(customSub, ['plans', 0, 'price', 'amount'], 0);
    expect(issues(customSubscriptionSchema, free)).toEqual([]);
  });

  it('requires a plan', () => {
    expect(issues(customSubscriptionSchema, { ...customSub, plans: [] })).toEqual([
      'plans: List at least one plan',
    ]);
  });

  it('rejects two plans with the same id', () => {
    const twice = { ...customSub, plans: [customSub.plans[0], customSub.plans[0]] };
    expect(issues(customSubscriptionSchema, twice)).toEqual([
      `plans.1.id: "${customPlanId}" is listed more than once`,
    ]);
  });

  it.each([
    ['http://gym.example.com', 'link'],
    ['javascript:alert(1)', 'link'],
    ['https://192.168.0.1', 'cancelUrl'],
  ])('rejects %s, which is not an https:// URL on a domain', (url, field) => {
    const found = issues(customSubscriptionSchema, { ...customSub, [field]: url });
    expect(new Set(found)).toEqual(new Set([`${field}: Use a full https:// URL`]));
  });

  it('rejects a feature value of the wrong type', () => {
    const value = withValue(customSub, ['plans', 0, 'features', 'streaming.ad-free'], {});
    expect(issues(customSubscriptionSchema, value)).toHaveLength(1);
  });
});

describe('profileRankingSchema', () => {
  it('accepts a ranking and returns it unchanged', () => {
    expect(profileRankingSchema.parse(ranking)).toEqual(ranking);
  });

  it.each(['essential', 'critical', 'not-ranked'])('rejects %s, never a profile rank', (rank) => {
    expect(issues(profileRankingSchema, { ...ranking, rank })).toHaveLength(1);
  });

  it('accepts a cleared ranking, which is soft-deleted', () => {
    const cleared = { ...ranking, deletedAt: ranking.updatedAt };
    expect(issues(profileRankingSchema, cleared)).toEqual([]);
  });
});

describe('tagSchema', () => {
  it('accepts a tag and returns it unchanged', () => {
    expect(tagSchema.parse(tag)).toEqual(tag);
  });

  it.each(['#1E88E5', '#000000'])('accepts the colour %s', (color) => {
    expect(issues(tagSchema, { ...tag, color })).toEqual([]);
  });

  it.each(['#fff', 'red', 'var(--x)', '#1e88e5; background: url(x)'])(
    'rejects the colour %s',
    (color) => {
      expect(issues(tagSchema, { ...tag, color })).toEqual(['color: Use a hex colour, #rrggbb']);
    },
  );
});

describe('paymentCardSchema', () => {
  it('accepts a card and returns it unchanged', () => {
    expect(paymentCardSchema.parse(card)).toEqual(card);
  });

  it.each(['Visa 2026', 'Card 1234 5678', 'Points 123456789012x'.slice(0, 14)])(
    'accepts a name with a few digits: %s',
    (name) => {
      expect(issues(paymentCardSchema, { ...card, name })).toEqual([]);
    },
  );

  it.each([
    '4111111111111111',
    '4111 1111 1111 1111',
    '4111-1111-1111-1111',
    'My card 5500 0000 0000 0004',
  ])('rejects a card number in the name or nickname: %s', (text) => {
    expect(issues(paymentCardSchema, { ...card, name: text })).toEqual([
      'name: Never enter a card number',
    ]);
    expect(issues(paymentCardSchema, { ...card, nickname: text })).toEqual([
      'nickname: Never enter a card number',
    ]);
  });

  it.each([
    ['cashbackPercent', 21],
    ['cashbackPercent', -1],
    ['fxFeePercent', 11],
    ['monthlyLimit', 0],
  ])('rejects %s of %d', (field, value) => {
    expect(issues(paymentCardSchema, { ...card, [field]: value })).toHaveLength(1);
  });

  it('rejects a network that is not listed', () => {
    expect(issues(paymentCardSchema, { ...card, network: 'diners' })).toHaveLength(1);
  });
});

describe('settingsSchema', () => {
  it('accepts settings and returns them unchanged', () => {
    expect(settingsSchema.parse(settings)).toEqual(settings);
  });

  it('accepts settings without the optional fields', () => {
    const minimal = {
      key: 'settings',
      country: 'SE',
      currency: 'SEK',
      theme: 'dark',
      updatedAt: settings.updatedAt,
    };
    expect(issues(settingsSchema, minimal)).toEqual([]);
  });

  it('keeps Search’s Sold in default when it’s on', () => {
    expect(issues(settingsSchema, { ...settings, searchSoldOnly: true })).toEqual([]);
  });

  it('rejects a subdivision of another country', () => {
    expect(issues(settingsSchema, { ...settings, subdivision: 'US-NY' })).toEqual([
      'subdivision: Use a subdivision of the chosen country',
    ]);
  });

  it('rejects a subdivision that is not ISO 3166-2', () => {
    expect(issues(settingsSchema, { ...settings, subdivision: 'Ontario' })).toEqual([
      'subdivision: Use an ISO 3166-2 code (CA-ON)',
    ]);
  });

  it.each([
    ['key', 'user'],
    ['country', 'EU'],
    ['theme', 'auto'],
    ['monthlyBudget', 0],
    ['salesTaxPercent', 101],
    // Search's Sold in default is kept only when it's on.
    ['searchSoldOnly', false],
  ])('rejects a %s of %j', (field, value) => {
    expect(issues(settingsSchema, { ...settings, [field]: value })).toHaveLength(1);
  });
});

describe('catalogCacheSchema', () => {
  it('accepts a region file under its region, and the full catalog under catalog', () => {
    expect(catalogCacheSchema.parse(catalogCache)).toEqual(catalogCache);
    expect(catalogCacheSchema.parse(fullCatalogCache)).toEqual(fullCatalogCache);
  });

  it.each([
    ['a region file under another region', { ...catalogCache, key: 'US' }],
    ['a region file as the full catalog', { ...catalogCache, key: 'catalog' }],
    ['the full catalog under a region', { ...fullCatalogCache, key: 'CA' }],
  ])('rejects %s', (_name, record) => {
    expect(issues(catalogCacheSchema, record)).toEqual([
      "key: Use the file's meta.region, or catalog for the full catalog",
    ]);
  });

  it('rejects a key that is neither a region nor catalog', () => {
    expect(issues(catalogCacheSchema, { ...catalogCache, key: 'ca' })).toContain(
      'key: Use a two-letter ISO 3166-1 region in capitals (CA, US) or GLOBAL',
    );
  });

  it("checks the file with the catalog's own schemas", () => {
    const tampered = withValue(
      catalogCache,
      ['snapshot', 'data', 'providers', 0, 'website'],
      'javascript:alert(1)',
    );
    expect(new Set(issues(catalogCacheSchema, tampered))).toEqual(
      new Set(['snapshot.data.providers.0.website: Use a full https:// URL']),
    );
  });

  it('rejects a fetchedAt that toISOString would not write', () => {
    expect(
      issues(catalogCacheSchema, { ...catalogCache, fetchedAt: '2026-10-23T12:30:00Z' }),
    ).toHaveLength(1);
  });
});

describe('fxCacheSchema', () => {
  it('accepts the rates fetched and returns them unchanged', () => {
    expect(fxCacheSchema.parse(fxCache)).toEqual(fxCache);
  });

  it.each([
    ['another key', ['key'], 'rates'],
    ['a rate that is not positive', ['rates', 'rates', 'USD'], 0],
    ['a base that is not a currency code', ['rates', 'base'], 'cad'],
    ['a fetchedAt without milliseconds', ['fetchedAt'], '2026-10-22T06:00:02Z'],
  ])('rejects %s', (_name, path, value) => {
    expect(issues(fxCacheSchema, withValue(fxCache, path, value))).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import { listItemSchema } from '../../src';
import { issues, withValue } from '../catalog/helpers';
import { customPlanId, customSubId, item, limitedBilling } from './fixtures';

const recurring = (changes: Record<string, unknown>) =>
  withValue(item, ['billing'], { ...item.billing, ...changes });

describe('listItemSchema', () => {
  it('accepts an item with every optional field and returns it unchanged', () => {
    expect(listItemSchema.parse(item)).toEqual(item);
  });

  it('accepts an item without the optional fields', () => {
    const minimal = {
      id: item.id,
      listId: item.listId,
      source: { kind: 'catalog', planId: 'netflix.standard' },
      billing: {
        mode: 'recurring',
        interval: 'month',
        intervalCount: 1,
        anchorDate: '2026-11-12',
        autoRenew: true,
      },
      tagIds: [],
      rankOverrides: {},
      pinned: false,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
    expect(issues(listItemSchema, minimal)).toEqual([]);
  });

  it.each([
    ['a bundle', { kind: 'bundle', bundleId: 'bundle.disney-crave-premium' }],
    ['a custom plan', { kind: 'custom', customSubId, customPlanId }],
  ])('accepts %s as the source', (_name, source) => {
    expect(issues(listItemSchema, withValue(item, ['source'], source))).toEqual([]);
  });

  it('accepts billing on specific dates', () => {
    expect(issues(listItemSchema, withValue(item, ['billing'], limitedBilling))).toEqual([]);
  });

  describe('unknown keys', () => {
    it.each([
      ['on the item', ['notes']],
      ['on the source', ['source', 'quantity']],
      ['on an add-on', ['source', 'addOns', 0, 'price']],
      ['on the billing', ['billing', 'nextDate']],
      ['on the price override', ['priceOverride', 'from']],
    ])('are rejected %s', (_where, path) => {
      const prefix = path.slice(0, -1).join('.');
      expect(issues(listItemSchema, withValue(item, path, 'x'))).toEqual([
        `${prefix}: Unrecognized key: "${path.at(-1)}"`,
      ]);
    });
  });

  describe('record fields', () => {
    it('rejects an id that is not a UUID v7', () => {
      const v4 = withValue(item, ['id'], '9b2c1e4a-8f7d-4c3b-a1e2-3f4d5c6b7a8e');
      expect(issues(listItemSchema, v4)).toEqual(['id: Use a UUID v7']);
    });

    it('rejects a timestamp without milliseconds, which would sort out of order', () => {
      const short = withValue(item, ['updatedAt'], '2026-10-20T09:15:00Z');
      expect(issues(listItemSchema, short)).toEqual([
        'updatedAt: Use a UTC timestamp with milliseconds, as toISOString writes it',
      ]);
    });

    it('rejects a timestamp with an offset', () => {
      const offset = withValue(item, ['createdAt'], '2026-10-01T12:00:00.000-04:00');
      expect(issues(listItemSchema, offset)).toHaveLength(1);
    });
  });

  describe('source', () => {
    it('rejects an add-on quantity below 1', () => {
      const none = withValue(item, ['source', 'addOns', 0, 'quantity'], 0);
      expect(issues(listItemSchema, none)).toEqual([
        'source.addOns.0.quantity: Must be a whole number of at least 1',
      ]);
    });

    it('rejects an empty add-on list', () => {
      expect(issues(listItemSchema, withValue(item, ['source', 'addOns'], []))).toEqual([
        'source.addOns: Leave addOns out instead of listing none',
      ]);
    });

    it('rejects an add-on listed twice', () => {
      const twice = withValue(
        item,
        ['source', 'addOns'],
        [
          { id: 'netflix.extra-member', quantity: 1 },
          { id: 'netflix.extra-member', quantity: 1 },
        ],
      );
      expect(issues(listItemSchema, twice)).toEqual([
        'source.addOns.1.id: "netflix.extra-member" is listed more than once',
      ]);
    });

    it('rejects a custom source whose ids are not UUIDs', () => {
      const custom = { kind: 'custom', customSubId: 'local-gym', customPlanId };
      expect(issues(listItemSchema, withValue(item, ['source'], custom))).toEqual([
        'source.customSubId: Use a UUID v7',
      ]);
    });
  });

  describe('region', () => {
    it.each(['GB', 'SE'])('accepts the country %s', (region) => {
      expect(issues(listItemSchema, withValue(item, ['region'], region))).toEqual([]);
    });

    it.each(['EU', 'GLOBAL', 'UK', 'ca'])('rejects %s, which is not a country', (region) => {
      expect(issues(listItemSchema, withValue(item, ['region'], region))).toEqual([
        'region: Use a two-letter ISO 3166-1 country code in capitals (CA, GB)',
      ]);
    });
  });

  describe('billingDay', () => {
    it.each([
      ['Feb 28, billed on the 29th', '2026-02-28', 29],
      ['Feb 28, billed on the 31st', '2026-02-28', 31],
      ['Feb 29 in a leap year, billed on the 30th', '2028-02-29', 30],
      ['Apr 30, billed on the 31st', '2026-04-30', 31],
    ])('is accepted for %s', (_name, anchorDate, billingDay) => {
      expect(issues(listItemSchema, recurring({ anchorDate, billingDay }))).toEqual([]);
    });

    it('is accepted with a yearly interval', () => {
      const yearly = recurring({ interval: 'year', anchorDate: '2026-02-28', billingDay: 29 });
      expect(issues(listItemSchema, yearly)).toEqual([]);
    });

    it.each([
      ['Jan 31, a month that is not shorter', '2026-01-31', 31],
      ['Apr 30, billed on the 30th', '2026-04-30', 30],
      ['Feb 29 in a leap year, billed on the 29th', '2028-02-29', 29],
      ['Feb 27, not the last day of the month', '2026-02-27', 31],
    ])('is rejected for %s', (_name, anchorDate, billingDay) => {
      expect(issues(listItemSchema, recurring({ anchorDate, billingDay }))).toEqual([
        'billing.billingDay: billingDay needs anchorDate to be the last day of a month shorter than it',
      ]);
    });

    it.each(['day', 'week'])('is rejected with a %s interval', (interval) => {
      expect(issues(listItemSchema, recurring({ interval }))).toEqual([
        'billing.billingDay: billingDay is only for month and year intervals',
      ]);
    });

    it.each([28, 32, '31'])('rejects %j, which is not 29, 30 or 31', (billingDay) => {
      expect(issues(listItemSchema, recurring({ billingDay }))).toHaveLength(1);
    });

    it('reports only the date when the anchor date is malformed', () => {
      expect(issues(listItemSchema, recurring({ anchorDate: '2026-02-30' }))).toEqual([
        'billing.anchorDate: Use a real date written YYYY-MM-DD',
      ]);
    });
  });

  describe('dates', () => {
    it.each(['2025-01-31', '2024-12-01'])(
      'rejects an end date of %s, not after the start',
      (end) => {
        expect(issues(listItemSchema, recurring({ endDate: end }))).toEqual([
          'billing.endDate: Must be after startDate',
        ]);
      },
    );

    it('rejects a window that ends on or before its start', () => {
      const window = { start: '2026-09-02', end: '2026-09-02', repeatYearly: false };
      const billing = { ...limitedBilling, windows: [window] };
      expect(issues(listItemSchema, withValue(item, ['billing'], billing))).toEqual([
        'billing.windows.0.end: Must be after start',
      ]);
    });

    it('rejects specific dates without a window', () => {
      const billing = { ...limitedBilling, windows: [] };
      expect(issues(listItemSchema, withValue(item, ['billing'], billing))).toEqual([
        'billing.windows: List at least one window',
      ]);
    });

    it('rejects an unknown billing mode', () => {
      expect(issues(listItemSchema, recurring({ mode: 'monthly' }))).toHaveLength(1);
    });
  });

  describe('price override', () => {
    it('rejects an amount of 0', () => {
      expect(issues(listItemSchema, withValue(item, ['priceOverride', 'amount'], 0))).toEqual([
        'priceOverride.amount: Must be more than 0',
      ]);
    });

    it('rejects a currency that is not ISO 4217', () => {
      const dollars = withValue(item, ['priceOverride', 'currency'], '$');
      expect(issues(listItemSchema, dollars)).toEqual([
        'priceOverride.currency: Use a three-letter ISO 4217 currency code in capitals (CAD)',
      ]);
    });
  });

  describe('tags and ranks', () => {
    it('rejects a tag listed twice', () => {
      const twice = withValue(item, ['tagIds'], [item.tagIds[0], item.tagIds[0]]);
      expect(issues(listItemSchema, twice)).toEqual([
        `tagIds.1: "${item.tagIds[0]}" is listed more than once`,
      ]);
    });

    it('rejects a rank that does not exist', () => {
      const rank = withValue(item, ['rankOverrides', 'streaming.ad-free'], 'loved');
      expect(issues(listItemSchema, rank)).toHaveLength(1);
    });

    it('rejects a rank key that is malformed', () => {
      const key = withValue(item, ['rankOverrides', 'Video Quality'], 'wanted');
      expect(issues(listItemSchema, key)).toHaveLength(1);
    });
  });
});

describe('listItemSchema: nickname and note', () => {
  it('trims them', () => {
    const parsed = listItemSchema.parse({ ...item, nickname: "  Mom's ", note: ' For the kids\n' });
    expect(parsed).toMatchObject({ nickname: "Mom's", note: 'For the kids' });
  });

  it('refuses one that is empty or too long', () => {
    expect(issues(listItemSchema, { ...item, nickname: '  ' })).toContain(
      'nickname: Must not be empty',
    );
    expect(issues(listItemSchema, { ...item, nickname: 'x'.repeat(61) })).toContain(
      'nickname: Use at most 60 characters',
    );
    expect(issues(listItemSchema, { ...item, note: 'x'.repeat(1001) })).toContain(
      'note: Use at most 1000 characters',
    );
  });
});

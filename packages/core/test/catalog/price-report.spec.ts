import { describe, expect, it } from 'vitest';
import {
  addReports,
  priceReportSchema,
  reportedPlanSchema,
  reportedPrices,
  reportKey,
  reportPriceKey,
  type ReportCount,
} from '../../src';

// Price reports (M10.10): what POST /reports takes (choices only), how a plan's reports add up on their way to the
// bot, and which of a plan's prices a report from a country is about.

const standard = { amount: 18.99, currency: 'CAD', interval: 'month', intervalCount: 1 } as const;

/** The problems with `body` as POST /reports would list them: each one's path and message. */
function problems(body: unknown): string[] {
  const parsed = priceReportSchema.safeParse(body);
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

describe('priceReportSchema', () => {
  it('takes a different price, a plan not sold any more, or one not sold in the country', () => {
    expect(
      problems({ plan: 'netflix.standard', country: 'CA', problem: 'price', price: standard }),
    ).toEqual([]);
    expect(problems({ plan: 'netflix.standard', country: 'CA', problem: 'discontinued' })).toEqual(
      [],
    );
    expect(
      problems({ plan: 'netflix.standard', country: 'GB', problem: 'not-in-country' }),
    ).toEqual([]);
  });

  it('takes no free text, and nothing it doesn’t ask for', () => {
    expect(
      problems({
        plan: 'netflix.standard',
        country: 'CA',
        problem: 'discontinued',
        comment: 'My bill went up',
      }),
    ).toEqual([': Unrecognized key: "comment"']);
    expect(
      problems({
        plan: 'netflix.standard',
        country: 'CA',
        problem: 'discontinued',
        price: standard,
      }),
    ).toEqual([': Unrecognized key: "price"']);
    expect(problems({ plan: 'netflix.standard', country: 'CA', problem: 'too expensive' })).toEqual(
      [
        "problem: Invalid discriminator value. Expected 'price' | 'discontinued' | 'not-in-country'",
      ],
    );
  });

  it('asks a price report for the price, as the catalog writes one', () => {
    expect(problems({ plan: 'netflix.standard', country: 'CA', problem: 'price' })).toEqual([
      'price: Invalid input: expected object, received undefined',
    ]);
    const priced = (price: object) =>
      problems({ plan: 'netflix.standard', country: 'CA', problem: 'price', price });
    expect(priced({ ...standard, amount: 0 })).toEqual(['price.amount: Must be more than 0']);
    expect(priced({ ...standard, amount: 18.999 })).toEqual([
      'price.amount: Use at most 2 decimals',
    ]);
    expect(priced({ ...standard, amount: 100_000.01 })).toEqual([
      'price.amount: Must be at most 100,000',
    ]);
    expect(priced({ ...standard, currency: 'cad' })[0]).toMatch(/^price\.currency: /);
    expect(priced({ ...standard, interval: 'fortnight' })[0]).toMatch(/^price\.interval: /);
    expect(priced({ ...standard, intervalCount: 0 })).toEqual([
      'price.intervalCount: Must be at least 1',
    ]);
  });

  it('takes a country, not a group, GLOBAL or the UK', () => {
    for (const country of ['UK', 'EU', 'GLOBAL', 'ca']) {
      expect(problems({ plan: 'netflix.standard', country, problem: 'discontinued' })).toEqual([
        'country: Use a two-letter ISO 3166-1 country code in capitals (CA, GB)',
      ]);
    }
    expect(problems({ plan: 'netflix', country: 'CA', problem: 'discontinued' })[0]).toMatch(
      /^plan: /,
    );
  });
});

describe('a plan’s reports', () => {
  const report = (changes: Partial<ReportCount>): ReportCount => ({
    country: 'CA',
    problem: 'price',
    price: { ...standard, amount: 20.99 },
    count: 1,
    first: '2026-10-27',
    last: '2026-10-27',
    ...changes,
  });

  it('add up by country, problem and price, keeping the first day and the last', () => {
    const kept = addReports(undefined, 'netflix.standard', [
      report({ count: 2, first: '2026-10-25', last: '2026-10-26' }),
    ]);
    const added = addReports(kept, 'netflix.standard', [
      report({ count: 3, first: '2026-10-27', last: '2026-10-28' }),
      report({ problem: 'discontinued', price: undefined }),
      report({ country: 'GB', price: { ...standard, currency: 'GBP', amount: 12.99 } }),
    ]);
    expect(added).toEqual({
      plan: 'netflix.standard',
      reports: [
        report({ count: 5, first: '2026-10-25', last: '2026-10-28' }),
        report({ problem: 'discontinued', price: undefined }),
        report({ country: 'GB', price: { ...standard, currency: 'GBP', amount: 12.99 } }),
      ],
    });
    expect(reportedPlanSchema.safeParse(added).success).toBe(true);
    // What was kept isn't changed.
    expect(kept.reports[0].count).toBe(2);
  });

  it('count a price the same whatever the order of its fields', () => {
    expect(
      reportPriceKey({ intervalCount: 1, interval: 'month', currency: 'CAD', amount: 18.99 }),
    ).toBe(reportPriceKey(standard));
    expect(reportPriceKey(undefined)).toBe('');
  });

  it('are kept under a key of their own in the bot’s part of KV', () => {
    expect(reportKey('netflix.standard')).toBe('bot:report:netflix.standard');
  });
});

describe('reportedPrices', () => {
  const prices = [
    { region: 'CA', interval: 'month' },
    { region: 'CA', interval: 'year' },
    { region: 'EU', interval: 'month' },
    { region: 'GLOBAL', interval: 'month' },
  ];

  it('takes the country’s own prices, else its group’s, else the one price everywhere', () => {
    expect(reportedPrices(prices, 'CA')).toEqual([prices[0], prices[1]]);
    expect(reportedPrices(prices, 'DE')).toEqual([prices[2]]);
    expect(reportedPrices(prices, 'GB')).toEqual([prices[3]]);
  });

  it('finds none where the catalog doesn’t price the plan yet', () => {
    expect(reportedPrices(prices.slice(0, 3), 'GB')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { yearSummary, type Charge } from '../../src';

// The Calendar's year view (P10, M10.4): a year's payments by month, and what's been paid so far of its total.

function charge(date: string, amount: number, extra: Partial<Charge> = {}): Charge {
  return {
    date,
    amount,
    tax: 0,
    currency: 'CAD',
    itemId: 'item',
    listId: 'list',
    converted: false,
    manual: false,
    charged: { amount, currency: 'CAD' },
    ...extra,
  };
}

const charges = [
  charge('2025-12-12', 19.94),
  charge('2026-01-12', 19.94),
  charge('2026-01-31', 23.1),
  charge('2026-01-31', 7.53, { converted: true }),
  charge('2026-03-12', 19.94),
  charge('2026-11-12', 19.94),
  charge('2027-01-12', 19.94),
];

describe('yearSummary', () => {
  it('totals each month of the year, with its payments and the days they fall on', () => {
    const { months } = yearSummary(charges, '2026', '2026-10-28', 'CAD');

    expect(months.map((month) => month.month)).toEqual(
      Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`),
    );
    // Full precision, as totals keep it (§3.1).
    expect(months[0]).toEqual({
      month: '2026-01',
      total: { amount: expect.closeTo(50.57, 6) as number, approx: true },
      count: 3,
      days: ['2026-01-12', '2026-01-31'],
    });
    expect(months[1]).toEqual({
      month: '2026-02',
      total: { amount: 0, approx: false },
      count: 0,
      days: [],
    });
    expect(months.map((month) => month.count)).toEqual([3, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0]);
  });

  it('says what’s been paid so far of the year: up to today in this one, all of a past one, none of a future one', () => {
    expect(yearSummary(charges, '2026', '2026-10-28', 'CAD')).toMatchObject({
      total: { amount: expect.closeTo(90.45, 6) as number, approx: true },
      spent: expect.closeTo(70.51, 6) as number,
    });
    expect(yearSummary(charges, '2025', '2026-10-28', 'CAD').spent).toBeCloseTo(19.94, 6);
    expect(yearSummary(charges, '2027', '2026-10-28', 'CAD')).toMatchObject({ spent: 0 });
  });
});

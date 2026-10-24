import { describe, expect, it } from 'vitest';
import { monthlyEquivalent, type Interval } from '../../src';

describe('monthlyEquivalent', () => {
  it.each<[Interval, number, number, number]>([
    ['month', 1, 18.99, 18.99],
    ['month', 3, 30, 10],
    ['year', 1, 120, 10],
    ['year', 2, 240, 10],
    ['week', 1, 12, 52],
    ['week', 2, 12, 26],
    ['day', 1, 12, 365],
    ['month', 1, 0, 0],
  ])('%s × %i at %d is %d a month', (interval, intervalCount, amount, expected) => {
    expect(monthlyEquivalent({ amount, interval, intervalCount })).toBeCloseTo(expected, 10);
  });

  it('keeps full precision', () => {
    expect(monthlyEquivalent({ amount: 169.99, interval: 'year', intervalCount: 1 })).toBe(
      169.99 / 12,
    );
  });
});

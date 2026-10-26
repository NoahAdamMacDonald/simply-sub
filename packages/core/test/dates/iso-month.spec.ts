import { describe, expect, it } from 'vitest';
import { addMonthsToMonth, monthOf, monthWeeks } from '../../src';

describe('monthOf', () => {
  it("gives a date's month", () => {
    expect(monthOf('2026-10-23')).toBe('2026-10');
  });

  it("rejects a date that isn't real", () => {
    expect(() => monthOf('2026-02-30')).toThrow(RangeError);
  });
});

describe('addMonthsToMonth', () => {
  it.each([
    { month: '2026-10', months: 1, expected: '2026-11' },
    { month: '2026-12', months: 1, expected: '2027-01' },
    { month: '2026-01', months: -1, expected: '2025-12' },
    { month: '2026-10', months: 0, expected: '2026-10' },
    { month: '2026-10', months: 27, expected: '2029-01' },
  ])('$month + $months = $expected', ({ month, months, expected }) => {
    expect(addMonthsToMonth(month, months)).toBe(expected);
  });

  it.each(['2026-13', '2026-00', '2026-1', '2026-10-01', ''])("rejects '%s'", (month) => {
    expect(() => addMonthsToMonth(month, 1)).toThrow(RangeError);
  });
});

describe('monthWeeks', () => {
  it('starts on Sunday, with blank days around the month', () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    const weeks = monthWeeks('2026-10');
    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toEqual([null, null, null, null, '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(weeks[4]).toEqual([
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
    ]);
  });

  it('gives every week 7 days, the last one padded', () => {
    // November 2026 starts on a Sunday and ends on a Monday.
    const weeks = monthWeeks('2026-11');
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0][0]).toBe('2026-11-01');
    expect(weeks.at(-1)).toEqual(['2026-11-29', '2026-11-30', null, null, null, null, null]);
  });

  it('fits a 28-day February that starts on Sunday into 4 weeks', () => {
    expect(monthWeeks('2026-02')).toHaveLength(4);
  });

  it('has a leap day', () => {
    expect(monthWeeks('2028-02').flat()).toContain('2028-02-29');
  });

  it('takes 6 weeks when the month needs them', () => {
    // August 2026 starts on a Saturday and has 31 days.
    expect(monthWeeks('2026-08')).toHaveLength(6);
  });
});

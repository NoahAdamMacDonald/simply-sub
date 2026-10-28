import { describe, expect, it } from 'vitest';
import { addDays, addMonths, daysBetween, toIsoDate, weekdayOf } from '../../src/dates/iso-date';

// Core never reads the clock, so its tests use a fixed `today`. vitest.config.ts runs them in
// America/Vancouver: UTC−7 in October, UTC−8 after the clocks go back on Nov 1, 2026.
const today = '2026-10-23';

describe('toIsoDate', () => {
  it('gives the local date while UTC is already on the next day', () => {
    // 23:30 on Oct 23 in Vancouver is 06:30 on Oct 24 in UTC.
    expect(toIsoDate(new Date('2026-10-24T06:30:00Z'))).toBe('2026-10-23');
  });

  it('turns over at local midnight, not at UTC midnight', () => {
    expect(toIsoDate(new Date('2026-10-24T06:59:59.999Z'))).toBe('2026-10-23');
    expect(toIsoDate(new Date('2026-10-24T07:00:00Z'))).toBe('2026-10-24');
  });

  it('pads the month and day to two digits', () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('addDays', () => {
  it.each([
    { what: 'no days', date: today, days: 0, expected: '2026-10-23' },
    { what: 'into the next month', date: today, days: 10, expected: '2026-11-02' },
    { what: 'into the next year', date: '2026-12-31', days: 1, expected: '2027-01-01' },
    { what: 'back over a month end', date: '2026-03-01', days: -1, expected: '2026-02-28' },
    { what: 'onto a leap day', date: '2028-02-28', days: 1, expected: '2028-02-29' },
    { what: 'a year ahead', date: today, days: 365, expected: '2027-10-23' },
    { what: 'over the spring DST change', date: '2026-03-07', days: 2, expected: '2026-03-09' },
    { what: 'over the fall DST change', date: '2026-10-31', days: 2, expected: '2026-11-02' },
  ])('$what: $date + $days = $expected', ({ date, days, expected }) => {
    expect(addDays(date, days)).toBe(expected);
  });

  it.each([
    '2026-02-29',
    '2026-10-32',
    '2026-13-01',
    '2026-1-5',
    '26-10-23',
    '2026-10-23T12:00',
    '',
  ])("rejects '%s'", (date) => {
    expect(() => addDays(date, 1)).toThrow(RangeError);
  });
});

describe('addMonths', () => {
  it.each([
    { what: 'a month', date: today, months: 1, expected: '2026-11-23' },
    { what: 'into the next year', date: '2026-12-15', months: 1, expected: '2027-01-15' },
    { what: 'back a month', date: '2026-01-15', months: -1, expected: '2025-12-15' },
    { what: 'onto a shorter month', date: '2026-01-31', months: 1, expected: '2026-02-28' },
    { what: 'onto a leap February', date: '2028-01-31', months: 1, expected: '2028-02-29' },
    { what: 'onto a 30-day month', date: '2026-03-31', months: 1, expected: '2026-04-30' },
    {
      what: 'from the anchor, not the last result',
      date: '2026-01-31',
      months: 2,
      expected: '2026-03-31',
    },
    { what: 'a leap day a year on', date: '2028-02-29', months: 12, expected: '2029-02-28' },
    { what: 'no months', date: today, months: 0, expected: today },
  ])('$what: $date + $months = $expected', ({ date, months, expected }) => {
    expect(addMonths(date, months)).toBe(expected);
  });

  it("rejects a date that isn't real", () => {
    expect(() => addMonths('2026-02-30', 1)).toThrow(RangeError);
  });

  it.each([
    {
      what: 'a short month’s end onto a long one',
      date: '2026-02-28',
      months: 1,
      day: 31,
      expected: '2026-03-31',
    },
    { what: 'onto a 30-day month', date: '2026-02-28', months: 2, day: 31, expected: '2026-04-30' },
    {
      what: 'itself, no months on',
      date: '2026-02-28',
      months: 0,
      day: 31,
      expected: '2026-02-28',
    },
    { what: 'back a month', date: '2026-02-28', months: -1, day: 31, expected: '2026-01-31' },
    {
      what: 'onto a leap February',
      date: '2027-02-28',
      months: 12,
      day: 29,
      expected: '2028-02-29',
    },
    { what: 'an earlier day', date: '2026-10-23', months: 1, day: 5, expected: '2026-11-05' },
  ])(
    'on a day of its own, $what: $date + $months on the $day = $expected',
    ({ date, months, day, expected }) => {
      expect(addMonths(date, months, day)).toBe(expected);
    },
  );

  it('takes the years 0 to 99 as they are, as a date input passes through them while a year is typed', () => {
    expect(addMonths('0002-11-12', 1)).toBe('0002-12-12');
    expect(addMonths('0099-12-31', 2)).toBe('0100-02-28');
    expect(addDays('0020-02-28', 1)).toBe('0020-02-29');
    expect(weekdayOf('0002-11-12')).toBe(new Date('0002-11-12T00:00:00Z').getUTCDay());
  });
});

describe('weekdayOf', () => {
  it.each([
    { date: '2026-10-25', weekday: 0 },
    { date: '2026-10-26', weekday: 1 },
    { date: '2026-10-31', weekday: 6 },
    { date: '2028-02-29', weekday: 2 },
  ])('$date is day $weekday', ({ date, weekday }) => {
    expect(weekdayOf(date)).toBe(weekday);
  });
});

describe('daysBetween', () => {
  it.each([
    { from: today, to: today, days: 0 },
    { from: today, to: '2026-11-02', days: 10 },
    { from: '2026-11-02', to: today, days: -10 },
    { from: '2026-10-31', to: '2026-11-02', days: 2 },
    { from: '2028-02-28', to: '2028-03-01', days: 2 },
    { from: '2026-01-01', to: '2027-01-01', days: 365 },
  ])('$from to $to is $days days, whatever the time zone', ({ from, to, days }) => {
    expect(daysBetween(from, to)).toBe(days);
  });

  it("rejects a date that isn't real", () => {
    expect(() => daysBetween('2026-02-30', today)).toThrow(RangeError);
  });
});

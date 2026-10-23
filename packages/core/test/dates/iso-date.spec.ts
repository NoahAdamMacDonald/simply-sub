import { describe, expect, it } from 'vitest';
import { addDays, toIsoDate } from '../../src/dates/iso-date';

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

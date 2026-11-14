import { describe, expect, it } from 'vitest';
import { chargeDates, lastChargeDate, nextChargeDate, type Billing } from '../../src';

// When an item is charged (PROJECT-PLAN §3.1): dates counted from the anchor or a window's start, never from the
// charge before.

const monthly = (anchorDate: string, extra: Partial<Billing> = {}): Billing =>
  ({
    mode: 'recurring',
    interval: 'month',
    intervalCount: 1,
    anchorDate,
    autoRenew: true,
    ...extra,
  }) as Billing;

const every = (
  interval: 'day' | 'week' | 'month' | 'year',
  intervalCount: number,
  anchorDate: string,
) => ({ mode: 'recurring', interval, intervalCount, anchorDate, autoRenew: true }) as Billing;

const limited = (
  windows: { start: string; end: string; repeatYearly?: boolean }[],
  interval: 'day' | 'week' | 'month' | 'year' = 'month',
  intervalCount = 1,
): Billing => ({
  mode: 'limited',
  windows: windows.map((window) => ({ repeatYearly: false, ...window })),
  interval,
  intervalCount,
});

const year = (from: string) => ({ from, to: `${Number(from.slice(0, 4)) + 1}${from.slice(4)}` });

describe('chargeDates', () => {
  describe('months', () => {
    it("fall on the anchor's day, or a shorter month's last day: Jan 31 gives Feb 28, Mar 31, Apr 30", () => {
      expect(chargeDates(monthly('2026-01-31'), { from: '2026-01-01', to: '2026-06-01' })).toEqual([
        '2026-01-31',
        '2026-02-28',
        '2026-03-31',
        '2026-04-30',
        '2026-05-31',
      ]);
    });

    it('are counted from the anchor, so a short month never pulls the later ones early', () => {
      const dates = chargeDates(monthly('2026-01-31'), year('2026-01-01'));
      expect(dates.filter((date) => date.endsWith('-31'))).toHaveLength(7);
      expect(dates).toHaveLength(12);
    });

    it('go back from the anchor too, as charges before it', () => {
      expect(chargeDates(monthly('2026-11-12'), { from: '2026-07-01', to: '2026-12-01' })).toEqual([
        '2026-07-12',
        '2026-08-12',
        '2026-09-12',
        '2026-10-12',
        '2026-11-12',
      ]);
    });

    it('fall on the billing day when the anchor is a shorter month’s last day: Feb 28 billed on the 31st', () => {
      const billing = monthly('2026-02-28', { billingDay: 31 });
      expect(chargeDates(billing, { from: '2026-01-01', to: '2026-07-01' })).toEqual([
        '2026-01-31',
        '2026-02-28',
        '2026-03-31',
        '2026-04-30',
        '2026-05-31',
        '2026-06-30',
      ]);
      // Without it, Feb 28 is the 28th every month.
      expect(chargeDates(monthly('2026-02-28'), { from: '2026-03-01', to: '2026-05-01' })).toEqual([
        '2026-03-28',
        '2026-04-28',
      ]);
    });

    it('take February 29 in a leap year', () => {
      expect(chargeDates(monthly('2028-01-31'), { from: '2028-02-01', to: '2028-03-01' })).toEqual([
        '2028-02-29',
      ]);
      expect(
        chargeDates(monthly('2027-11-30', { billingDay: 31 }), {
          from: '2028-02-01',
          to: '2028-04-01',
        }),
      ).toEqual(['2028-02-29', '2028-03-31']);
    });

    it('skip whole periods with intervalCount: every 3 months from Jan 31', () => {
      expect(chargeDates(every('month', 3, '2026-01-31'), year('2026-01-01'))).toEqual([
        '2026-01-31',
        '2026-04-30',
        '2026-07-31',
        '2026-10-31',
      ]);
    });
  });

  describe('years', () => {
    it('take Feb 28 in other years for a Feb 29 anchor, and Feb 29 again in a leap year', () => {
      expect(
        chargeDates(every('year', 1, '2028-02-29'), { from: '2028-01-01', to: '2033-01-01' }),
      ).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
    });

    it('take the 29th once a leap year comes round, with billingDay 29 on Feb 28', () => {
      const billing = { ...every('year', 1, '2027-02-28'), billingDay: 29 } as Billing;
      expect(chargeDates(billing, { from: '2027-01-01', to: '2030-01-01' })).toEqual([
        '2027-02-28',
        '2028-02-29',
        '2029-02-28',
      ]);
    });

    it('come once a year, so a range of a year has one', () => {
      expect(
        chargeDates(every('year', 1, '2026-11-12'), { from: '2026-10-28', to: '2027-10-28' }),
      ).toEqual(['2026-11-12']);
    });
  });

  describe('days and weeks', () => {
    it('are plain counts: every 30 days from Jan 31 gives Mar 2, Apr 1, May 1', () => {
      expect(
        chargeDates(every('day', 30, '2026-01-31'), { from: '2026-01-31', to: '2026-05-02' }),
      ).toEqual(['2026-01-31', '2026-03-02', '2026-04-01', '2026-05-01']);
    });

    it('can charge twice in a month', () => {
      expect(
        chargeDates(every('day', 30, '2026-05-01'), { from: '2026-05-01', to: '2026-06-01' }),
      ).toEqual(['2026-05-01', '2026-05-31']);
    });

    it('every 2 weeks, on the same weekday, back and forth from the anchor', () => {
      expect(
        chargeDates(every('week', 2, '2026-10-15'), { from: '2026-10-01', to: '2026-11-15' }),
      ).toEqual(['2026-10-01', '2026-10-15', '2026-10-29', '2026-11-12']);
    });
  });

  describe('start and end dates', () => {
    it('count only dates on or after the start date and before the end date', () => {
      const billing = monthly('2026-01-15', { startDate: '2026-03-15', endDate: '2026-06-15' });
      expect(chargeDates(billing, year('2026-01-01'))).toEqual([
        '2026-03-15',
        '2026-04-15',
        '2026-05-15',
      ]);
    });

    it('count charges before today when there is no start date: it was active already', () => {
      expect(chargeDates(monthly('2026-11-12'), { from: '2026-01-01', to: '2026-03-01' })).toEqual([
        '2026-01-12',
        '2026-02-12',
      ]);
    });
  });

  it('leaves out the end of the range, and has nothing in an empty one', () => {
    expect(chargeDates(monthly('2026-11-12'), { from: '2026-10-12', to: '2026-11-12' })).toEqual([
      '2026-10-12',
    ]);
    expect(chargeDates(monthly('2026-11-12'), { from: '2026-11-12', to: '2026-11-12' })).toEqual(
      [],
    );
  });

  it('follows another period from the same anchor: a monthly add-on on a yearly plan', () => {
    const plan = every('year', 1, '2026-03-15');
    expect(
      chargeDates(
        plan,
        { from: '2026-03-01', to: '2026-07-01' },
        { interval: 'month', intervalCount: 1 },
      ),
    ).toEqual(['2026-03-15', '2026-04-15', '2026-05-15', '2026-06-15']);
  });

  describe('Specific dates', () => {
    it('charge at a window’s start, then every period before its end: Sep 2 – Nov 1 monthly', () => {
      const dates = chargeDates(
        limited([{ start: '2026-09-02', end: '2026-11-01' }]),
        year('2026-01-01'),
      );
      expect(dates).toEqual(['2026-09-02', '2026-10-02']);
    });

    it('never charge on the end date: Sep 2 – Nov 2 gives the same', () => {
      const dates = chargeDates(
        limited([{ start: '2026-09-02', end: '2026-11-02' }]),
        year('2026-01-01'),
      );
      expect(dates).toEqual(['2026-09-02', '2026-10-02']);
    });

    it('copy a yearly window into each later year, never an earlier one', () => {
      const billing = limited([{ start: '2026-09-02', end: '2026-11-01', repeatYearly: true }]);
      expect(chargeDates(billing, { from: '2025-01-01', to: '2028-01-01' })).toEqual([
        '2026-09-02',
        '2026-10-02',
        '2027-09-02',
        '2027-10-02',
      ]);
    });

    it('copy a window across New Year, and a Feb 29 start onto Feb 28', () => {
      const winter = limited([{ start: '2026-12-15', end: '2027-02-10', repeatYearly: true }]);
      expect(chargeDates(winter, { from: '2027-01-01', to: '2028-02-01' })).toEqual([
        '2027-01-15',
        '2027-12-15',
        '2028-01-15',
      ]);
      const leap = limited([{ start: '2028-02-29', end: '2028-04-01', repeatYearly: true }]);
      expect(chargeDates(leap, { from: '2029-01-01', to: '2030-01-01' })).toEqual([
        '2029-02-28',
        '2029-03-28',
      ]);
    });

    it('put several windows’ dates in order, each in its own period', () => {
      const billing = limited(
        [
          { start: '2026-06-01', end: '2026-06-20' },
          { start: '2026-02-01', end: '2026-02-25' },
        ],
        'week',
      );
      expect(chargeDates(billing, year('2026-01-01'))).toEqual([
        '2026-02-01',
        '2026-02-08',
        '2026-02-15',
        '2026-02-22',
        '2026-06-01',
        '2026-06-08',
        '2026-06-15',
      ]);
    });
  });
});

describe('nextChargeDate', () => {
  it('is the first date on or after the one given', () => {
    expect(nextChargeDate(monthly('2026-11-12'), '2026-10-28')).toBe('2026-11-12');
    expect(nextChargeDate(monthly('2026-11-12'), '2026-11-12')).toBe('2026-11-12');
    expect(nextChargeDate(monthly('2026-11-12'), '2026-11-13')).toBe('2026-12-12');
  });

  it('is none once the end date has passed, and the start date when it’s later', () => {
    expect(
      nextChargeDate(monthly('2026-01-12', { endDate: '2026-10-01' }), '2026-10-28'),
    ).toBeUndefined();
    expect(nextChargeDate(monthly('2026-01-12', { startDate: '2027-03-12' }), '2026-10-28')).toBe(
      '2027-03-12',
    );
  });

  it('finds the next window, a year on or years away', () => {
    const yearly = limited([{ start: '2026-09-02', end: '2026-11-01', repeatYearly: true }]);
    expect(nextChargeDate(yearly, '2026-10-28')).toBe('2027-09-02');
    const later = limited([{ start: '2030-06-01', end: '2030-07-01' }]);
    expect(nextChargeDate(later, '2026-10-28')).toBe('2030-06-01');
    expect(nextChargeDate(later, '2030-06-02')).toBeUndefined();
  });
});

describe('lastChargeDate', () => {
  it('is the last date before the end date, which the calendar marks "Ends"', () => {
    expect(lastChargeDate(monthly('2026-01-31', { endDate: '2026-03-30' }))).toBe('2026-02-28');
    expect(lastChargeDate(monthly('2026-01-31', { endDate: '2026-03-31' }))).toBe('2026-02-28');
    expect(lastChargeDate(monthly('2026-01-31', { endDate: '2026-04-01' }))).toBe('2026-03-31');
    expect(lastChargeDate(every('year', 1, '2026-11-12'))).toBeUndefined();
  });

  it('is none when nothing is charged before the end date', () => {
    expect(
      lastChargeDate(monthly('2026-11-12', { startDate: '2026-11-01', endDate: '2026-11-10' })),
    ).toBeUndefined();
  });
});

// A yearly renewal charged before its date (M11.21): the anchor is the renewal, each charged days before it.
describe('charged before the renewal', () => {
  const early = (anchorDate: string, days: number, extra: Partial<Billing> = {}): Billing =>
    ({ ...every('year', 1, anchorDate), chargeDaysBefore: days, ...extra }) as Billing;

  it('charges each renewal that many days before it, a day later when the days take in Feb 29', () => {
    expect(chargeDates(early('2027-03-10', 35), { from: '2026-01-01', to: '2030-01-01' })).toEqual([
      '2026-02-03',
      '2027-02-03',
      '2028-02-04',
      '2029-02-03',
    ]);
  });

  it('counts back from a month’s end and from Feb 29 as from any day', () => {
    expect(chargeDates(early('2027-01-31', 15), year('2027-01-01'))).toEqual(['2027-01-16']);
    expect(chargeDates(early('2028-02-29', 15), { from: '2028-01-01', to: '2030-01-01' })).toEqual([
      '2028-02-14',
      '2029-02-13',
    ]);
  });

  it('puts a renewal early in the year in the year before when its charge is', () => {
    const billing = early('2027-01-10', 35);
    expect(chargeDates(billing, { from: '2026-12-01', to: '2027-01-01' })).toEqual(['2026-12-06']);
    expect(chargeDates(billing, { from: '2027-01-01', to: '2027-12-01' })).toEqual([]);
  });

  it('charges the renewal it starts on that day, its purchase, and none before it started', () => {
    const bought = early('2027-11-13', 35, { startDate: '2026-11-13' });
    expect(chargeDates(bought, { from: '2026-11-01', to: '2028-01-01' })).toEqual([
      '2026-11-13',
      '2027-10-09',
    ]);
    // Added on Nov 13 with its next renewal on Nov 23: that renewal was charged on Oct 19, before it was added.
    const renewing = early('2026-11-23', 35, { startDate: '2026-11-13' });
    expect(chargeDates(renewing, { from: '2026-10-01', to: '2028-01-01' })).toEqual(['2027-10-19']);
  });

  it('charges no renewal on or after the end date, though its charge would be before it', () => {
    const ending = early('2027-03-10', 35, { endDate: '2028-03-01' });
    expect(chargeDates(ending, { from: '2027-01-01', to: '2029-01-01' })).toEqual(['2027-02-03']);
    expect(lastChargeDate(ending)).toBe('2027-02-03');
    expect(lastChargeDate(early('2027-03-10', 35, { endDate: '2028-03-11' }))).toBe('2028-02-04');
  });

  it('is the next charge from its charge date, and leaves an add-on on a period of its own on its day', () => {
    const billing = early('2027-03-10', 35);
    expect(nextChargeDate(billing, '2026-11-13')).toBe('2027-02-03');
    expect(nextChargeDate(billing, '2027-02-03')).toBe('2027-02-03');
    expect(nextChargeDate(billing, '2027-02-04')).toBe('2028-02-04');
    expect(
      chargeDates(
        billing,
        { from: '2027-01-01', to: '2027-04-01' },
        { interval: 'month', intervalCount: 1 },
      ),
    ).toEqual(['2027-01-10', '2027-02-10', '2027-03-10']);
  });
});

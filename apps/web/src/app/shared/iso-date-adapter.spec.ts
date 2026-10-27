import { TestBed } from '@angular/core/testing';
import { ClockService } from '../core/clock/clock-service';
import { FakeClock } from '../core/storage/storage.testing';
import { IsoDateAdapter } from './iso-date-adapter';

describe('IsoDateAdapter', () => {
  let adapter: IsoDateAdapter;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [IsoDateAdapter, { provide: ClockService, useValue: new FakeClock() }],
    });
    adapter = TestBed.inject(IsoDateAdapter);
  });

  it('reads a date’s parts, and makes one from them', () => {
    expect(adapter.getYear('2027-02-28')).toBe(2027);
    expect(adapter.getMonth('2027-02-28')).toBe(1);
    expect(adapter.getDate('2027-02-28')).toBe(28);
    expect(adapter.getDayOfWeek('2026-10-25')).toBe(0);
    expect(adapter.getNumDaysInMonth('2028-02-10')).toBe(29);
    expect(adapter.createDate(2027, 1, 28)).toBe('2027-02-28');
    expect(() => adapter.createDate(2027, 1, 30)).toThrow();
  });

  it('takes typed dates in a few forms, and nothing else', () => {
    expect(adapter.parse('2027-02-28')).toBe('2027-02-28');
    expect(adapter.parse(' 2027/2/8 ')).toBe('2027-02-08');
    expect(adapter.parse('2027.12.31')).toBe('2027-12-31');
    expect(adapter.parse('20270228')).toBe('2027-02-28');
    expect(adapter.parse('')).toBeNull();
    for (const typed of ['2027-02-30', 'Feb 28 2027', '28/02/2027', '202702-02-28']) {
      expect(adapter.isValid(adapter.parse(typed)!)).toBe(false);
    }
  });

  it('shows dates as typed, and names months and days in English', () => {
    expect(adapter.format('2027-02-28', 'iso')).toBe('2027-02-28');
    expect(adapter.format('2027-02-28', 'monthYear')).toBe('Feb 2027');
    expect(adapter.format('2027-02-28', 'long')).toBe('February 28, 2027');
    expect(adapter.getMonthNames('short')[0]).toBe('Jan');
    expect(adapter.getDayOfWeekNames('short')).toEqual([
      'Sun',
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
    ]);
  });

  it('counts with core’s helpers, and takes today from ClockService', () => {
    expect(adapter.addCalendarMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(adapter.addCalendarYears('2028-02-29', 1)).toBe('2029-02-28');
    expect(adapter.addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(adapter.today()).toBe('2026-10-25');
  });
});

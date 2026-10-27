import { Injectable, inject } from '@angular/core';
import { DateAdapter, MAT_DATE_FORMATS, type MatDateFormats } from '@angular/material/core';
import { addDays, addMonths, weekdayOf, type IsoDate } from '@simply-sub/core';
import { ClockService } from '../core/clock/clock-service';

// Material's datepicker on the app's own dates, ISO strings ('2027-02-28'), which forms and records keep as they are:
// no Date objects, so no time zone can move a day (BLUEPRINT §13.2). Its maths is core's dates/ helpers, today is
// ClockService's, and names are English, like the rest of the app. A field shows and takes 2027-02-28; typing also
// takes 2027/2/28 and 20270228.

const english = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' });
const monthYear = english({ month: 'short', year: 'numeric' });
const monthYearLong = english({ month: 'long', year: 'numeric' });
const long = english({ month: 'long', day: 'numeric', year: 'numeric' });

/** What a date that can't be read is: a string, so the datepicker takes it for a date, and never a valid one. */
const invalidDate = 'invalid';

/** The display formats IsoDateAdapter.format knows. */
export const isoDateFormats: MatDateFormats = {
  parse: { dateInput: 'iso' },
  display: {
    dateInput: 'iso',
    monthYearLabel: 'monthYear',
    dateA11yLabel: 'long',
    monthYearA11yLabel: 'monthYearLong',
  },
};

@Injectable()
export class IsoDateAdapter extends DateAdapter<IsoDate> {
  private readonly clock = inject(ClockService);

  getYear(date: IsoDate): number {
    return Number(date.slice(0, 4));
  }

  getMonth(date: IsoDate): number {
    return Number(date.slice(5, 7)) - 1;
  }

  getDate(date: IsoDate): number {
    return Number(date.slice(8, 10));
  }

  getDayOfWeek(date: IsoDate): number {
    return weekdayOf(date);
  }

  getMonthNames(style: 'long' | 'short' | 'narrow'): string[] {
    const names = english({ month: style });
    return Array.from({ length: 12 }, (_, month) => names.format(utc(2026, month, 1)));
  }

  getDateNames(): string[] {
    return Array.from({ length: 31 }, (_, index) => String(index + 1));
  }

  getDayOfWeekNames(style: 'long' | 'short' | 'narrow'): string[] {
    const names = english({ weekday: style });
    // Nov 1, 2026 is a Sunday.
    return Array.from({ length: 7 }, (_, day) => names.format(utc(2026, 10, 1 + day)));
  }

  getYearName(date: IsoDate): string {
    return String(this.getYear(date));
  }

  getFirstDayOfWeek(): number {
    return 0;
  }

  getNumDaysInMonth(date: IsoDate): number {
    return Number(addDays(addMonths(`${date.slice(0, 7)}-01`, 1), -1).slice(8));
  }

  clone(date: IsoDate): IsoDate {
    return date;
  }

  createDate(year: number, month: number, date: number): IsoDate {
    const made = `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
    if (!this.isValid(made)) throw new Error(`There's no date ${made}`);
    return made;
  }

  today(): IsoDate {
    return this.clock.today();
  }

  /** A typed date: 2027-02-28, 2027/2/28, 2027.2.28 or 20270228. Nothing typed is null; anything else is invalid. */
  parse(value: unknown): IsoDate | null {
    if (typeof value !== 'string') return null;
    const typed = value.trim();
    if (typed === '') return null;
    const parts =
      /^(\d{4})[-/. ](\d{1,2})[-/. ](\d{1,2})$/.exec(typed) ??
      /^(\d{4})(\d{2})(\d{2})$/.exec(typed);
    if (!parts) return this.invalid();
    const date = `${parts[1]}-${parts[2].padStart(2, '0')}-${parts[3].padStart(2, '0')}`;
    return this.isValid(date) ? date : this.invalid();
  }

  format(date: IsoDate, displayFormat: unknown): string {
    if (!this.isValid(date)) return '';
    const day = utc(this.getYear(date), this.getMonth(date), this.getDate(date));
    switch (displayFormat) {
      case 'monthYear':
        return monthYear.format(day);
      case 'monthYearLong':
        return monthYearLong.format(day);
      case 'long':
        return long.format(day);
      default:
        return date;
    }
  }

  addCalendarYears(date: IsoDate, years: number): IsoDate {
    return addMonths(date, 12 * years);
  }

  addCalendarMonths(date: IsoDate, months: number): IsoDate {
    return addMonths(date, months);
  }

  addCalendarDays(date: IsoDate, days: number): IsoDate {
    return addDays(date, days);
  }

  toIso8601(date: IsoDate): string {
    return date;
  }

  /** A form's value: '' is a date not entered yet, as the app's forms have it, not one that can't be read. */
  override deserialize(value: unknown): IsoDate | null {
    return value === '' ? null : super.deserialize(value);
  }

  isDateInstance(value: unknown): boolean {
    return typeof value === 'string';
  }

  isValid(date: IsoDate): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    try {
      return addDays(date, 0) === date;
    } catch {
      return false;
    }
  }

  invalid(): IsoDate {
    return invalidDate;
  }
}

/** The providers that put a component's datepickers on IsoDateAdapter. */
export const isoDateProviders = [
  { provide: DateAdapter, useClass: IsoDateAdapter },
  { provide: MAT_DATE_FORMATS, useValue: isoDateFormats },
];

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

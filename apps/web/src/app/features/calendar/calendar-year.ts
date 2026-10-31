import { Component, input, output } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import type { CalendarParams, IsoMonth } from '@simply-sub/core';

/** A day of a month's small grid: its number, whether it has a payment, whether it's today. */
export interface YearDay {
  day: number;
  paid: boolean;
  today: boolean;
}

/** A month of the year view, as the Calendar works it out. */
export interface YearMonth {
  month: IsoMonth;
  /** "March". */
  name: string;
  /** "$63.21", "≈ $63.21". */
  totalText: string;
  /** "4 payments". */
  countText: string;
  /** Its link's name, with all the card shows: "March 2026, 4 payments, $63.21". */
  label: string;
  /**
   * The month's total against the biggest month's (`share`), coloured against the monthly budget as the Calendar's bar
   * is (M7.7) when one is set.
   */
  strip: { share: number; towardYellow?: number; towardRed?: number };
  /** A card goes over its limit this month (M9.4). */
  overLimit: boolean;
  /** This month. */
  current: boolean;
  /** Its weeks, Sunday first, a gap for another month's day. */
  weeks: (YearDay | undefined)[][];
  /** Its month view's URL. */
  queryParams: CalendarParams;
}

/**
 * The Calendar's year view (PROJECT-PLAN P10, M10.4): a card for each month, its total, payment count and a strip
 * against the biggest month, coloured against the monthly budget, with a small grid of its days (decorative: a dot on
 * each with a payment, today ringed). Each card is one link to its month, named with all it shows. The Calendar loads it
 * with @defer.
 */
@Component({
  selector: 'ss-calendar-year',
  imports: [MatIcon, RouterLink],
  templateUrl: './calendar-year.html',
  styleUrl: './calendar-year.scss',
})
export class CalendarYear {
  readonly months = input.required<readonly YearMonth[]>();
  /** The year's cash back on the cards (M10.29), shown above the months: never taken off the totals. */
  readonly cashback = input<{ shown: string; spoken: string }>();
  /** The list's name: "Months of 2026". */
  readonly label = input.required<string>();
  /** A month's card was chosen: the Calendar puts focus on its grid once it shows. */
  readonly opened = output<IsoMonth>();

  protected readonly weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
}

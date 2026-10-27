import { Component } from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatCalendarHeader } from '@angular/material/datepicker';
import { MatIcon } from '@angular/material/icon';

/**
 * The datepicker's header (the item dialog's dates): Material's, with its period button named by what it shows,
 * "Oct 2026 (choose month and year)". Material's names it "Choose month and year" alone, which axe's
 * label-content-name-mismatch fails (WCAG 2.5.3: speech input says what it sees), and its text failed contrast in dark
 * mode. Pass it as a datepicker's calendarHeaderComponent.
 */
@Component({
  selector: 'ss-calendar-header',
  imports: [MatButton, MatIcon, MatIconButton],
  templateUrl: './calendar-header.html',
  styleUrl: './calendar-header.scss',
})
export class CalendarHeader<D> extends MatCalendarHeader<D> {}

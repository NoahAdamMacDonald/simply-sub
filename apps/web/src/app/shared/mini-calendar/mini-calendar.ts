import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  model,
  output,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import {
  addDays,
  addMonths,
  addMonthsToMonth,
  monthOf,
  monthWeeks,
  weekdayOf,
  type IsoDate,
  type IsoMonth,
} from '@simply-sub/core';
import { ClockService } from '../../core/clock/clock-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { monthText, spokenDayText } from '../date-text';
import { amountText } from '../price-tag/price-text';

/** A payment as the mini calendar shows it: pages map core's charges (M7.1) to this. */
export interface CalendarCharge {
  date: IsoDate;
  name: string;
  amount: number;
  currency: string;
  /** In another currency, converted: the amount shows ≈. */
  converted?: boolean;
  /** Renewed by hand (autoRenew: false). */
  manual?: boolean;
}

let nextId = 0;

const weekdays = [
  ['Su', 'Sunday'],
  ['Mo', 'Monday'],
  ['Tu', 'Tuesday'],
  ['We', 'Wednesday'],
  ['Th', 'Thursday'],
  ['Fr', 'Friday'],
  ['Sa', 'Saturday'],
] as const;

/**
 * A month grid with a dot on each day that has a payment (Home, P2, and List view, P4), and the payments in the day's
 * tooltip. ‹ and › change the month, and the month's name and each day are links to the Calendar (`monthClick`,
 * `dayClick`). The grid is one tab stop: the arrow keys move by day and week, Home and End to the week's ends, and
 * Page Up and Page Down by month.
 */
@Component({
  selector: 'ss-mini-calendar',
  imports: [MatIcon, MatIconButton, MatTooltip],
  templateUrl: './mini-calendar.html',
  styleUrl: './mini-calendar.scss',
})
export class MiniCalendar {
  private readonly clock = inject(ClockService);
  private readonly settings = inject(SettingsStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly month = model.required<IsoMonth>();
  readonly charges = input<readonly CalendarCharge[]>([]);
  readonly dayClick = output<IsoDate>();
  readonly monthClick = output<IsoMonth>();

  protected readonly weekdays = weekdays;
  protected readonly titleId = `ss-mini-calendar-${nextId++}`;
  protected readonly today = this.clock.today;
  protected readonly title = computed(() => monthText(this.month()));
  /** The day that takes the grid's tab stop: the one last moved to, else today, else the 1st. */
  protected readonly focusDay = linkedSignal<IsoMonth, IsoDate>({
    source: this.month,
    computation: (month, previous) => {
      if (previous && monthOf(previous.value) === month) return previous.value;
      return monthOf(this.today()) === month ? this.today() : `${month}-01`;
    },
  });
  protected readonly weeks = computed(() => {
    const byDay = new Map<IsoDate, CalendarCharge[]>();
    for (const charge of this.charges()) {
      byDay.set(charge.date, [...(byDay.get(charge.date) ?? []), charge]);
    }
    return monthWeeks(this.month()).map((week) =>
      week.map((date) => {
        if (date === null) return null;
        const charges = byDay.get(date) ?? [];
        return {
          date,
          day: Number(date.slice(8)),
          label: this.dayLabel(date, charges.length),
          tooltip: charges.map((charge) => this.chargeText(charge)).join(' · '),
          paid: charges.length > 0,
        };
      }),
    );
  });

  protected step(months: number): void {
    this.month.update((month) => addMonthsToMonth(month, months));
  }

  /**
   * Moves the grid's focus. It moves from `focusDay` rather than from the key's button: a key pressed before the grid
   * shows a new month lands on the old month's button.
   */
  protected moveFocus(event: KeyboardEvent): void {
    const date = this.focusDay();
    const weekday = weekdayOf(date);
    const moves: Partial<Record<string, () => IsoDate>> = {
      ArrowLeft: () => addDays(date, -1),
      ArrowRight: () => addDays(date, 1),
      ArrowUp: () => addDays(date, -7),
      ArrowDown: () => addDays(date, 7),
      Home: () => addDays(date, -weekday),
      End: () => addDays(date, 6 - weekday),
      PageUp: () => addMonths(date, -1),
      PageDown: () => addMonths(date, 1),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const target = move();
    if (monthOf(target) !== this.month()) this.month.set(monthOf(target));
    this.focusDay.set(target);
    // A day of the month on screen takes focus now; another month's, once the grid shows it.
    const button = this.dayButton(target);
    if (button) button.focus();
    else afterNextRender(() => this.dayButton(target)?.focus(), { injector: this.injector });
  }

  private dayButton(date: IsoDate): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>(`.day[data-date="${date}"]`);
  }

  private dayLabel(date: IsoDate, payments: number): string {
    const count = payments === 0 ? '' : payments === 1 ? ', 1 payment' : `, ${payments} payments`;
    return `${spokenDayText(date)}${count}`;
  }

  private chargeText({ name, amount, currency, converted, manual }: CalendarCharge): string {
    const money = amountText(amount, currency, this.settings.saved()?.country);
    return `${name} ${converted ? '≈ ' : ''}${money}${manual ? ' (renew manually)' : ''}`;
  }
}

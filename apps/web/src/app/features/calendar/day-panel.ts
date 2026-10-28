import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { ClockService } from '../../core/clock/clock-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { chargeAmountText } from '../../shared/charge-text';
import { dateText, spokenDayText } from '../../shared/date-text';
import { ProviderIcon } from '../../shared/provider-icon/provider-icon';
import { WrongDate } from '../../shared/wrong-date/wrong-date';
import type { CalendarDay, CalendarEntry } from './calendar-entries';

let nextId = 0;

/**
 * A Calendar day's charges (P10, M7.4), beside the grid or in a bottom sheet on a phone: for each, what it is, its
 * list (a link), what it costs as charged (≈ when converted), how it renews, "Ends" on its last charge, and for one
 * still to come of an Ongoing item, "Wrong date?" (P4's: the new date becomes its anchor). Focus starts on its heading,
 * or the charge it was opened on.
 */
@Component({
  selector: 'ss-day-panel',
  imports: [MatButton, MatIcon, MatIconButton, ProviderIcon, RouterLink],
  templateUrl: './day-panel.html',
  styleUrl: './day-panel.scss',
  host: { '(keydown.escape)': 'close($event)' },
})
export class DayPanel {
  private readonly settings = inject(SettingsStore);
  private readonly today = inject(ClockService).today;
  private readonly wrongDates = inject(WrongDate);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly day = input.required<CalendarDay>();
  /** The charge it was opened on, by key: focus starts on it. */
  readonly focusKey = input<string>();
  readonly closed = output<void>();

  protected readonly headingId = `ss-day-panel-${nextId++}`;
  protected readonly heading = computed(() => spokenDayText(this.day().date));
  protected readonly entries = computed(() => {
    const country = this.settings.saved()?.country;
    const today = this.today();
    return this.day().entries.map((entry) => ({
      ...entry,
      amount: chargeAmountText(entry.charge, country),
      endsOn:
        entry.charge.ends && entry.item.billing.mode === 'recurring'
          ? entry.item.billing.endDate
          : undefined,
      // Only a charge still to come can be on the wrong date, and only an anchor can move.
      movable: entry.charge.date >= today && entry.item.billing.mode === 'recurring',
    }));
  });
  protected readonly dateText = dateText;

  constructor() {
    afterNextRender(() => {
      const key = this.focusKey();
      const target = key
        ? this.host.nativeElement.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"] h3`)
        : undefined;
      (target ?? this.host.nativeElement.querySelector<HTMLElement>('h2'))?.focus();
    });
  }

  protected close(event?: Event): void {
    event?.stopPropagation();
    this.closed.emit();
  }

  protected async wrongDate(entry: CalendarEntry): Promise<void> {
    await this.wrongDates.ask(entry.item, entry.title, entry.charge.date);
  }
}

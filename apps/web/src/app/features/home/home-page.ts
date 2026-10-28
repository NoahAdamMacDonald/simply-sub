import { Component, Injector, computed, inject, linkedSignal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { addMonths, monthOf, monthRange, type IsoDate, type IsoMonth } from '@simply-sub/core';
import { firstValueFrom } from 'rxjs';
import { ClockService } from '../../core/clock/clock-service';
import { MetricsService } from '../../core/metrics/metrics-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { ListsRepository } from '../../core/storage/lists-repository';
import { BudgetTotals } from '../../shared/budget-totals/budget-totals';
import { chargeAmountText, nearDateText } from '../../shared/charge-text';
import { EmptyState } from '../../shared/empty-state/empty-state';
import { MiniCalendar, type CalendarCharge } from '../../shared/mini-calendar/mini-calendar';
import { importedText } from '../settings/backup-text';

/** How many charges "Next payments" lists (P2). */
const nextCount = 3;

/**
 * Home (PROJECT-PLAN P2, M7.3): budget status at a glance and the way into the lists. A mini calendar of the month with
 * a dot on each day with a charge (the Calendar's charges, P10), whose days and title open the Calendar on that month;
 * every list's totals against the budgets (M7.2, BLUEPRINT §8.1.1); the Subscription Lists button; and the next three
 * payments. With no lists, an empty state offers a list, Search or a backup instead.
 */
@Component({
  selector: 'ss-home-page',
  imports: [BudgetTotals, EmptyState, MatButton, MatIcon, MiniCalendar, RouterLink],
  templateUrl: './home-page.html',
  styleUrl: './home-page.scss',
})
export class HomePage {
  private readonly metrics = inject(MetricsService);
  private readonly settings = inject(SettingsStore);
  private readonly lists = inject(ListsRepository);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly today = inject(ClockService).today;

  protected readonly global = this.metrics.global;
  protected readonly state = computed<'loading' | 'error' | 'empty' | 'ready'>(() => {
    const statuses = [this.lists.status(), this.metrics.status()];
    if (statuses.includes('error')) return 'error';
    if (!statuses.every((status) => status === 'ready')) return 'loading';
    return this.lists.records().length === 0 ? 'empty' : 'ready';
  });
  /** Prices still on their way: the catalog file an item needs hasn't loaded. */
  protected readonly pricing = computed(() =>
    [...this.metrics.resolutions().values()].some(
      (result) => !result.ok && result.unresolved.reason === 'pending',
    ),
  );

  /** The month the mini calendar shows: this one, until ‹ or › moves it, and the new one at midnight into it. */
  protected readonly month = linkedSignal<IsoDate, IsoMonth>({
    source: this.today,
    computation: (today) => monthOf(today),
  });
  /** Each item's name, by id, for the calendar's tooltips and Next payments: its nickname, else its service's. */
  private readonly names = computed(() => {
    const names = new Map<string, string>();
    for (const result of this.metrics.resolutions().values()) {
      if (result.ok) {
        const { item, name } = result.resolved;
        names.set(item.id, item.nickname ?? name);
      }
    }
    return names;
  });
  /** The month's charges, for the dots. */
  protected readonly charges = computed<CalendarCharge[]>(() =>
    this.metrics.charges(monthRange(this.month())).map((charge) => ({
      date: charge.date,
      name: this.names().get(charge.itemId) ?? '',
      amount: charge.amount,
      currency: charge.currency,
      converted: charge.converted,
      manual: charge.manual,
    })),
  );
  /** "Oct 28 Crave $22.00": the next three charges from today, as charged. */
  protected readonly next = computed(() => {
    const today = this.today();
    const country = this.settings.saved()?.country;
    return this.metrics
      .charges({ from: today, to: addMonths(today, 12) })
      .slice(0, nextCount)
      .map((charge, index) => ({
        key: `${charge.itemId}-${charge.date}-${index}`,
        date: nearDateText(charge.date, today),
        name: this.names().get(charge.itemId) ?? '',
        amount: chargeAmountText({ ...charge, tax: 0 }, country),
        manual: charge.manual,
      }));
  });

  protected readonly monthOf = monthOf;

  /** A day or the month's title: the Calendar on that month (P2). */
  protected openCalendar(month: IsoMonth): void {
    void this.router.navigate(['/calendar'], { queryParams: { month } });
  }

  /**
   * The empty state's Import backup: Settings' dialog, then what it did. Material's dialog and snackbar load with it,
   * as Home rarely needs them.
   */
  protected async importBackup(): Promise<void> {
    const [{ MatDialog }, { MatSnackBar }, { ImportBackupDialog }] = await Promise.all([
      import('@angular/material/dialog'),
      import('@angular/material/snack-bar'),
      import('../settings/import-backup-dialog'),
    ]);
    const result = await firstValueFrom(
      this.injector
        .get(MatDialog)
        .open(ImportBackupDialog, { maxWidth: 'min(480px, calc(100vw - 32px))', width: '480px' })
        .afterClosed(),
    );
    if (result) {
      this.injector
        .get(MatSnackBar)
        .open(importedText(result.mode, result.counts), undefined, { duration: 5000 });
    }
  }
}

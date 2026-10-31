import { Component, Injector, computed, inject, linkedSignal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { Router, RouterLink } from '@angular/router';
import {
  addDays,
  monthOf,
  monthRange,
  nextChargeDate,
  planNoticeText,
  priceChangeDays,
  reanchored,
  type IsoDate,
  type IsoMonth,
} from '@simply-sub/core';
import { firstValueFrom } from 'rxjs';
import { ClockService } from '../../core/clock/clock-service';
import { MetricsService } from '../../core/metrics/metrics-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { ItemsRepository } from '../../core/storage/items-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import { BillingCheck } from '../../shared/billing-check/billing-check';
import { BudgetTotals } from '../../shared/budget-totals/budget-totals';
import { BudgetWarnings } from '../../shared/budget-warnings/budget-warnings';
import { chargeAmountText, nearDateText } from '../../shared/charge-text';
import { dateText, dayText } from '../../shared/date-text';
import { EmptyState } from '../../shared/empty-state/empty-state';
import { MiniCalendar, type CalendarCharge } from '../../shared/mini-calendar/mini-calendar';
import { amountText, intervalSpoken } from '../../shared/price-tag/price-text';
import { OptimizationsLink } from '../lists/optimizations-link';
import { importedText } from '../settings/backup-text';

/** How far ahead "Coming up" looks (M7.10). */
const comingDays = 14;

/**
 * Home (PROJECT-PLAN P2, M7.3, M7.10): a hub. Quick actions (Add a subscription to a list or a custom one, New list,
 * Open a list); the budget warnings (dismissable, M7.7) and every list's totals against the budgets (M7.2, BLUEPRINT
 * §8.1.1); what's coming up in the next 14 days, with Mark renewed on a manual renewal; a mini calendar of the month,
 * whose days and title open the Calendar on it; each list with this month's total; each list's ways to save; and what
 * catalog updates changed in the lists' plans (M10.27) and prices this past month. With no lists, an empty state
 * offers a list, Search or a backup instead.
 */
@Component({
  selector: 'ss-home-page',
  imports: [
    BillingCheck,
    BudgetTotals,
    BudgetWarnings,
    EmptyState,
    MatButton,
    MatIcon,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MiniCalendar,
    OptimizationsLink,
    RouterLink,
  ],
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
  private readonly items = inject(ItemsRepository);

  protected readonly global = this.metrics.global;
  protected readonly state = computed<'loading' | 'error' | 'empty' | 'ready'>(() => {
    const statuses = [this.lists.status(), this.metrics.status()];
    if (statuses.includes('error')) return 'error';
    if (!statuses.every((status) => status === 'ready')) return 'loading';
    return this.lists.records().length === 0 ? 'empty' : 'ready';
  });
  /** Every item billed on a period its provider no longer sells (M10.28), whose user should check their billing. */
  protected readonly billingChecks = computed(() =>
    [...this.metrics.resolutions().values()].flatMap((result) =>
      result.ok && result.resolved.periodChange ? [result.resolved] : [],
    ),
  );
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
  /** Each item's next charge, by id: one dated before it is the payment just made, as the schedule counts it. */
  private readonly nextDates = computed(() => {
    const next = new Map<string, IsoDate>();
    for (const result of this.metrics.resolutions().values()) {
      const date = result.ok ? result.resolved.nextCharge?.date : undefined;
      if (result.ok && date !== undefined) next.set(result.resolved.item.id, date);
    }
    return next;
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
  /**
   * "Oct 28 Crave $22.00": every charge of the next 14 days still to pay, as charged, with Mark renewed on a manual
   * renewal (M7.10). A charge before its item's next one is paid already (a renewal marked, or the payment for a plan
   * whose next renewal is still to come), so it isn't listed.
   */
  protected readonly coming = computed(() => {
    const today = this.today();
    const country = this.settings.saved()?.country;
    const next = this.nextDates();
    return this.metrics
      .charges({ from: today, to: addDays(today, comingDays) })
      .filter((charge) => charge.date >= (next.get(charge.itemId) ?? charge.date))
      .map((charge, index) => ({
        key: `${charge.itemId}-${charge.date}-${index}`,
        itemId: charge.itemId,
        charged: charge.date,
        date: nearDateText(charge.date, today),
        name: this.names().get(charge.itemId) ?? '',
        amount: chargeAmountText({ ...charge, tax: 0 }, country),
        // The last renewal before an end date has no next one to move on to.
        renewable: charge.manual && charge.ends !== true,
      }));
  });

  /** Each list, the way into it (M7.10): its name, this month and how many subscriptions. */
  protected readonly listCards = computed(() => {
    const saved = this.settings.saved();
    return this.lists.records().map((list) => {
      const metrics = this.metrics.metrics(list.id);
      const count =
        this.metrics.list(list.id).resolved.length + this.metrics.list(list.id).unresolved.length;
      return {
        id: list.id,
        name: list.name,
        month:
          metrics && saved
            ? `${metrics.converted.thisMonth ? '≈ ' : ''}${amountText(metrics.thisMonth, saved.currency, saved.country)} this month`
            : '',
        count: count === 1 ? '1 subscription' : `${count} subscriptions`,
      };
    });
  });

  /** What catalog updates changed in the lists' prices this past month (M7.10): "$18.99 → $19.99 a month". */
  protected readonly changes = computed(() => {
    const saved = this.settings.saved();
    const since = addDays(this.today(), -priceChangeDays);
    return (saved?.priceChanges ?? [])
      .filter((change) => change.date >= since)
      .map((change) => ({
        key: `${change.planId} ${change.currency} ${change.interval}/${change.intervalCount}`,
        title: change.title,
        text: `${amountText(change.from, change.currency, saved?.country)} → ${amountText(change.to, change.currency, saved?.country)} ${intervalSpoken(change.interval, change.intervalCount)}`,
        date: dayText(change.date),
      }));
  });

  /**
   * What catalog updates changed in the lists' plans this past month (M10.27): "Claude Max 20x is now called Ultra",
   * "Claude Max ends for its subscribers on Mar 1, 2027".
   */
  protected readonly notices = computed(() => {
    const since = addDays(this.today(), -priceChangeDays);
    return (this.settings.saved()?.planNotices ?? [])
      .filter((notice) => notice.date >= since)
      .map((notice) => ({
        key: `${notice.kind} ${notice.planId}`,
        text: planNoticeText(notice, dateText),
        date: dayText(notice.date),
      }));
  });
  /** The changes section's heading: what it holds. */
  protected readonly changesHeading = computed(() => {
    const prices = this.changes().length > 0;
    const plans = this.notices().length > 0;
    return plans && prices ? 'Plan and price changes' : plans ? 'Plan changes' : 'Price changes';
  });

  /**
   * Mark renewed (M7.10): the renewal due on `date` is paid, so the next one is the charge after it, as P4's "Wrong
   * date?" would move it; saved at once, with Undo. The payment stays on its due date, in the totals as before.
   */
  protected async markRenewed(itemId: string, date: IsoDate): Promise<void> {
    const item = this.items.byId().get(itemId);
    if (!item || item.billing.mode !== 'recurring') return;
    const before = item.billing;
    const after = nextChargeDate(before, addDays(date, 1));
    if (after === undefined) return;
    await this.items.update(itemId, { billing: reanchored(before, after) });
    const { openSnack, undoMillis } = await import('../../shared/snack/snack');
    const name = this.names().get(itemId) ?? 'It';
    openSnack(this.injector, `${name} is renewed`, 'Undo', {
      duration: undoMillis,
    })
      .onAction()
      .subscribe(() => void this.items.update(itemId, { billing: before }));
  }

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
    const [{ MatDialog }, { openSnack, snackMillis }, { ImportBackupDialog }] = await Promise.all([
      import('@angular/material/dialog'),
      import('../../shared/snack/snack'),
      import('../settings/import-backup-dialog'),
    ]);
    const result = await firstValueFrom(
      this.injector
        .get(MatDialog)
        .open(ImportBackupDialog, { maxWidth: 'min(480px, calc(100vw - 32px))', width: '480px' })
        .afterClosed(),
    );
    if (result) {
      openSnack(this.injector, importedText(result.mode, result.counts), undefined, {
        duration: snackMillis,
      });
    }
  }
}

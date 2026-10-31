import { Component, Injector, computed, inject, input } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import {
  itemTitle,
  periodText,
  switchedBilling,
  type ListItem,
  type ResolvedItem,
} from '@simply-sub/core';
import { SettingsStore } from '../../core/settings/settings-store';
import { ItemsRepository } from '../../core/storage/items-repository';
import { dateText } from '../date-text';
import { amountText } from '../price-tag/price-text';

let nextId = 0;

/**
 * "Check your billing" (P2, P4, M10.28): an item billed on a period its provider no longer sells, which counts as the
 * closest period still sold from its next renewal. It says so, links to the plan's page, and offers three choices,
 * saved to the item at once with Undo: switch it to that period from the renewal, cancel it at the renewal, or keep it
 * as it is (grandfathered). Any of them ends the check. Home lists every item's; List view's card shows its own.
 */
@Component({
  selector: 'ss-billing-check',
  imports: [MatButton, MatIcon],
  templateUrl: './billing-check.html',
  styleUrl: './billing-check.scss',
})
export class BillingCheck {
  private readonly items = inject(ItemsRepository);
  private readonly settings = inject(SettingsStore);
  private readonly injector = inject(Injector);

  /** An item with a periodChange. */
  readonly resolved = input.required<ResolvedItem>();

  protected readonly id = `ss-billing-check-${nextId++}`;
  protected readonly title = computed(() => itemTitle(this.resolved()));
  /** "monthly": the period it's billed on now. */
  protected readonly now = computed(() => {
    const { billing } = this.resolved().item;
    return periodText(billing.interval, billing.intervalCount);
  });
  /** "yearly": the period it switches to, if one is still sold. */
  protected readonly next = computed(() => {
    const to = this.resolved().periodChange?.to;
    return to && periodText(to.interval, to.intervalCount);
  });
  protected readonly text = computed(() => {
    const { periodChange } = this.resolved();
    if (!periodChange) return '';
    const sold = `${this.title()} isn’t sold billed ${this.now()} any more.`;
    const { to } = periodChange;
    if (!to) return `${sold} No other period is, so it counts as before until you choose.`;
    const amount = amountText(to.amount, to.currency, this.settings.saved()?.country);
    return `${sold} From ${dateText(periodChange.on)} it counts as ${this.next()}, at ${amount}.`;
  });
  /** Where to check: the plan's page, else its cancel page. */
  protected readonly link = computed(() => this.resolved().link ?? this.resolved().cancelUrl);
  /** Cancel at renewal: only a recurring item has a renewal to end on. */
  protected readonly cancellable = computed(
    () => this.resolved().item.billing.mode === 'recurring',
  );

  /** Billed on the period still sold from the renewal. */
  protected switchPeriod(): Promise<void> {
    const { item, periodChange } = this.resolved();
    const to = periodChange?.to;
    if (!periodChange || !to) return Promise.resolve();
    return this.save(
      { billing: switchedBilling(item.billing, to, periodChange.on) },
      `${this.title()} is billed ${this.next()} from ${dateText(periodChange.on)}`,
    );
  }

  /** Ends at the renewal: no charge from then on. */
  protected cancelAtRenewal(): Promise<void> {
    const { item, periodChange } = this.resolved();
    if (!periodChange || item.billing.mode !== 'recurring') return Promise.resolve();
    return this.save(
      { billing: { ...item.billing, endDate: periodChange.on } },
      `${this.title()} ends on ${dateText(periodChange.on)}`,
    );
  }

  /** Kept as it is: grandfathered. */
  protected keep(): Promise<void> {
    return this.save({ grandfathered: true }, `${this.title()} stays billed ${this.now()}`);
  }

  /** Saves `changes` to the item at once, with Undo putting back what they replaced. */
  private async save(
    changes: Partial<Pick<ListItem, 'billing' | 'grandfathered'>>,
    message: string,
  ): Promise<void> {
    const { item } = this.resolved();
    const before: Partial<Pick<ListItem, 'billing' | 'grandfathered'>> = {
      billing: item.billing,
      grandfathered: item.grandfathered,
    };
    await this.items.update(item.id, changes);
    const { openSnack, undoMillis } = await import('../snack/snack');
    openSnack(this.injector, message, 'Undo', { duration: undoMillis })
      .onAction()
      .subscribe(() => void this.items.update(item.id, before));
  }
}

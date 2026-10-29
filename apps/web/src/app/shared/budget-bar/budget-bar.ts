import { Component, computed, inject, input } from '@angular/core';
import { budgetBar } from '@simply-sub/core';
import { SettingsStore } from '../../core/settings/settings-store';
import { amountText } from '../price-tag/price-text';

/**
 * A pill progress bar with its label inside the fill, as on the wireframes (BLUEPRINT §8.1, §8.1.1). Its level is ok
 * under 75%, warn to 100% and over past it (data-level), and a bar over its max is full with the real percent
 * ("112%"); core's budgetBar decides. The fill is one colour, which changes gradually with how far along the budget it
 * is (M7.7, the user's choice): green with nothing spent, yellow exactly at the budget, red at half again over it. With
 * a `marker` (the Calendar's monthly budget) a tick marks it, and the colour compares the month's total to it, so a
 * month that goes over shows it before it's paid. The element is the progressbar: name it with `aria-label` or
 * `aria-labelledby`.
 */
@Component({
  selector: 'ss-budget-bar',
  templateUrl: './budget-bar.html',
  styleUrl: './budget-bar.scss',
  host: {
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    '[attr.aria-valuenow]': 'valueNow()',
    '[attr.aria-valuetext]': 'valueText()',
    '[attr.data-level]': 'bar().level',
    '[style.--fill]': 'bar().fill',
    '[style.--marker]': 'bar().markerAt ?? null',
    '[style.--toward-yellow]': "bar().towardYellow * 100 + '%'",
    '[style.--toward-red]': "bar().towardRed * 100 + '%'",
  },
})
export class BudgetBar {
  private readonly settings = inject(SettingsStore);

  /** Spent so far, in `currency`. */
  readonly value = input.required<number>();
  /** The budget, or with a marker the total the bar is out of. */
  readonly max = input.required<number>();
  /** The monthly budget, on the Calendar's bar. */
  readonly marker = input<number>();
  /** What the label inside the fill shows: "50%", or the amount spent ("$44.45"). */
  readonly labelMode = input<'percent' | 'amount'>('percent');
  /** The amounts' currency: the user's, unless given. */
  readonly currency = input<string>();

  protected readonly bar = computed(() => budgetBar(this.value(), this.max(), this.marker()));
  /** The percent, within the 0 to 100 that aria-valuenow allows; the text says how far over it is. */
  protected readonly valueNow = computed(() => Math.min(this.bar().percent, 100));
  protected readonly label = computed(() =>
    this.labelMode() === 'percent' ? `${this.bar().percent}%` : this.money(this.value()),
  );
  protected readonly valueText = computed(() => {
    const marker = this.marker();
    const amounts = `${this.money(this.value())} of ${this.money(this.max())}`;
    if (marker !== undefined) return `${amounts}, budget ${this.money(marker)}`;
    return this.labelMode() === 'percent' ? `${this.bar().percent}%, ${amounts}` : amounts;
  });

  private money(amount: number): string {
    const saved = this.settings.saved();
    const currency = this.currency() ?? saved?.currency;
    return currency === undefined
      ? amount.toLocaleString('en')
      : amountText(amount, currency, saved?.country);
  }
}

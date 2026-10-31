import { Component, booleanAttribute, computed, inject, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import type { ListMetrics } from '@simply-sub/core';
import { ClockService } from '../../core/clock/clock-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { BudgetBar } from '../budget-bar/budget-bar';
import { amountText } from '../price-tag/price-text';

/** One budget's line: this month's or this year's total, against its budget when there's one. */
interface BudgetLine {
  kind: 'month' | 'year';
  heading: string;
  amount: number;
  budget?: number;
  /** "$100 of $200 this month", or "$100 this month" with no budget; ≈ and "about" when it's converted. */
  shown: string;
  spoken: string;
  /** Home's link in place of a missing budget. */
  prompt: string;
}

let nextId = 0;

/**
 * This month's and this year's totals against the budgets (PROJECT-PLAN §3.1, BLUEPRINT §8.1.1, M7.2): Home's for
 * every list together (P2), a list's on List view (P4) and on its Lists card (P3). Each budget that's set is a bar
 * with "$100 of $200 this month" beside it; without one, the total alone, and on Home "Set a monthly budget →". The
 * totals include sales tax, as charges do.
 */
@Component({
  selector: 'ss-budget-totals',
  imports: [BudgetBar, MatIcon, RouterLink],
  templateUrl: './budget-totals.html',
  styleUrl: './budget-totals.scss',
})
export class BudgetTotals {
  private readonly settings = inject(SettingsStore);
  private readonly today = inject(ClockService).today;

  readonly metrics = input.required<ListMetrics>();
  /** A Lists card (P3): the bar and its total, with no headings. */
  readonly compact = input(false, { transform: booleanAttribute });
  /** Home (P2): "Set a monthly budget →" in place of a budget that isn't set. */
  readonly prompt = input(false, { transform: booleanAttribute });
  /** What the totals are of, which a card's bars are named for: "Work Related". */
  readonly name = input('');

  protected readonly id = `ss-budget-totals-${nextId++}`;
  protected readonly lines = computed<BudgetLine[]>(() => {
    const saved = this.settings.saved();
    const { thisMonth, thisYear, converted } = this.metrics();
    const year = this.today().slice(0, 4);
    const money = (amount: number) => amountText(amount, saved?.currency ?? 'USD', saved?.country);
    const line = (
      kind: BudgetLine['kind'],
      heading: string,
      amount: number,
      budget: number | undefined,
      when: string,
      prompt: string,
    ): BudgetLine => {
      const approx = kind === 'month' ? converted.thisMonth : converted.thisYear;
      const of = budget === undefined || this.compact() ? '' : ` of ${money(budget)}`;
      return {
        kind,
        heading,
        amount,
        ...(budget !== undefined && { budget }),
        shown: `${approx ? '≈ ' : ''}${money(amount)}${of} ${when}`,
        spoken: `${approx ? 'about ' : ''}${money(amount)}${of} ${when}`,
        prompt,
      };
    };
    return [
      line(
        'month',
        'Monthly budget',
        thisMonth,
        saved?.monthlyBudget,
        'this month',
        'Set a monthly budget',
      ),
      line(
        'year',
        'Annual budget',
        thisYear,
        saved?.annualBudget,
        this.compact() ? 'this year' : `in ${year}`,
        'Set an annual budget',
      ),
    ];
  });
  /**
   * "≈ $4.79 cash back in 2026" (M10.29): what this year's charges earn on the cards they're paid with, which the
   * totals don't take off. Not on a Lists card, and not when no card pays any.
   */
  protected readonly cashback = computed(() => {
    const { thisYear, approx } = this.metrics().cashback;
    if (this.compact() || thisYear <= 0) return undefined;
    const saved = this.settings.saved();
    const amount = amountText(thisYear, saved?.currency ?? 'USD', saved?.country);
    const year = this.today().slice(0, 4);
    return {
      shown: `${approx ? '≈ ' : ''}${amount} cash back in ${year}`,
      spoken: `${approx ? 'about ' : ''}${amount} cash back in ${year}, not taken off the totals`,
    };
  });
  /** "1 subscription not counted": one it can't price, or priced in a currency it has no rate for. */
  protected readonly notCounted = computed(() => {
    const count = this.metrics().notCounted;
    if (count === 0) return undefined;
    return count === 1 ? '1 subscription not counted' : `${count} subscriptions not counted`;
  });
}

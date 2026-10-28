import { Component, computed, inject, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { monthOf, type BudgetWarnings as Warnings, type IsoMonth } from '@simply-sub/core';
import { ClockService } from '../../core/clock/clock-service';
import { SettingsStore } from '../../core/settings/settings-store';
import type { ShownAndSpoken } from '../charge-text';
import { monthText } from '../date-text';
import { amountText } from '../price-tag/price-text';

/** One warning: what goes over which budget, and the month to see in the Calendar. */
interface Warning extends ShownAndSpoken {
  kind: 'month' | 'year';
  /** The month the Calendar opens on, and what its link calls it: "November 2026", "this month". */
  month?: { month: IsoMonth; name: string };
}

/**
 * The budget warning banners (PROJECT-PLAN §3.1, M7.6): "Your payments in November 2026 add up to $212.40, over your
 * $200.00 monthly budget." for the first of the next 12 months over the monthly budget, and one for this year's
 * payments, past and to come, over the annual budget, from core's budget checks (ListMetrics.warnings). Home's are
 * for every list together; List view's for its own list ("This list's payments…"), which links its month in the
 * Calendar showing that list. A status region, so a warning that appears as prices load is read out.
 */
@Component({
  selector: 'ss-budget-warnings',
  imports: [MatIcon, RouterLink],
  templateUrl: './budget-warnings.html',
  styleUrl: './budget-warnings.scss',
})
export class BudgetWarnings {
  private readonly settings = inject(SettingsStore);
  private readonly today = inject(ClockService).today;

  /** Core's checks; none while the totals aren't ready. */
  readonly warnings = input<Warnings | undefined>();
  /** List view's list: its own payments, and its month in the Calendar showing it alone. */
  readonly listId = input<string>();

  protected readonly lines = computed<Warning[]>(() => {
    const warnings = this.warnings();
    const saved = this.settings.saved();
    if (!warnings || !saved) return [];
    const money = (amount: number) => amountText(amount, saved.currency, saved.country);
    const whose = this.listId() === undefined ? 'Your payments' : 'This list’s payments';
    const line = (
      when: string,
      { amount, approx }: { amount: number; approx: boolean },
      budget: string,
    ) => ({
      shown: `${whose} ${when} add up to ${approx ? '≈ ' : ''}${money(amount)}, over your ${budget}.`,
      spoken: `${whose} ${when} add up to ${approx ? 'about ' : ''}${money(amount)}, over your ${budget}.`,
    });
    const lines: Warning[] = [];
    const { month, year } = warnings;
    if (month && saved.monthlyBudget !== undefined) {
      const name = month.month === monthOf(this.today()) ? 'this month' : monthText(month.month);
      lines.push({
        kind: 'month',
        ...line(
          name === 'this month' ? name : `in ${name}`,
          month,
          `${money(saved.monthlyBudget)} monthly budget`,
        ),
        month: { month: month.month, name },
      });
    }
    if (year && saved.annualBudget !== undefined) {
      lines.push({
        kind: 'year',
        ...line('this year, past and to come,', year, `${money(saved.annualBudget)} annual budget`),
      });
    }
    return lines;
  });

  /** The Calendar on the month, showing List view's list alone. */
  protected calendarParams(month: IsoMonth): Record<string, string> {
    const listId = this.listId();
    return listId === undefined ? { month } : { month, lists: listId };
  }
}

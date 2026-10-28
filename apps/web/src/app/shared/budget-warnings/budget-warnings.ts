import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
} from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import {
  budgetWarningKey,
  monthOf,
  withDismissedWarning,
  withoutDismissedWarnings,
  type BudgetWarnings as Warnings,
  type IsoMonth,
} from '@simply-sub/core';
import { ClockService } from '../../core/clock/clock-service';
import { SettingsStore } from '../../core/settings/settings-store';
import type { ShownAndSpoken } from '../charge-text';
import { monthText } from '../date-text';
import { amountText } from '../price-tag/price-text';

/** One warning: what goes over which budget, and the month to see in the Calendar. */
interface Warning extends ShownAndSpoken {
  kind: 'month' | 'year';
  /** Its key among the dismissed (core's budgetWarningKey). */
  key: string;
  /** Its ✕'s name: "Dismiss the November 2026 warning". */
  dismissLabel: string;
  /** The month the Calendar opens on, and what its link calls it: "November 2026", "this month". */
  month?: { month: IsoMonth; name: string };
}

/**
 * The budget warning banners (PROJECT-PLAN §3.1, M7.6): "Your payments in November 2026 add up to $212.40, over your
 * $200.00 monthly budget." for the first of the next 12 months over the monthly budget, and one for this year's
 * payments, past and to come, over the annual budget, from core's budget checks (ListMetrics.warnings). Home's are
 * for every list together; List view's for its own list ("This list's payments…"), which links its month in the
 * Calendar showing that list. A status region, so a warning that appears as prices load is read out. Its ✕ hides it
 * until its period or budget changes (M7.7, settings.dismissedBudgetWarnings), and "Show 1 hidden budget warning"
 * brings the hidden ones back.
 */
@Component({
  selector: 'ss-budget-warnings',
  imports: [MatButton, MatIcon, MatIconButton, RouterLink],
  templateUrl: './budget-warnings.html',
  styleUrl: './budget-warnings.scss',
})
export class BudgetWarnings {
  private readonly settings = inject(SettingsStore);
  private readonly today = inject(ClockService).today;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** Core's checks; none while the totals aren't ready. */
  readonly warnings = input<Warnings | undefined>();
  /** List view's list: its own payments, and its month in the Calendar showing it alone. */
  readonly listId = input<string>();

  /** Every warning that applies, the dismissed ones too. */
  private readonly all = computed<Warning[]>(() => {
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
    const listId = this.listId();
    if (month && saved.monthlyBudget !== undefined) {
      const name = month.month === monthOf(this.today()) ? 'this month' : monthText(month.month);
      lines.push({
        kind: 'month',
        key: budgetWarningKey(listId, 'month', month.month, saved.monthlyBudget),
        dismissLabel: `Dismiss the ${name === 'this month' ? 'this month’s' : name} warning`,
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
        key: budgetWarningKey(listId, 'year', year.year, saved.annualBudget),
        dismissLabel: 'Dismiss this year’s warning',
        ...line('this year, past and to come,', year, `${money(saved.annualBudget)} annual budget`),
      });
    }
    return lines;
  });
  private readonly dismissed = computed(
    () => new Set(this.settings.saved()?.dismissedBudgetWarnings ?? []),
  );
  /** The warnings shown: the ones not dismissed. */
  protected readonly lines = computed(() =>
    this.all().filter((warning) => !this.dismissed().has(warning.key)),
  );
  /** The dismissed ones that would show, which "Show hidden" brings back. */
  protected readonly hidden = computed(() =>
    this.all().filter((warning) => this.dismissed().has(warning.key)),
  );

  /** Hides the warning until its period or budget changes; focus moves to "Show hidden", which brings it back. */
  protected async dismiss(warning: Warning): Promise<void> {
    const saved = this.settings.saved();
    if (!saved) return;
    await this.settings.update({
      dismissedBudgetWarnings: withDismissedWarning(
        saved.dismissedBudgetWarnings ?? [],
        warning.key,
        this.today(),
      ),
    });
    this.focusAfterRender('.show-hidden');
  }

  /** Shows the hidden warnings again, with focus on the first one's ✕. */
  protected async showHidden(): Promise<void> {
    const saved = this.settings.saved();
    if (!saved) return;
    const left = withoutDismissedWarnings(
      saved.dismissedBudgetWarnings ?? [],
      this.hidden().map((warning) => warning.key),
    );
    await this.settings.update({ dismissedBudgetWarnings: left.length > 0 ? left : undefined });
    this.focusAfterRender('.dismiss');
  }

  private focusAfterRender(selector: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }

  /** The Calendar on the month, showing List view's list alone. */
  protected calendarParams(month: IsoMonth): Record<string, string> {
    const listId = this.listId();
    return listId === undefined ? { month } : { month, lists: listId };
  }
}

import { Component, inject } from '@angular/core';
import { MetricsService } from '../../core/metrics/metrics-service';
import { BudgetTotals } from '../../shared/budget-totals/budget-totals';

/**
 * Home (PROJECT-PLAN P2): every list's totals against the monthly and annual budgets (BLUEPRINT §8.1.1, M7.2), with
 * "Set a monthly budget →" where one isn't set. The rest of the page comes with M7.3.
 */
@Component({
  selector: 'ss-home-page',
  imports: [BudgetTotals],
  templateUrl: './home-page.html',
})
export class HomePage {
  protected readonly global = inject(MetricsService).global;
}

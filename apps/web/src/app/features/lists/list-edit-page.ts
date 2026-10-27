import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { readAddRequest, type Interval } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { planTitle } from '../../shared/sub-card/card-text';

/**
 * Placeholder: list edit (PROJECT-PLAN P5), for both new and existing lists, is built in M6.4. Until then it says what
 * a price click from Search asked it to add (?add= or ?addBundle=, flows F1 and F4, M5.4), which the item dialog will
 * open with (M6.5).
 */
@Component({
  selector: 'ss-list-edit-page',
  templateUrl: './list-edit-page.html',
})
export class ListEditPage {
  private readonly catalog = inject(CatalogStore);
  private readonly params = toSignal(inject(ActivatedRoute).queryParams, { requireSync: true });

  /** The plan or bundle waiting to be added, by name (its id while the catalog loads), and how often it's billed. */
  protected readonly adding = computed(() => {
    const request = readAddRequest(this.params());
    if (!request) return undefined;
    const data = this.catalog.catalog();
    let name: string;
    if (request.kind === 'plan') {
      const provider = data?.providers.find((candidate) =>
        candidate.plans.some((plan) => plan.id === request.planId),
      );
      const plan = provider?.plans.find((candidate) => candidate.id === request.planId);
      name = provider && plan ? planTitle(provider.name, plan.name) : request.planId;
    } else {
      name =
        data?.bundles.find((bundle) => bundle.id === request.bundleId)?.name ?? request.bundleId;
    }
    return { name, period: periodText(request.interval, request.intervalCount) };
  });
}

/** How often a period bills, in words: monthly, every 3 months, every 30 days. */
function periodText(interval: Interval, count: number): string {
  if (count === 1) {
    return { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' }[interval];
  }
  return `every ${count} ${interval}s`;
}

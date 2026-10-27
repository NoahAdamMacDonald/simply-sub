import { Component, DestroyRef, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { readAddRequest, type Interval } from '@simply-sub/core';
import { map } from 'rxjs';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { ListDraftService } from '../../core/lists/list-draft-service';
import { planTitle } from '../../shared/sub-card/card-text';

/**
 * Placeholder: list edit (PROJECT-PLAN P5), for both new and existing lists, is built in M6.4. Until then it says what
 * a price click from Search asked it to add (?add= or ?addBundle=, flows F1, F2 and F4, M5.4), which the item dialog
 * will open with (M6.5), and [+ Add from catalog] opens Search in pick mode for the list (F2, M5.5). /lists/new makes
 * the new list's draft and opens its editor in its place (M6.3), so a new list has an id to add to as well.
 */
@Component({
  selector: 'ss-list-edit-page',
  imports: [MatButton, MatIcon, RouterLink],
  templateUrl: './list-edit-page.html',
})
export class ListEditPage {
  private readonly catalog = inject(CatalogStore);
  private readonly drafts = inject(ListDraftService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly params = toSignal(this.route.queryParams, { requireSync: true });

  /** The list's id: none on /lists/new, which makes the new list's draft and moves to its editor. */
  protected readonly listId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('listId') ?? undefined)),
    { requireSync: true },
  );

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

  constructor() {
    if (this.listId() === undefined) void this.startNewList();
  }

  /**
   * /lists/new (P5): a new list's draft, then its editor's URL in place of this one, keeping what Search asked to add
   * (New list…, flow F1). Nothing is saved to the lists table until Save.
   */
  private async startNewList(): Promise<void> {
    const draft = await this.drafts.startNew();
    if (this.destroyRef.destroyed) return;
    await this.router.navigate(['/lists', draft.listId, 'edit'], {
      queryParamsHandling: 'preserve',
      replaceUrl: true,
    });
  }
}

/** How often a period bills, in words: monthly, every 3 months, every 30 days. */
function periodText(interval: Interval, count: number): string {
  if (count === 1) {
    return { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' }[interval];
  }
  return `every ${count} ${interval}s`;
}

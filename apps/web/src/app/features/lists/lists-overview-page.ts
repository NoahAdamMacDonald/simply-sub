import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { typeCounts, type ListMetrics } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { ListDraftService } from '../../core/lists/list-draft-service';
import { MetricsService } from '../../core/metrics/metrics-service';
import type { DeletedList } from '../../core/storage/drafts-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import { BudgetTotals } from '../../shared/budget-totals/budget-totals';
import { BudgetWarnings } from '../../shared/budget-warnings/budget-warnings';
import { ConfirmService } from '../../shared/confirm/confirm-service';
import { FeatureSummary } from '../../shared/feature-summary/feature-summary';
import { PageHeader } from '../../shared/page-header/page-header';
import { RankCounts } from '../../shared/rank/rank-counts';
import { TypeCounts } from '../../shared/type-counts/type-counts';
import { EmptyState } from '../../shared/empty-state/empty-state';
import { openSnack, undoMillis } from '../../shared/snack/snack';

/** One list's card (P3). */
interface ListCard {
  id: string;
  name: string;
  /** How many subscriptions it has, priced or not, and that in words: "12 subscriptions", "No subscriptions yet". */
  count: number;
  countText: string;
  /** This month's and this year's totals against the budgets (M7.2), and its rank counts. */
  metrics?: ListMetrics;
}

/** Where focus goes once the cards have caught up: the card after a deleted one, or one put back. */
interface PendingFocus {
  ready(cards: readonly ListCard[]): boolean;
  target(): HTMLElement | null | undefined;
}

/** How long Undo stays after a list is deleted (P3). */

/**
 * The Lists overview (PROJECT-PLAN P3): a card for each list, in the order they were made, with this month's and this
 * year's bars against the budgets, or the amounts alone without them (M7.2), how many subscriptions it has, its rank
 * counts (§3.2), View and 🗑, which asks first and offers Undo; then New Subscription List, and the feature summary of
 * every list (§3.2). Above them every list's budget warnings and, beside them, every list's bars together, as Home's
 * (M10.23). Core counts and sums (listMetrics); MetricsService prices.
 */
@Component({
  selector: 'ss-lists-overview-page',
  imports: [
    EmptyState,
    BudgetTotals,
    BudgetWarnings,
    FeatureSummary,
    MatButton,
    MatIcon,
    MatIconButton,
    PageHeader,
    RankCounts,
    RouterLink,
    TypeCounts,
  ],
  templateUrl: './lists-overview-page.html',
  styleUrl: './lists-overview-page.scss',
})
export class ListsOverviewPage {
  private readonly lists = inject(ListsRepository);
  private readonly metrics = inject(MetricsService);
  private readonly catalog = inject(CatalogStore);
  private readonly drafts = inject(ListDraftService);
  private readonly confirmer = inject(ConfirmService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly pendingFocus = signal<PendingFocus | undefined>(undefined);

  protected readonly state = computed<'loading' | 'error' | 'ready'>(() => {
    const statuses = [this.lists.status(), this.metrics.status()];
    if (statuses.includes('error')) return 'error';
    return statuses.every((status) => status === 'ready') ? 'ready' : 'loading';
  });

  protected readonly cards = computed<ListCard[]>(() =>
    this.lists.records().map((list) => {
      const items = this.metrics.list(list.id);
      const count = items.resolved.length + items.unresolved.length;
      const metrics = this.metrics.metrics(list.id);
      return {
        id: list.id,
        name: list.name,
        count,
        countText: count === 0 ? 'No subscriptions yet' : subscriptions(count),
        ...(metrics && { metrics }),
      };
    }),
  );

  /** Every list's resolved items together. */
  private readonly allItems = computed(() => {
    const ids = new Set(this.lists.records().map((list) => list.id));
    return [...this.metrics.byList()]
      .filter(([listId]) => ids.has(listId))
      .flatMap(([, list]) => list.resolved);
  });
  /** How many of each type every list has together: "Streaming video: 3". */
  protected readonly types = computed(() =>
    typeCounts(this.allItems(), this.catalog.catalog()?.categories.service ?? []),
  );
  /** "VPN: 2 / 3" for every list's items together (§3.2). */
  protected readonly features = computed(() => this.metrics.global()?.featureSummary ?? []);
  /** Every list's totals and warnings together, as Home has them (M10.23). */
  protected readonly global = this.metrics.global;
  /** Some list has a subscription: the bars have something to show. */
  protected readonly anyItems = computed(() => this.cards().some((card) => card.count > 0));
  /** Prices still on their way: the catalog file an item needs hasn't loaded, so the warnings wait, as Home's do. */
  protected readonly pricing = computed(() =>
    [...this.metrics.resolutions().values()].some(
      (result) => !result.ok && result.unresolved.reason === 'pending',
    ),
  );

  constructor() {
    // Focus moves once the cards show the change it waited for.
    effect(() => {
      const pending = this.pendingFocus();
      if (!pending || !pending.ready(this.cards())) return;
      this.pendingFocus.set(undefined);
      afterNextRender(() => pending.target()?.focus(), { injector: this.injector });
    });
  }

  /**
   * 🗑: after asking, deletes the list and its subscriptions together, says so with Undo for 10 s, and moves focus to
   * the next card's 🗑 (else the previous one's, else New Subscription List).
   */
  protected async remove(card: ListCard): Promise<void> {
    const confirmed = await this.confirmer.confirm({
      title: `Delete “${card.name}”?`,
      message:
        card.count === 0
          ? 'It has no subscriptions.'
          : `Its ${subscriptions(card.count)} will be removed.`,
      confirmText: 'Delete list',
      danger: true,
    });
    if (!confirmed) return;
    const cards = this.cards();
    const index = cards.findIndex((candidate) => candidate.id === card.id);
    const next = cards[index + 1] ?? cards[index - 1];
    const deleted = await this.drafts.deleteList(card.id);
    this.pendingFocus.set({
      ready: (shown) => !shown.some((candidate) => candidate.id === card.id),
      target: () => (next ? this.removeButton(next.id) : this.newListLink()),
    });
    openSnack(this.snackBar, `Deleted ${card.name}`, 'Undo', { duration: undoMillis })
      .onAction()
      .subscribe(() => void this.restore(deleted));
  }

  /** Undo: the list and its subscriptions come back, and focus goes to its 🗑. */
  private async restore(deleted: DeletedList): Promise<void> {
    await this.drafts.restoreList(deleted);
    this.pendingFocus.set({
      ready: (shown) => shown.some((candidate) => candidate.id === deleted.listId),
      target: () => this.removeButton(deleted.listId),
    });
  }

  private removeButton(listId: string): HTMLElement | null {
    // List ids are UUIDs, which need no escaping.
    return this.host.nativeElement.querySelector(`[data-list="${listId}"] .remove`);
  }

  private newListLink(): HTMLElement | null {
    return this.host.nativeElement.querySelector('.new-list');
  }
}

/** "1 subscription", "12 subscriptions". */
function subscriptions(count: number): string {
  return count === 1 ? '1 subscription' : `${count} subscriptions`;
}

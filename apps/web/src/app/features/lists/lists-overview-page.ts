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
import { featureSummary, rankCounts, type RankCounts as Counts } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { ClockService } from '../../core/clock/clock-service';
import { ListDraftService } from '../../core/lists/list-draft-service';
import { MetricsService } from '../../core/metrics/metrics-service';
import { SettingsStore } from '../../core/settings/settings-store';
import type { DeletedList } from '../../core/storage/drafts-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import { ConfirmService } from '../../shared/confirm/confirm-service';
import { FeatureSummary } from '../../shared/feature-summary/feature-summary';
import { PageHeader } from '../../shared/page-header/page-header';
import { RankCounts } from '../../shared/rank/rank-counts';
import { averageText, type ShownAndSpoken } from './average-text';

/** One list's card (P3). */
interface ListCard {
  id: string;
  name: string;
  /** How many subscriptions it has, priced or not, and that in words: "12 subscriptions", "No subscriptions yet". */
  count: number;
  countText: string;
  /** "≈ $26.84 / mo average": what it costs until M7.2's bars say this month's and this year's. None when empty. */
  average?: ShownAndSpoken;
  ranks: Counts;
}

/** Where focus goes once the cards have caught up: the card after a deleted one, or one put back. */
interface PendingFocus {
  ready(cards: readonly ListCard[]): boolean;
  target(): HTMLElement | null | undefined;
}

/** How long Undo stays after a list is deleted (P3). */
const undoMillis = 10_000;

/**
 * The Lists overview (PROJECT-PLAN P3): a card for each list, in the order they were made, with what it costs a month
 * on average and how many subscriptions it has (M7.2 brings this month's and this year's bars), its rank counts
 * (§3.2), View and 🗑, which asks first and offers Undo; then New Subscription List, and the feature summary of every
 * list (§3.2). Core counts and sums; MetricsService prices.
 */
@Component({
  selector: 'ss-lists-overview-page',
  imports: [FeatureSummary, MatButton, MatIcon, MatIconButton, PageHeader, RankCounts, RouterLink],
  templateUrl: './lists-overview-page.html',
  styleUrl: './lists-overview-page.scss',
})
export class ListsOverviewPage {
  private readonly lists = inject(ListsRepository);
  private readonly metrics = inject(MetricsService);
  private readonly catalog = inject(CatalogStore);
  private readonly settings = inject(SettingsStore);
  private readonly today = inject(ClockService).today;
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

  protected readonly cards = computed<ListCard[]>(() => {
    const saved = this.settings.saved();
    return this.lists.records().map((list) => {
      const items = this.metrics.list(list.id);
      const count = items.resolved.length + items.unresolved.length;
      return {
        id: list.id,
        name: list.name,
        count,
        countText: count === 0 ? 'No subscriptions yet' : subscriptions(count),
        ...(saved && count > 0 && { average: averageText(items, saved) }),
        ranks: rankCounts(items.resolved),
      };
    });
  });

  /** "VPN: 2 / 3" for every list's items together (§3.2). */
  protected readonly features = computed(() => {
    const ids = new Set(this.lists.records().map((list) => list.id));
    const items = [...this.metrics.byList()]
      .filter(([listId]) => ids.has(listId))
      .flatMap(([, list]) => list.resolved);
    return featureSummary(items, this.catalog.catalog()?.features ?? [], this.today());
  });

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
    this.snackBar
      .open(`Deleted ${card.name}`, 'Undo', { duration: undoMillis })
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

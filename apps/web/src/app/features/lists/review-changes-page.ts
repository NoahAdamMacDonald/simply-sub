import { Component, Injector, afterNextRender, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  cardTitle,
  dependentChanges,
  draftChanged,
  draftItems,
  planTitle,
  type AppliedChange,
  type ListDraft,
  type ListItem,
  type ListMetrics,
  type ResolvedItem,
} from '@simply-sub/core';
import { map } from 'rxjs';
import { ListDraftService } from '../../core/lists/list-draft-service';
import { MetricsService } from '../../core/metrics/metrics-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { CardsRepository } from '../../core/storage/cards-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import { dateText, dayText } from '../../shared/date-text';
import { EmptyState } from '../../shared/empty-state/empty-state';
import { PageHeader } from '../../shared/page-header/page-header';
import { amountText, intervalSpoken } from '../../shared/price-tag/price-text';

/** One line of a change: an item that goes, comes, or changes, with what happens to it. */
interface ChangeLine {
  kind: 'goes' | 'comes' | 'alters';
  name: string;
  /** What one charge of it costs, before tax: "$22.00 a month". */
  price?: string;
  what: string;
}

/**
 * Review changes (PROJECT-PLAN P14, M8.6): the suggestions applied to a list's draft on Optimizations, each with what
 * it changes, like a diff: what goes (−), what comes (+) and what changes (~), and what it saves. Undo takes one back,
 * with any later one that builds on it; Save changes saves the list; Open in the editor goes on editing; the back
 * button returns to Optimizations, where more can be applied.
 */
@Component({
  selector: 'ss-review-changes-page',
  imports: [EmptyState, MatButton, MatIcon, PageHeader, RouterLink],
  templateUrl: './review-changes-page.html',
  styleUrl: './review-changes-page.scss',
})
export class ReviewChangesPage {
  private readonly drafts = inject(ListDraftService);
  private readonly lists = inject(ListsRepository);
  private readonly metrics = inject(MetricsService);
  private readonly cards = inject(CardsRepository);
  private readonly settings = inject(SettingsStore);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  protected readonly listId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('listId') ?? '')),
    { initialValue: '' },
  );
  private readonly draft = computed(() => this.drafts.byList().get(this.listId()));
  protected readonly listName = computed(
    () => this.lists.byId().get(this.listId())?.name ?? this.draft()?.name ?? 'List',
  );
  protected readonly saving = signal(false);

  protected readonly state = computed<'loading' | 'none' | 'ready'>(() => {
    const statuses = [this.drafts.status(), this.lists.status(), this.metrics.status()];
    if (!statuses.every((status) => status === 'ready')) return 'loading';
    return this.draft() !== undefined && this.drafts.hasChanges(this.listId()) ? 'ready' : 'none';
  });

  private readonly country = computed(() => this.settings.saved()?.country);

  /** Each applied change, in the order applied, with its lines. */
  protected readonly changes = computed(() => {
    const draft = this.draft();
    if (!draft) return [];
    return (draft.applied ?? []).map((change, index) => ({
      index,
      title: change.title,
      savings: `Saves ${amountText(change.savings, change.currency, this.country())} over the next 12 months`,
      lines: this.linesOf(change, draft),
    }));
  });

  /** How many of the draft's changes came from the editor, not from a suggestion applied here. */
  protected readonly others = computed(() => {
    const draft = this.draft();
    if (!draft) return 0;
    const covered = new Set(
      (draft.applied ?? []).flatMap((change) => [
        ...change.before.map((item) => item.id),
        ...change.added,
      ]),
    );
    const renamed = draft.name !== draft.startName ? 1 : 0;
    return (
      renamed +
      draft.items.filter(({ item, saved, removed }) => {
        if (covered.has(item.id)) return false;
        if (saved === undefined) return removed === undefined;
        return removed !== undefined || JSON.stringify(item) !== JSON.stringify(saved);
      }).length
    );
  });

  /** This year and the next 12 months, as saved and with the changes, sales tax included (§3.1). */
  protected readonly totals = computed(() => {
    const draft = this.draft();
    const saved = this.settings.saved();
    if (!draft || !saved) return [];
    const before = this.metrics.metrics(this.listId());
    const results = this.metrics.resolve(draftItems(draft));
    const after = this.metrics.metricsOf({
      resolved: results.flatMap((result) => (result.ok ? [result.resolved] : [])),
      unresolved: results.flatMap((result) => (result.ok ? [] : [result.unresolved])),
    });
    if (!before || !after) return [];
    const text = (metrics: ListMetrics, key: 'thisYear' | 'next12') =>
      `${metrics.converted[key] ? '≈ ' : ''}${amountText(metrics[key], saved.currency, saved.country)}`;
    return [
      { label: 'This year', before: text(before, 'thisYear'), after: text(after, 'thisYear') },
      { label: 'Next 12 months', before: text(before, 'next12'), after: text(after, 'next12') },
    ];
  });

  /** Undoes a change, with the later ones that build on it, and says so. */
  protected async undo(index: number): Promise<void> {
    const draft = this.draft();
    if (!draft?.applied) return;
    const listId = this.listId();
    const count = dependentChanges(draft.applied, index).length;
    const after = await this.drafts.undoApplied(listId, index);
    // Nothing left to save: the draft goes, as Cancel would.
    if (!draftChanged(after)) await this.drafts.cancel(listId);
    this.snackBar.open(
      count === 1
        ? 'Undone'
        : `Undone, with ${count === 2 ? 'the change' : `the ${count - 1} changes`} that built on it`,
      undefined,
      { duration: 5000 },
    );
    afterNextRender(
      () => {
        const next =
          document.getElementById(`change-${index}`) ??
          document.getElementById(`change-${index - 1}`) ??
          document.querySelector<HTMLElement>('ss-page-header h1');
        next?.focus();
      },
      { injector: this.injector },
    );
  }

  /** Saves the list with every change, and opens it. */
  protected async save(): Promise<void> {
    this.saving.set(true);
    try {
      const listId = this.listId();
      const name = this.listName();
      await this.drafts.save(listId);
      await this.router.navigate(['/lists', listId]);
      this.snackBar.open(`Saved ${name}`, undefined, { duration: 4000 });
    } finally {
      this.saving.set(false);
    }
  }

  private linesOf(change: AppliedChange, draft: ListDraft): ChangeLine[] {
    const byId = new Map(draft.items.map((entry) => [entry.item.id, entry]));
    const lines: ChangeLine[] = [];
    for (const before of change.before) {
      const entry = byId.get(before.id);
      if (!entry) continue;
      const was = this.resolved(before);
      if (entry.removed) {
        lines.push({ kind: 'goes', ...this.named(before, was), what: 'Taken out of the list' });
        continue;
      }
      lines.push(this.changed(before, entry.item, was, this.resolved(entry.item)));
    }
    for (const id of change.added) {
      const item = byId.get(id)?.item;
      if (!item) continue;
      const start =
        item.billing.mode === 'recurring'
          ? (item.billing.startDate ?? item.billing.anchorDate)
          : undefined;
      lines.push({
        kind: 'comes',
        ...this.named(item, this.resolved(item)),
        what: start === undefined ? 'Added to the list' : `From ${dateText(start)}`,
      });
    }
    return lines;
  }

  /** What one of the change's items becomes. */
  private changed(
    before: ListItem,
    after: ListItem,
    was: ResolvedItem | undefined,
    now: ResolvedItem | undefined,
  ): ChangeLine {
    const endsNow = after.billing.mode === 'recurring' ? after.billing.endDate : undefined;
    const endedBefore = before.billing.mode === 'recurring' ? before.billing.endDate : undefined;
    if (endsNow !== undefined && endsNow !== endedBefore) {
      return {
        kind: 'goes',
        ...this.named(before, was),
        what: `Ends ${dateText(endsNow)}, when what's paid for runs out`,
      };
    }
    const parts: string[] = [];
    if (was && now && was.planId !== now.planId) {
      parts.push(`${was.planName} → ${now.planName}${this.from(after)}`);
    } else if (
      before.billing.interval !== after.billing.interval ||
      before.billing.intervalCount !== after.billing.intervalCount
    ) {
      parts.push(
        `Billed ${intervalSpoken(after.billing.interval, after.billing.intervalCount)} instead${this.from(after)}`,
      );
    }
    const had = new Set(
      (before.source.kind === 'catalog' ? (before.source.addOns ?? []) : []).map(
        (addOn) => `${addOn.id} ${addOn.since ?? ''}`,
      ),
    );
    for (const addOn of now?.addOns ?? []) {
      if (had.has(`${addOn.id} ${addOn.since ?? ''}`)) continue;
      parts.push(
        `Adds ${addOn.name.toLowerCase()}${addOn.since ? ` from ${dayText(addOn.since)}` : ''}`,
      );
    }
    if (after.cardId !== before.cardId) {
      const card = after.cardId === undefined ? undefined : this.cards.byId().get(after.cardId);
      parts.push(card ? `Paid with ${cardTitle(card)}` : 'Paid with no card');
    }
    return {
      kind: 'alters',
      ...this.named(after, now ?? was),
      what: parts.length > 0 ? parts.join('; ') : 'Changed',
    };
  }

  /** " from Nov 12": when a plan or billing change starts, the item's next charge. */
  private from(item: ListItem): string {
    return item.billing.mode === 'recurring' ? ` from ${dateText(item.billing.anchorDate)}` : '';
  }

  /** Its name ("Mom's (Netflix Standard)") and the price of one charge, before tax. */
  private named(
    item: ListItem,
    resolved: ResolvedItem | undefined,
  ): Pick<ChangeLine, 'name' | 'price'> {
    if (!resolved) return { name: 'A subscription that can’t be priced' };
    const plan =
      item.source.kind === 'bundle' ? resolved.name : planTitle(resolved.name, resolved.planName);
    const price = resolved.override ?? resolved.price;
    return {
      name: item.nickname === undefined ? plan : `${item.nickname} (${plan})`,
      price: `${price.fx === undefined ? '' : '≈ '}${amountText(price.amount, price.currency, this.country())} ${intervalSpoken(price.interval, price.intervalCount)}`,
    };
  }

  private resolved(item: ListItem): ResolvedItem | undefined {
    const [result] = this.metrics.resolve([item]);
    return result?.ok ? result.resolved : undefined;
  }
}

import {
  Component,
  Injector,
  afterNextRender,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  draftItems,
  severities,
  severityText,
  suggestionEdits,
  type Suggestion,
} from '@simply-sub/core';
import { filter, firstValueFrom, map, race, timer } from 'rxjs';
import { ListDraftService } from '../../core/lists/list-draft-service';
import { MetricsService } from '../../core/metrics/metrics-service';
import { OptimizerService } from '../../core/optimizer/optimizer-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { DismissedSuggestionsRepository } from '../../core/storage/dismissed-suggestions-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import { EmptyState } from '../../shared/empty-state/empty-state';
import { PageHeader } from '../../shared/page-header/page-header';
import { amountText } from '../../shared/price-tag/price-text';
import { SuggestionCard } from './suggestion-card';
import { actionLine } from './suggestion-text';

/**
 * A list's optimizations (PROJECT-PLAN P14, M8.2): core's optimizer for the list, its cards in Free savings, Red,
 * Orange and Yellow, with Save up to, Show dismissed and the rules in a tooltip. Apply puts a card's changes on the
 * list's draft and stays (M8.4): the suggestions are for the list as the draft has it, so the next one counts the
 * changes before it, and while they're worked out again no card can be applied (M8.6), so none that clashes with what
 * was applied stays in reach. Undo takes back that change; Review changes lists each one with what it was and what it
 * becomes, to undo one or save them (M8.6). Dismiss hides a card until the list changes.
 */
@Component({
  selector: 'ss-optimizations-page',
  imports: [
    EmptyState,
    MatButton,
    MatCheckbox,
    MatIcon,
    MatIconButton,
    MatTooltip,
    PageHeader,
    RouterLink,
    SuggestionCard,
  ],
  templateUrl: './optimizations-page.html',
  styleUrl: './optimizations-page.scss',
})
export class OptimizationsPage {
  private readonly lists = inject(ListsRepository);
  private readonly metrics = inject(MetricsService);
  private readonly optimizer = inject(OptimizerService);
  private readonly dismissals = inject(DismissedSuggestionsRepository);
  private readonly drafts = inject(ListDraftService);
  private readonly settings = inject(SettingsStore);
  private readonly snackBar = inject(MatSnackBar);
  private readonly injector = inject(Injector);

  protected readonly listId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('listId') ?? '')),
    { initialValue: '' },
  );
  private readonly list = computed(() => this.lists.byId().get(this.listId()));
  /** The list's name, for its back button. */
  protected readonly listName = computed(() => this.list()?.name ?? 'List');

  protected readonly state = computed<'loading' | 'error' | 'missing' | 'ready'>(() => {
    const statuses = [this.lists.status(), this.metrics.status(), this.dismissals.status()];
    if (statuses.includes('error')) return 'error';
    if (!statuses.every((status) => status === 'ready')) return 'loading';
    return this.list() ? 'ready' : 'missing';
  });

  private readonly input = computed(() => this.optimizer.input(this.listId()));
  /** The optimizer's answer; it runs again whenever the list, the catalog, the rates, the settings or the ranks change. */
  protected readonly result = resource({
    params: () => this.input(),
    loader: ({ params }) => this.optimizer.run(params),
  });
  protected readonly found = computed(() =>
    this.result.hasValue() ? this.result.value() : undefined,
  );

  protected readonly showDismissed = signal(false);
  /** The card whose changes are being put on the draft. */
  protected readonly applying = signal<string | undefined>(undefined);
  private readonly found$ = toObservable(this.found);
  /** The list has changes in its draft that aren't saved, applied here or in the editor: the suggestions count them. */
  protected readonly unsaved = computed(() => {
    const draft = this.drafts.byList().get(this.listId());
    return draft !== undefined && this.drafts.hasChanges(this.listId());
  });
  /** How many suggestions are applied to the draft (M8.6). */
  protected readonly appliedCount = computed(
    () => this.drafts.byList().get(this.listId())?.applied?.length ?? 0,
  );
  /** The suggestions are being worked out again (after an Apply): no card can be applied till they're back (M8.6). */
  protected readonly updating = computed(() => this.result.isLoading());

  /** The sections in P14's order, each with its cards: dismissed ones only with Show dismissed. */
  protected readonly sections = computed(() => {
    const suggestions = this.found()?.suggestions ?? [];
    const dismissed = this.dismissals.fingerprints();
    return severities
      .map((severity) => ({
        severity,
        ...severityText[severity],
        cards: suggestions
          .filter(
            (suggestion) =>
              suggestion.severity === severity &&
              (this.showDismissed() || !dismissed.has(suggestion.fingerprint)),
          )
          .map((suggestion) => ({ suggestion, dismissed: dismissed.has(suggestion.fingerprint) })),
      }))
      .filter((section) => section.cards.length > 0);
  });
  protected readonly dismissedCount = computed(() => {
    const dismissed = this.dismissals.fingerprints();
    return (this.found()?.suggestions ?? []).filter((suggestion) =>
      dismissed.has(suggestion.fingerprint),
    ).length;
  });
  /** "Save up to $214.00 a year": the best plan's savings, while there's a card to show. */
  protected readonly saveUpTo = computed(() => {
    const found = this.found();
    const shown = this.sections().some((section) => section.cards.some((card) => !card.dismissed));
    if (!found || !shown || found.bestSavings <= 0) return undefined;
    const amount = amountText(found.bestSavings, found.currency, this.settings.saved()?.country);
    return { amount, estimated: found.bestEstimated };
  });
  /** Items that can't be priced, which the optimizer leaves out. */
  protected readonly unpriced = computed(() => this.metrics.list(this.listId()).unresolved.length);
  protected readonly empty = computed(() => this.metrics.list(this.listId()).resolved.length === 0);

  /**
   * Puts the card's changes on the list's draft (P5) and stays, so another can follow (M8.4): the suggestions come
   * again for the draft, and focus moves to the next card, or to Review and save when none is left. Undo puts the
   * draft back as it was, or drops it when this made it. Nothing is saved until the editor's Save.
   */
  protected async apply(suggestion: Suggestion): Promise<void> {
    const listId = this.listId();
    const next = this.neighbour(suggestion.fingerprint);
    this.applying.set(suggestion.fingerprint);
    try {
      const started = await this.drafts.start(listId);
      if (!started) return;
      const items = new Map(draftItems(started.draft).map((item) => [item.id, item]));
      const edits = suggestionEdits(suggestion, items);
      if (!edits) {
        this.snackBar.open(
          'The list’s unsaved changes took out a subscription this suggestion changes, so it wasn’t applied.',
          'OK',
        );
        return;
      }
      const currency = this.found()?.currency ?? this.settings.saved()?.currency ?? 'CAD';
      const title = suggestion.actions.map((action) => actionLine(action).title).join('; ');
      const applied = await this.drafts.applyEdits(listId, edits, {
        title,
        savings: Math.max(0, suggestion.savings),
        currency,
      });
      const index = (applied.applied?.length ?? 1) - 1;
      // The suggestions for the draft, without the one applied (or after 5 s, whatever they are).
      await firstValueFrom(
        race(
          this.found$.pipe(
            filter(
              (found) =>
                found !== undefined &&
                !found.suggestions.some((card) => card.fingerprint === suggestion.fingerprint),
            ),
          ),
          timer(5000),
        ),
      );
      this.focusAfterRender(next, true);
      const undo = this.snackBar.open(`Applied: ${title}`, 'Undo', { duration: 8000 });
      undo.onAction().subscribe(() => {
        // A draft this Apply started goes with it; one that was there keeps its other changes.
        void (started.resumed || index > 0
          ? this.drafts.undoApplied(listId, index)
          : this.drafts.cancel(listId));
      });
    } finally {
      this.applying.set(undefined);
    }
  }

  /** Hides the card until the list changes, with Undo, and moves focus to the card that takes its place. */
  protected async dismiss(suggestion: Suggestion): Promise<void> {
    const next = this.neighbour(suggestion.fingerprint);
    await this.dismissals.dismiss(suggestion.fingerprint, this.listId());
    this.focusAfterRender(next);
    const undo = this.snackBar.open('Dismissed until the list changes', 'Undo', { duration: 8000 });
    undo.onAction().subscribe(() => void this.restore(suggestion));
  }

  protected async restore(suggestion: Suggestion): Promise<void> {
    await this.dismissals.restore(suggestion.fingerprint);
  }

  /** The heading to focus once a card goes: the next card's, else the one before, else Show dismissed. */
  private neighbour(fingerprint: string): string {
    if (this.showDismissed()) return `suggestion-${fingerprint}-title`;
    const shown = this.sections().flatMap((section) => section.cards);
    const index = shown.findIndex((card) => card.suggestion.fingerprint === fingerprint);
    const other = shown[index + 1] ?? shown[index - 1];
    return other ? `suggestion-${other.suggestion.fingerprint}-title` : 'show-dismissed-input';
  }

  /**
   * Focuses the element with `id` once the page has drawn. After Apply, whose changes can change the cards, one that's
   * gone gives way to the first card's heading, else Review and save.
   */
  private focusAfterRender(id: string, applied = false): void {
    const focus = () => {
      const fallback = () =>
        document.querySelector<HTMLElement>('ss-suggestion-card .title') ??
        document.getElementById('review');
      (document.getElementById(id) ?? (applied ? fallback() : null))?.focus();
    };
    // After Apply the page has drawn the new cards already, waiting for them: there may be no render to come.
    if (applied) focus();
    else afterNextRender(focus, { injector: this.injector });
  }
}

import {
  Component,
  Injector,
  afterNextRender,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  draftItems,
  severities,
  severityText,
  suggestionEdits,
  type Suggestion,
} from '@simply-sub/core';
import { map } from 'rxjs';
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

/**
 * A list's optimizations (PROJECT-PLAN P14, M8.2): core's optimizer for the list, its cards in Free savings, Red,
 * Orange and Yellow, with Save up to, Show dismissed and the rules in a tooltip. Apply puts a card's changes on the
 * list's draft and opens the editor, so nothing is saved until Save; Dismiss hides a card until the list changes.
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
  private readonly router = inject(Router);
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

  /** Puts the card's changes on the list's draft and opens the editor on it (P5): nothing is saved until Save. */
  protected async apply(suggestion: Suggestion): Promise<void> {
    const listId = this.listId();
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
      await this.drafts.applyEdits(listId, edits);
      await this.router.navigate(['/lists', listId, 'edit']);
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

  private focusAfterRender(id: string): void {
    afterNextRender(() => document.getElementById(id)?.focus(), { injector: this.injector });
  }
}

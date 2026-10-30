import { Injector, Service, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { assignCards, cardTitle, type CardChange, type ResolvedItem } from '@simply-sub/core';
import { firstValueFrom } from 'rxjs';
import { ClockService } from '../../core/clock/clock-service';
import { FxStore } from '../../core/fx/fx-store';
import { ListDraftService } from '../../core/lists/list-draft-service';
import { MetricsService } from '../../core/metrics/metrics-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { CardsRepository } from '../../core/storage/cards-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import type { ShownAndSpoken } from '../../shared/charge-text';
import { amountText } from '../../shared/price-tag/price-text';
import type { AssignCardsDialog, AssignPreview } from './assign-cards-dialog';
import { openSnack, snackMillis, undoMillis } from '../../shared/snack/snack';

/**
 * Assign best cards (PROJECT-PLAN P11, M9.4): core's assignCards over every list's saved items, a preview per list in a
 * dialog (Material's dialog and it load on first use), then Apply writes each item's card in one transaction, with
 * Undo. A list with unsaved edits is skipped, with a note, and its items keep their cards (their charges still count
 * against the cards' limits).
 */
@Service()
export class CardAssigner {
  private readonly injector = inject(Injector);
  private readonly metrics = inject(MetricsService);
  private readonly cards = inject(CardsRepository);
  private readonly lists = inject(ListsRepository);
  private readonly drafts = inject(ListDraftService);
  private readonly settings = inject(SettingsStore);
  private readonly fx = inject(FxStore);
  private readonly clock = inject(ClockService);
  private readonly snackBar = inject(MatSnackBar);

  /** Works out the assignment, shows it, and applies it when the user says so. */
  async assign(): Promise<void> {
    const saved = this.settings.saved();
    if (!saved) return;
    const fx = this.fx.rates();
    const context = {
      today: this.clock.today(),
      currency: saved.currency,
      place: saved,
      ...(fx && { fx }),
    };
    const resolved: ResolvedItem[] = [];
    for (const result of this.metrics.resolutions().values()) {
      if (result.ok) resolved.push(result.resolved);
    }
    const drafted = new Set(this.drafts.byList().keys());
    const assignment = assignCards({
      items: resolved,
      cards: this.cards.records(),
      fixed: new Set(
        resolved.filter((item) => drafted.has(item.listId)).map((item) => item.item.id),
      ),
      context,
    });
    const money = (amount: number, estimated: boolean): ShownAndSpoken => {
      const text = amountText(amount, saved.currency, saved.country);
      return {
        shown: `${estimated ? '≈ ' : ''}${text}`,
        spoken: `${estimated ? 'about ' : ''}${text}`,
      };
    };
    const titles = new Map(this.cards.records().map((card) => [card.id, cardTitle(card)]));
    const preview: AssignPreview = {
      lists: this.lists
        .records()
        .map((list) => ({
          listId: list.id,
          name: list.name,
          changes: assignment.changes
            .filter((change) => change.listId === list.id)
            .map((change) => ({
              itemId: change.itemId,
              title: change.title,
              from: change.from === undefined ? 'No card' : (titles.get(change.from) ?? ''),
              to: titles.get(change.to) ?? '',
              savings: money(change.savings, change.estimated),
            })),
        }))
        .filter((list) => list.changes.length > 0),
      skipped: this.lists
        .records()
        .filter((list) => drafted.has(list.id))
        .map((list) => ({ listId: list.id, name: list.name })),
      ...(assignment.changes.length > 0 && {
        total: money(assignment.savings, assignment.estimated),
      }),
    };

    const [{ MatDialog }, { AssignCardsDialog }] = await Promise.all([
      import('@angular/material/dialog'),
      import('./assign-cards-dialog'),
    ]);
    const dialog = this.injector
      .get(MatDialog)
      .open<AssignCardsDialog, AssignPreview, boolean>(AssignCardsDialog, {
        data: preview,
        autoFocus: 'first-heading',
        width: 'min(560px, calc(100vw - 32px))',
      });
    if ((await firstValueFrom(dialog.afterClosed())) === true) {
      await this.apply(assignment.changes);
    }
  }

  private async apply(changes: readonly CardChange[]): Promise<void> {
    const before = await this.cards.assign(
      changes.map((change) => ({ itemId: change.itemId, cardId: change.to })),
    );
    const count = before.length;
    const undo = openSnack(
      this.snackBar,
      count === 1
        ? 'Assigned a card to 1 subscription'
        : `Assigned cards to ${count} subscriptions`,
      'Undo',
      { duration: undoMillis },
    );
    undo.onAction().subscribe(() => {
      void this.cards.assign(before).then(() =>
        openSnack(this.snackBar, 'Cards put back as they were', undefined, {
          duration: snackMillis,
        }),
      );
    });
  }
}

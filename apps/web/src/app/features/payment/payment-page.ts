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
import {
  cardNetworkNames,
  cardSummary,
  cardTitle,
  type PaymentCard,
  type ResolvedItem,
} from '@simply-sub/core';
import { ClockService } from '../../core/clock/clock-service';
import { FxStore } from '../../core/fx/fx-store';
import { MetricsService } from '../../core/metrics/metrics-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { CardsRepository } from '../../core/storage/cards-repository';
import { ItemsRepository } from '../../core/storage/items-repository';
import { BudgetBar } from '../../shared/budget-bar/budget-bar';
import type { ShownAndSpoken } from '../../shared/charge-text';
import { ConfirmService } from '../../shared/confirm/confirm-service';
import { EmptyState } from '../../shared/empty-state/empty-state';
import { monthText } from '../../shared/date-text';
import { PageHeader } from '../../shared/page-header/page-header';
import { amountText } from '../../shared/price-tag/price-text';
import { CardAssigner } from './card-assigner';
import { CardEditor } from './card-editor';
import { openSnack, snackMillis } from '../../shared/snack/snack';

/** A card as its tile shows it (P11). */
interface CardTile {
  card: PaymentCard;
  /** Its nickname, else its name; and its name under it when it has a nickname. */
  title: string;
  name?: string;
  network: string;
  type: string;
  /** "1.5% cash back · FX fee 2.5%". */
  rates: string;
  /** This month's charges paid with it against its monthly limit, in its currency; none without a limit. */
  limit?: { value: number; max: number; currency: string; text: ShownAndSpoken };
  /** The subscriptions paid with it, each with what it costs a month with tax. */
  subscriptions: { itemId: string; title: string; amount?: ShownAndSpoken }[];
  /** What they cost a month together, with tax, and after the card's cash back and FX fees. */
  total?: ShownAndSpoken;
  net?: ShownAndSpoken;
  /** The first of the next 12 months its charges go over its limit (M9.4), and how many more do. */
  overLimit?: ShownAndSpoken;
  /** Paid with it, but can't be priced: no longer in the catalog, or no price for their period. */
  unpriced: number;
}

/** Where focus goes once the tiles have caught up: a new card's ✎, or the tile after a deleted one. */
interface PendingFocus {
  ready(tiles: readonly CardTile[]): boolean;
  target(): HTMLElement | null | undefined;
}

/**
 * Payment cards (PROJECT-PLAN P11, BLUEPRINT §9): a tile for each card with its network, credit or debit, cash back
 * and FX fee, this month's charges against its limit, and the subscriptions paid with it with what they cost a month.
 * Add card and ✎ open the card dialog (CardEditor); 🗑 asks first, and the subscriptions it paid for have no card.
 */
@Component({
  selector: 'ss-payment-page',
  imports: [BudgetBar, EmptyState, MatButton, MatIcon, MatIconButton, PageHeader],
  templateUrl: './payment-page.html',
  styleUrl: './payment-page.scss',
})
export class PaymentPage {
  private readonly cards = inject(CardsRepository);
  private readonly items = inject(ItemsRepository);
  private readonly metrics = inject(MetricsService);
  private readonly settings = inject(SettingsStore);
  private readonly clock = inject(ClockService);
  private readonly fx = inject(FxStore);
  private readonly editor = inject(CardEditor);
  private readonly assigner = inject(CardAssigner);
  private readonly confirmer = inject(ConfirmService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly pendingFocus = signal<PendingFocus | undefined>(undefined);

  protected readonly state = computed<'loading' | 'error' | 'ready'>(() => {
    const statuses = [this.cards.status(), this.items.status()];
    if (statuses.includes('error')) return 'error';
    return statuses.every((status) => status === 'ready') ? 'ready' : 'loading';
  });

  /** Every saved item that's priced, in every list; and whether some are still waiting for their catalog file. */
  private readonly priced = computed(() => {
    const resolved: ResolvedItem[] = [];
    const unpriced: string[] = [];
    let pending = false;
    for (const resolution of this.metrics.resolutions().values()) {
      if (resolution.ok) resolved.push(resolution.resolved);
      else if (resolution.unresolved.reason === 'pending') pending = true;
      else if (resolution.unresolved.item.cardId) unpriced.push(resolution.unresolved.item.cardId);
    }
    return { resolved, unpriced, pending };
  });

  /** Whether the prices are still loading, so the tiles' subscriptions wait. */
  protected readonly pricesLoading = computed(
    () => this.priced().pending || this.metrics.status() !== 'ready',
  );

  protected readonly tiles = computed<CardTile[]>(() => {
    const saved = this.settings.saved();
    if (!saved) return [];
    const { resolved, unpriced } = this.priced();
    const fx = this.fx.rates();
    const context = {
      today: this.clock.today(),
      currency: saved.currency,
      place: saved,
      ...(fx && { fx }),
    };
    const money = (amount: number, currency: string, approx: boolean): ShownAndSpoken => {
      const text = amountText(amount, currency, saved.country);
      return { shown: `${approx ? '≈ ' : ''}${text}`, spoken: `${approx ? 'about ' : ''}${text}` };
    };
    return this.cards.records().map((card): CardTile => {
      const summary = cardSummary(card, resolved, context);
      const title = cardTitle(card);
      let limit: CardTile['limit'];
      if (card.monthlyLimit !== undefined) {
        const spent = money(summary.thisMonth, card.currency, summary.thisMonthApprox);
        const max = amountText(card.monthlyLimit, card.currency, saved.country);
        limit = {
          value: summary.thisMonth,
          max: card.monthlyLimit,
          currency: card.currency,
          text: { shown: `${spent.shown} of ${max}`, spoken: `${spent.spoken} of ${max}` },
        };
      }
      const counted = summary.subscriptions.length - summary.notCounted;
      const total = money(summary.monthly, saved.currency, summary.monthlyApprox);
      const net = money(summary.net, saved.currency, summary.monthlyApprox);
      const [over, ...moreOver] = summary.overLimit;
      let overLimit: ShownAndSpoken | undefined;
      if (over) {
        const posted = money(over.posted, card.currency, over.converted);
        const max = amountText(over.limit, card.currency, saved.country);
        const more =
          moreOver.length === 0
            ? ''
            : moreOver.length === 1
              ? ', and in 1 more month'
              : `, and in ${moreOver.length} more months`;
        const when = monthText(over.month);
        overLimit = {
          shown: `Over its limit in ${when}: ${posted.shown} of ${max}${more}`,
          spoken: `Warning: over its limit in ${when}: ${posted.spoken} of ${max}${more}`,
        };
      }
      return {
        card,
        title,
        ...(card.nickname !== undefined && { name: card.name }),
        network: cardNetworkNames[card.network],
        type: card.type === 'credit' ? 'Credit' : 'Debit',
        rates: `${percent(card.cashbackPercent)} cash back · FX fee ${percent(card.fxFeePercent)}`,
        ...(limit && { limit }),
        subscriptions: summary.subscriptions.map((subscription) => ({
          itemId: subscription.itemId,
          title: subscription.title,
          ...(subscription.monthly !== undefined && {
            amount: money(subscription.monthly, saved.currency, subscription.converted),
          }),
        })),
        ...(counted > 0 && {
          total: {
            shown: `${total.shown} / mo with tax`,
            spoken: `${total.spoken} a month with tax`,
          },
          net: {
            shown: `${net.shown} after cash back & FX fees`,
            spoken: `${net.spoken} after cash back and FX fees`,
          },
        }),
        ...(overLimit && { overLimit }),
        unpriced: unpriced.filter((cardId) => cardId === card.id).length,
      };
    });
  });

  /** "3 subscriptions have no card": saved items with none, or with one that's been deleted. */
  protected readonly unassigned = computed(() => {
    const cards = this.cards.byId();
    const count = this.items
      .records()
      .filter((item) => item.cardId === undefined || !cards.has(item.cardId)).length;
    if (count === 0) return undefined;
    return count === 1 ? '1 subscription has no card' : `${count} subscriptions have no card`;
  });

  constructor() {
    // Focus moves once the tiles show the change it waited for.
    effect(() => {
      const pending = this.pendingFocus();
      if (!pending || !pending.ready(this.tiles())) return;
      this.pendingFocus.set(undefined);
      afterNextRender(() => pending.target()?.focus(), { injector: this.injector });
    });
  }

  /** Add card: the dialog, then the new tile, with focus on its ✎. */
  protected async create(): Promise<void> {
    const result = await this.editor.open();
    if (!result) return;
    openSnack(this.snackBar, `Added ${result.title}`, undefined, { duration: snackMillis });
    this.pendingFocus.set({
      ready: (tiles) => tiles.some((tile) => tile.card.id === result.id),
      target: () => this.button(result.id, 'edit'),
    });
  }

  /** Assign best cards (P11, M9.4): the preview, and Apply with Undo. */
  protected assign(): Promise<void> {
    return this.assigner.assign();
  }

  /** ✎: the dialog for it. Focus goes back to ✎ as the dialog closes. */
  protected async edit(card: PaymentCard): Promise<void> {
    const result = await this.editor.open(card);
    if (result)
      openSnack(this.snackBar, `Saved ${result.title}`, undefined, { duration: snackMillis });
  }

  /**
   * 🗑: after asking, deletes the card, and the subscriptions it paid for have no card (P11). Focus moves to the next
   * tile's 🗑, else the previous one's, else Add card.
   */
  protected async remove(tile: CardTile): Promise<void> {
    const { card, title } = tile;
    const used = await this.cards.usage(card.id);
    const confirmed = await this.confirmer.confirm({
      title: `Delete ${title}?`,
      message:
        used === 0
          ? 'No subscription is paid with it.'
          : used === 1
            ? '1 subscription is paid with it, and will have no card.'
            : `${used} subscriptions are paid with it, and will have no card.`,
      confirmText: 'Delete card',
      danger: true,
    });
    if (!confirmed) return;
    const tiles = this.tiles();
    const index = tiles.findIndex((candidate) => candidate.card.id === card.id);
    const next = tiles[index + 1] ?? tiles[index - 1];
    await this.cards.removeWithItems(card.id);
    openSnack(this.snackBar, `Deleted ${title}`, undefined, { duration: snackMillis });
    this.pendingFocus.set({
      ready: (shown) => !shown.some((candidate) => candidate.card.id === card.id),
      target: () =>
        next
          ? this.button(next.card.id, 'remove')
          : this.host.nativeElement.querySelector<HTMLElement>('.add'),
    });
  }

  private button(cardId: string, kind: 'edit' | 'remove'): HTMLElement | null {
    // Record ids are UUIDs, which need no escaping.
    return this.host.nativeElement.querySelector(`[data-card="${cardId}"] .${kind}`);
  }
}

/** "1.5%", "2.5%", "0%". */
function percent(value: number): string {
  return `${value.toLocaleString('en', { maximumFractionDigits: 3 })}%`;
}

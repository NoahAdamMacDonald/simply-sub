import {
  CdkConnectedOverlay,
  CdkOverlayOrigin,
  type ConnectedPosition,
} from '@angular/cdk/overlay';
import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { costBreakdown, itemTitle, type DateRange } from '@simply-sub/core';
import { MetricsService } from '../../core/metrics/metrics-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { amountText } from '../price-tag/price-text';

let nextId = 0;

/** How long the pointer can be off the bar and the breakdown before a hovered one closes. */
const leaveMillis = 200;

/**
 * A budget bar's cost breakdown (PROJECT-PLAN M10.30): it wraps the bar (or a total), and shows what it adds up, its
 * period's charges by subscription, each with its price, sales tax, FX fee and a converted one's rate, then their sums.
 * Hovering the bar shows it, a click or tap keeps it open and another closes it; the receipt button beside the bar does
 * the same by keyboard, moving focus into it, and Escape closes it with focus back on the button. Worked out only while
 * it's open, from MetricsService's charges.
 */
@Component({
  selector: 'ss-cost-breakdown',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, MatIcon, MatIconButton],
  templateUrl: './cost-breakdown.html',
  styleUrl: './cost-breakdown.scss',
})
export class CostBreakdown {
  private readonly metrics = inject(MetricsService);
  private readonly settings = inject(SettingsStore);
  private readonly button = viewChild<string, ElementRef<HTMLElement>>('button', {
    read: ElementRef,
  });
  private readonly wrap = viewChild<ElementRef<HTMLElement>>('wrap');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  /** The bar's period. */
  readonly range = input.required<DateRange>();
  /** "this month", "2026": what the bar is of, for the button's name ("Breakdown of this month") and its heading. */
  readonly period = input.required<string>();
  /** The lists it adds up; left out, every list. */
  readonly listIds = input<ReadonlySet<string>>();
  /** A card's bar (P11): only the charges paid with it. */
  readonly cardId = input<string>();

  protected readonly id = `ss-cost-breakdown-${nextId++}`;
  /** "This month": the period, for the heading. */
  protected readonly heading = computed(() => {
    const period = this.period();
    return period.charAt(0).toUpperCase() + period.slice(1);
  });
  protected readonly open = signal(false);
  /** Kept open by a click, a tap or the button, not just hovered. */
  private readonly pinned = signal(false);
  private leaving?: ReturnType<typeof setTimeout>;

  /**
   * Under the bar, else above it, lined up with its start and moved along just enough to stay 8 px inside the window:
   * a bar by its right edge (List view's side column) or in a card on a phone, where the breakdown is nearly as wide as
   * the window. Worked out as it opens.
   */
  protected readonly positions = signal<ConnectedPosition[]>([]);

  /** The breakdown, worked out while it's open. */
  protected readonly breakdown = computed(() => {
    if (!this.open()) return undefined;
    const saved = this.settings.saved();
    if (!saved) return undefined;
    const resolutions = this.metrics.resolutions();
    const cardId = this.cardId();
    const charges = this.metrics.charges(this.range(), this.listIds()).filter((charge) => {
      if (cardId === undefined) return true;
      const result = resolutions.get(charge.itemId);
      return result?.ok === true && result.resolved.item.cardId === cardId;
    });
    const found = costBreakdown(charges, saved.currency);
    const money = (amount: number, approx = false) =>
      `${approx ? '≈ ' : ''}${amountText(amount, saved.currency, saved.country)}`;
    return {
      total: money(found.total, found.converted),
      lines: found.lines.map((line) => {
        const result = resolutions.get(line.itemId);
        const parts = [
          money(line.price, line.converted),
          ...(line.tax > 0 ? [`${money(line.tax)} tax`] : []),
          ...(line.fxFee > 0 ? [`${money(line.fxFee, line.converted)} FX fee`] : []),
        ].join(' + ');
        const charged = line.charged
          ? ` · ${amountText(line.charged.amount, line.charged.currency, saved.country)} at ${line.charged.rate.toFixed(4)}`
          : '';
        const count = line.count === 1 ? '' : `${line.count} charges: `;
        return {
          itemId: line.itemId,
          name: result?.ok ? itemTitle(result.resolved) : 'A subscription',
          total: money(line.total, line.converted),
          parts: `${count}${parts}${charged}`,
        };
      }),
      sums: [
        `Prices ${money(found.price, found.converted)}`,
        `Tax ${money(found.tax)}`,
        `FX fees ${money(found.fxFee, found.converted)}`,
      ].join(' · '),
    };
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.leaving));
  }

  /** The pointer on the bar or the breakdown: show it. */
  protected hover(): void {
    clearTimeout(this.leaving);
    this.show();
  }

  /** Opens it where it fits (positions). */
  private show(): void {
    if (this.open()) return;
    const origin = this.wrap()?.nativeElement.getBoundingClientRect();
    const margin = 8;
    // The breakdown's width: min(360px, 100vw − 32px), as its styles have it.
    const width = Math.min(360, innerWidth - 32);
    const left = origin?.left ?? margin;
    const offsetX = Math.min(Math.max(left, margin), innerWidth - margin - width) - left;
    this.positions.set([
      {
        originX: 'start',
        originY: 'bottom',
        overlayX: 'start',
        overlayY: 'top',
        offsetX,
        offsetY: 8,
      },
      {
        originX: 'start',
        originY: 'top',
        overlayX: 'start',
        overlayY: 'bottom',
        offsetX,
        offsetY: -8,
      },
    ]);
    this.open.set(true);
  }

  /** The pointer off them: a hovered breakdown closes, unless it comes back. */
  protected leave(): void {
    if (this.pinned()) return;
    clearTimeout(this.leaving);
    this.leaving = setTimeout(() => this.open.set(false), leaveMillis);
  }

  /** A click or tap on the bar: keep it open, or close a kept one. */
  protected toggle(): void {
    clearTimeout(this.leaving);
    if (this.pinned()) {
      this.close(false);
    } else {
      this.pinned.set(true);
      this.show();
    }
  }

  /** The button: open it and move focus into it, or close it. */
  protected fromButton(): void {
    if (this.open() && this.pinned()) {
      this.close(true);
      return;
    }
    this.pinned.set(true);
    this.show();
    setTimeout(() => this.panel()?.nativeElement.focus());
  }

  /** Closes it; with `refocus`, focus goes back on the button. */
  protected close(refocus: boolean): void {
    clearTimeout(this.leaving);
    this.pinned.set(false);
    this.open.set(false);
    if (refocus) this.button()?.nativeElement.focus();
  }

  /** A press outside it: a kept one closes, unless the press is on its bar or button, which toggle it themselves. */
  protected outside(event: MouseEvent): void {
    const wrap = this.wrap()?.nativeElement;
    if (wrap && event.target instanceof Node && wrap.contains(event.target)) return;
    this.close(false);
  }
}

import { Component, computed, input, linkedSignal, output } from '@angular/core';
import { MatSlider, MatSliderRangeThumb } from '@angular/material/slider';
import type { PriceRange } from '@simply-sub/core';
import { wholeAmountText } from '../price-tag/price-text';

let nextId = 0;

/** A price range as the slider sets it: no minimum at 0, and no maximum at the top (Unlimited). */
export interface PriceLimits {
  min?: number;
  max?: number;
}

/**
 * "Price per month", a slider with a thumb for the lowest and one for the highest (Search's filter panel, P8, and List
 * view's Sort menu, P4). The top is Unlimited. It shows the limits it's given and emits new ones once a thumb is let
 * go, so a run of moves is one change (Search makes it one history entry); while one moves, the range above it follows.
 */
@Component({
  selector: 'ss-price-range',
  imports: [MatSlider, MatSliderRangeThumb],
  templateUrl: './price-range-filter.html',
  styleUrl: './price-range-filter.scss',
})
export class PriceRangeFilter {
  /** From 0 to the top, by the step (core's priceRange). */
  readonly range = input.required<PriceRange>();
  readonly min = input<number>();
  readonly max = input<number>();
  /** The user's currency and country, which write the amounts. */
  readonly currency = input.required<string>();
  readonly country = input<string>();
  /** Once a thumb is let go: both limits, a limit at its end of the slider left out. */
  readonly limitsChange = output<PriceLimits>();

  protected readonly id = `ss-price-range-${nextId++}`;
  /** The thumbs being dragged, until the limits they make come back. */
  protected readonly dragged = linkedSignal<readonly unknown[], PriceLimits>({
    source: () => [this.min(), this.max(), this.range()],
    computation: () => ({}),
  });
  /** The lower thumb: the minimum, or 0. */
  protected readonly low = computed(() =>
    Math.min(this.dragged().min ?? this.min() ?? 0, this.range().top),
  );
  /** The upper thumb: the maximum, or the top, which is Unlimited. */
  protected readonly high = computed(() =>
    Math.min(this.dragged().max ?? this.max() ?? this.range().top, this.range().top),
  );
  protected readonly rangeText = computed(
    () => `${this.priceText(this.low())} – ${this.priceText(this.high())}`,
  );
  /** A thumb's value as it reads, to the eye and to screen readers: the top is Unlimited. */
  protected readonly priceText = (value: number): string =>
    value >= this.range().top
      ? 'Unlimited'
      : wholeAmountText(value, this.currency(), this.country());

  protected dragging(thumb: keyof PriceLimits, value: number): void {
    this.dragged.update((dragged) => ({ ...dragged, [thumb]: value }));
  }

  /** A thumb let go: 0 is no minimum, and the top no maximum. */
  protected letGo(thumb: keyof PriceLimits, value: number): void {
    const { top } = this.range();
    const min = thumb === 'min' ? (value > 0 ? value : undefined) : this.min();
    const max = thumb === 'max' ? (value < top ? value : undefined) : this.max();
    this.limitsChange.emit({
      ...(min !== undefined && { min }),
      ...(max !== undefined && { max }),
    });
  }
}

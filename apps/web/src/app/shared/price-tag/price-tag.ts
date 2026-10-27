import { NgTemplateOutlet } from '@angular/common';
import { Component, booleanAttribute, computed, inject, input, output } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatMenuTrigger, type MatMenuPanel } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { buyerTaxPlace, priceTaxNote, type PickedPrice } from '@simply-sub/core';
import { SettingsStore } from '../../core/settings/settings-store';
import { amountText, intervalSpoken, intervalText, priceTooltip } from './price-text';

/**
 * A price tag (PROJECT-PLAN §4.3): a picked price and its billing period, with ≈ and the currency_exchange icon when
 * it's converted, and a tooltip that says from what. In Canada and the US it adds "+ tax" where sales tax is added, or
 * "incl. tax" on a price that includes it (BLUEPRINT §4.8). A $0 price is "Free". When `clickable`, the price is a
 * button that emits `priceSelect` and carries the tooltip, and opens `menu` when it has one (Search's Add to list,
 * M5.4); otherwise the icon carries it, and it can be focused.
 */
@Component({
  selector: 'ss-price',
  imports: [MatIcon, MatMenuTrigger, MatTooltip, NgTemplateOutlet],
  templateUrl: './price-tag.html',
  styleUrl: './price-tag.scss',
})
export class PriceTag {
  private readonly settings = inject(SettingsStore);

  readonly price = input.required<PickedPrice>();
  /** A price the user can pick (Search's prices, which add it to a list). */
  readonly clickable = input(false, { transform: booleanAttribute });
  /** Where the item was bought, when that's not the user's country (ListItem.region): its tax rule applies. */
  readonly region = input<string>();
  /** The menu a clickable price opens, which then returns focus to it. */
  readonly menu = input<MatMenuPanel>();
  /** What clicking does, for screen readers: "add to a list". */
  readonly action = input<string>();
  readonly priceSelect = output<PickedPrice>();

  protected readonly free = computed(() => this.price().amount === 0);
  protected readonly converted = computed(() => this.price().fx !== undefined);
  /** In another currency than the user's: converted, or shown in its own for want of a rate. */
  protected readonly foreign = computed(() => !this.price().native);
  protected readonly amount = computed(() => {
    const { amount, currency } = this.price();
    return amountText(amount, currency, this.settings.saved()?.country);
  });
  protected readonly interval = computed(() =>
    intervalText(this.price().interval, this.price().intervalCount),
  );
  protected readonly spokenInterval = computed(() =>
    intervalSpoken(this.price().interval, this.price().intervalCount),
  );
  protected readonly tooltip = computed(() => priceTooltip(this.price()) ?? '');
  /** None on a free price: there's no tax on nothing. */
  protected readonly taxNote = computed(() => {
    const saved = this.settings.saved();
    if (!saved || this.free()) return undefined;
    return priceTaxNote(this.price(), buyerTaxPlace(saved, this.region()));
  });
}

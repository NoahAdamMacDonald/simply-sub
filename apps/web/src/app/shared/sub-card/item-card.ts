import { Component, ElementRef, computed, inject, input, output, viewChild } from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { itemActivity, type ResolvedItem, type Tag } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { ClockService } from '../../core/clock/clock-service';
import { addOnText, billingText } from '../billing-text';
import { countryName } from '../country-name';
import { dateText } from '../date-text';
import { FeatureList } from '../feature-list/feature-list';
import { PriceTag } from '../price-tag/price-tag';
import { ProviderIcon } from '../provider-icon/provider-icon';
import { StatusBadge, type BadgeStatus } from '../status-badge/status-badge';
import { TagChip } from '../tags/tag-chip';
import { planTitle } from './card-text';
import { slidingDetails } from './sliding-details';

let nextId = 0;

/**
 * A subscription card's list variant (PROJECT-PLAN §4.3, P4, M6.8): one item of a list, with its icon, name and plan
 * (or its nickname, with the plan under it), status, tags, 📌 and price. Its details, which slide open and shut as
 * Search's do, add how it's billed, its note, its features with their ranks for this item, its Plan and Cancel links,
 * View in Search for a catalog plan or bundle, and Edit, which opens it in the list editor. The page saves 📌
 * (pinToggle). M7.1 adds its next charge and M7.2 its share of the list's total.
 */
@Component({
  selector: 'ss-item-card',
  imports: [
    FeatureList,
    MatButton,
    MatIcon,
    MatIconButton,
    PriceTag,
    ProviderIcon,
    RouterLink,
    StatusBadge,
    TagChip,
  ],
  templateUrl: './item-card.html',
  styleUrl: './item-card.scss',
})
export class ItemCard {
  private readonly today = inject(ClockService).today;
  private readonly catalog = inject(CatalogStore);
  private readonly expandButton = viewChild<string, ElementRef<HTMLElement>>('expandButton', {
    read: ElementRef,
  });
  private readonly body = viewChild<ElementRef<HTMLElement>>('body');

  readonly resolved = input.required<ResolvedItem>();
  /** The item's tags, in its order. */
  readonly tags = input<readonly Tag[]>([]);
  /** 📌: whether the item should now be pinned. */
  readonly pinToggle = output<boolean>();

  protected readonly id = `ss-item-card-${nextId++}`;
  protected readonly item = computed(() => this.resolved().item);
  /** "Netflix Standard": what its buttons and links call it. A bundle is its own name. */
  protected readonly title = computed(() => {
    const { item, name, planName } = this.resolved();
    return item.source.kind === 'bundle' ? name : planTitle(name, planName);
  });
  /**
   * What its buttons call it: its title, or with a nickname "Mom's (Netflix Standard)", which tells two of the same
   * plan apart.
   */
  protected readonly label = computed(() => {
    const nickname = this.item().nickname;
    return nickname === undefined ? this.title() : `${nickname} (${this.title()})`;
  });
  /**
   * Its heading and the line under it: the nickname over "Netflix Standard", or "Netflix" over "Standard". A plan
   * named after its provider shows alone: "Mullvad VPN", "Proton Unlimited".
   */
  protected readonly names = computed(() => {
    const { name, planName } = this.resolved();
    const nickname = this.item().nickname;
    if (nickname !== undefined) return { name: nickname, planName: this.title() };
    return this.title() === planName ? { name: planName } : { name, planName };
  });
  /** What View in Search looks for: the plan's provider, or the bundle's seller. None for a custom plan. */
  protected readonly searchText = computed(() => {
    const { providerId, bundleId, name } = this.resolved();
    if (providerId === undefined) return undefined;
    if (bundleId === undefined) return name;
    return this.catalog.catalog()?.providers.find((provider) => provider.id === providerId)?.name;
  });
  /** What it costs: the price override while it applies, else the plan's price. */
  protected readonly price = computed(() => this.resolved().override ?? this.resolved().price);
  protected readonly status = computed<BadgeStatus>(() => ({
    ...itemActivity(this.item(), this.today()),
    manual: false,
  }));
  /** How it's billed, and what else it has, in words. Its next charge comes with M7.1. */
  protected readonly facts = computed(() => {
    const { item, addOns, override } = this.resolved();
    const { billing, priceOverride, region } = item;
    return [
      // A free plan has nothing to bill.
      ...(this.price().amount === 0 ? [] : [billingText(billing)]),
      ...(billing.mode === 'recurring' && billing.startDate !== undefined
        ? [`Subscribed since ${dateText(billing.startDate)}`]
        : []),
      ...addOns.map((addOn) => `Add-on: ${addOnText(addOn)}`),
      ...(override && priceOverride
        ? [
            priceOverride.until === undefined
              ? 'Your own price'
              : `Your own price until ${dateText(priceOverride.until)}`,
          ]
        : []),
      ...(region === undefined ? [] : [`Bought in ${countryName(region)}`]),
    ];
  });
  /** The details, which slide open and shut, and close from their foot too (M5.7). */
  protected readonly details = slidingDetails(
    () => this.body()?.nativeElement,
    () => this.expandButton()?.nativeElement,
  );
}

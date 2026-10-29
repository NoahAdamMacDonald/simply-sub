import { Component, ElementRef, computed, inject, input, output, viewChild } from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { addOnText, planTitle, type ResolvedItem, type Tag } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { ClockService } from '../../core/clock/clock-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { billingText } from '../billing-text';
import { chargeAmountText, type ShownAndSpoken } from '../charge-text';
import { countryName } from '../country-name';
import { dateText, joinsText } from '../date-text';
import { FeatureList } from '../feature-list/feature-list';
import { PriceTag } from '../price-tag/price-tag';
import { ProviderIcon } from '../provider-icon/provider-icon';
import { StatusBadge, type BadgeStatus } from '../status-badge/status-badge';
import { TagChip } from '../tags/tag-chip';
import { WrongDate } from '../wrong-date/wrong-date';
import { slidingDetails } from './sliding-details';

let nextId = 0;

/**
 * A subscription card's list variant (PROJECT-PLAN §4.3, P4, M6.8): one item of a list, with its icon, name and plan
 * (or its nickname, with the plan under it), status (with "Ends" and "Renew by", M7.1), tags, 📌 and price. Its
 * details, which slide open and shut as Search's do, add its next charge as charged with "Wrong date?" (M7.1), how
 * it's billed, its note, its features with their ranks for this item, its Plan and Cancel links, View in Search for a
 * catalog plan or bundle, and Edit, which opens it in the list editor. The page saves 📌 (pinToggle), and gives its
 * share of the list's next 12 months (M7.2).
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
  private readonly catalog = inject(CatalogStore);
  private readonly clock = inject(ClockService);
  private readonly settings = inject(SettingsStore);
  private readonly wrongDates = inject(WrongDate);
  private readonly expandButton = viewChild<string, ElementRef<HTMLElement>>('expandButton', {
    read: ElementRef,
  });
  private readonly body = viewChild<ElementRef<HTMLElement>>('body');

  readonly resolved = input.required<ResolvedItem>();
  /** The item's tags, in its order. */
  readonly tags = input<readonly Tag[]>([]);
  /** Its share of the list's next 12 months, from 0 to 1 (M7.2): "31% of list". */
  readonly share = input<number>();
  /** What it costs a month with tax, and after its card's cash back and FX fees, when it's paid with one (M9.4). */
  readonly onCard = input<{ card: string; month: ShownAndSpoken }>();
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
  /**
   * What View in Search looks for: the plan's provider, with the plan itself shown on its card (M5.11), or the bundle's
   * seller. None for a custom plan.
   */
  protected readonly searchParams = computed(() => {
    const { item, providerId, bundleId, name } = this.resolved();
    if (providerId === undefined) return undefined;
    if (bundleId === undefined) {
      return { q: name, ...(item.source.kind === 'catalog' && { plan: item.source.planId }) };
    }
    const seller = this.catalog.catalog()?.providers.find((provider) => provider.id === providerId);
    return seller && { q: seller.name };
  });
  /** "31% of list", or "<1% of list" for a sliver; nothing when it has no charge in the next 12 months. */
  protected readonly shareText = computed(() => {
    const share = this.share();
    if (share === undefined || share <= 0) return undefined;
    const percent = Math.round(share * 100);
    return percent === 0 ? '<1% of list' : `${percent}% of list`;
  });
  /** What it costs: the price override while it applies, else the plan's price. */
  protected readonly price = computed(() => this.resolved().override ?? this.resolved().price);
  /**
   * Its add-ons under its names (M6.12), each with what it adds: "+ Extra member × 2" and its price for both. The
   * totals and its share of the list count them already; the price tag on the right is the plan's.
   */
  protected readonly addOns = computed(() =>
    this.resolved().addOns.map((addOn) => {
      const { price, quantity } = addOn;
      return {
        // One added by Optimizations is listed apart, from the day it joins (M8.5).
        id: `${addOn.id} ${addOn.since ?? ''}`,
        text: `${addOnText(addOn)}${joinsText(addOn, this.clock.today())}`,
        price:
          quantity === 1
            ? price
            : {
                ...price,
                amount: price.amount * quantity,
                monthlyEquivalent: price.monthlyEquivalent * quantity,
                source: { ...price.source, amount: price.source.amount * quantity },
              },
      };
    }),
  );
  protected readonly status = computed<BadgeStatus>(() => this.resolved().status);
  /**
   * Its next charge, as charged with tax: the date, and "$21.46, with $2.47 tax". "Wrong date?" moves an Ongoing
   * item's (its anchor); Specific dates' windows have no anchor to move.
   */
  protected readonly next = computed<
    { date: string; amount: ShownAndSpoken; movable: boolean } | undefined
  >(() => {
    const { nextCharge, item } = this.resolved();
    if (!nextCharge) return undefined;
    return {
      date: dateText(nextCharge.date),
      amount: chargeAmountText(nextCharge, this.settings.saved()?.country),
      movable: item.billing.mode === 'recurring',
    };
  });
  /** How it's billed, and what else it has, in words. */
  protected readonly facts = computed(() => {
    const { item, override } = this.resolved();
    const { billing, priceOverride, region } = item;
    return [
      // A free plan has nothing to bill.
      ...(this.price().amount === 0 ? [] : [billingText(billing)]),
      ...(billing.mode === 'recurring' && billing.startDate !== undefined
        ? [`Subscribed since ${dateText(billing.startDate)}`]
        : []),
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
  /** "Wrong date?": the date its next charge is really on becomes its anchor, saved to the item at once (P4). */
  protected async wrongDate(): Promise<void> {
    const next = this.resolved().nextCharge;
    if (next) await this.wrongDates.ask(this.item(), this.label(), next.date);
  }

  /** The details, which slide open and shut, and close from their foot too (M5.7). */
  protected readonly details = slidingDetails(
    () => this.body()?.nativeElement,
    () => this.expandButton()?.nativeElement,
  );
}

import {
  Component,
  ElementRef,
  computed,
  inject,
  input,
  linkedSignal,
  viewChild,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import {
  countedRanks,
  formerlyText,
  planTitle,
  type AddRequest,
  type CatalogResult,
  type PickedPrice,
  type ProviderRenewal,
  type Rank,
  type RankKey,
  type ResellerDeal,
  type SubscriptionList,
} from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { ClockService } from '../../core/clock/clock-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { AddToListMenu } from '../add-to-list/add-to-list-menu';
import { countryName } from '../country-name';
import { PriceTag } from '../price-tag/price-tag';
import { ProviderIcon } from '../provider-icon/provider-icon';
import { RankCounts } from '../rank/rank-counts';
import { StatusBadge, type BadgeStatus } from '../status-badge/status-badge';
import { catalogIcon } from './card-text';
import { InLists, type NamedList } from './in-lists';
import { PlanDetails } from './plan-details';
import { slidingDetails } from './sliding-details';

let nextId = 0;

/**
 * A subscription card (PROJECT-PLAN §4.3), the search variant (P8, M5.2): one provider, showing one of the plans
 * that matched, with its prices, the resellers that sell it for less, links to sign up and cancel, and the
 * provider's place in the user's lists. A price opens the Add to list menu (P7, M5.4), or in Search's pick mode adds
 * to that mode's list at once (F2, M5.5). Chips switch between the matching plans, and the expanded section adds the
 * plan's features, add-ons, bundles and the rest (ss-plan-details), whose bundle prices do the same. It slides open
 * and shut, closes from its foot too, and keeps the card on screen (M5.7). A provider that isn't sold in the user's
 * country says so instead. The list variant, for List view, is ss-item-card (M6.8).
 */
@Component({
  selector: 'ss-sub-card',
  host: { '[style.--price-rows]': 'priceRows()' },
  imports: [
    AddToListMenu,
    InLists,
    MatIcon,
    MatIconButton,
    PlanDetails,
    PriceTag,
    ProviderIcon,
    RankCounts,
    StatusBadge,
  ],
  templateUrl: './sub-card.html',
  styleUrl: './sub-card.scss',
})
export class SubCard {
  private readonly settings = inject(SettingsStore);
  private readonly catalog = inject(CatalogStore);
  private readonly today = inject(ClockService).today;
  private readonly expandButton = viewChild<string, ElementRef<HTMLElement>>('expandButton', {
    read: ElementRef,
  });

  /** A searchCatalog result. */
  readonly result = input.required<CatalogResult>();
  /** The user's ranks, beside the features the expanded card lists. */
  readonly ranks = input<Readonly<Partial<Record<RankKey, Rank>>>>({});
  /** Pick mode's list (P7, flow F2): its prices, and its bundles', add to it with no menu. */
  readonly pickList = input<Pick<SubscriptionList, 'id' | 'name'>>();
  /** The user's lists' names, by id, which "· 2 lists" names. */
  readonly listNames = input<ReadonlyMap<string, string>>(new Map());
  /** Its "Ends", and "Renew by" or "Auto-renews", from the user's items' charges (M7.1, M6.12). */
  readonly renewal = input<ProviderRenewal>();

  protected readonly id = `ss-sub-card-${nextId++}`;
  protected readonly provider = computed(() => this.result().provider);
  protected readonly plans = computed(() => {
    const result = this.result();
    return result.kind === 'priced' ? result.plans : [];
  });
  /** The chip the user picked, while it still matches; otherwise the plan the result shows. */
  protected readonly selectedId = linkedSignal<
    { shown?: string; ids: readonly string[] },
    string | undefined
  >({
    source: () => {
      const result = this.result();
      return result.kind === 'priced'
        ? { shown: result.shownPlanId, ids: result.plans.map(({ plan }) => plan.id) }
        : { ids: [] };
    },
    computation: (source, previous) =>
      previous?.value !== undefined && source.ids.includes(previous.value)
        ? previous.value
        : source.shown,
  });
  protected readonly plan = computed(() =>
    this.plans().find(({ plan }) => plan.id === this.selectedId()),
  );
  /** "(formerly Max 20x)" beside a renamed plan's name, for six months (M10.27). */
  protected readonly formerly = computed(() => {
    const plan = this.plan()?.plan;
    return plan && formerlyText(plan, this.today());
  });
  /** How many of the plan's features the user ranks each way, or nothing when they rank none of them. */
  protected readonly rankCounts = computed(() => {
    const counts = this.plan()?.rankCounts;
    return counts && countedRanks.some((rank) => counts[rank] !== 0) ? counts : undefined;
  });
  /** The most prices any of its plans shows: wide, the card keeps room for them, so switching plans moves no chip. */
  protected readonly priceRows = computed(() =>
    Math.max(1, ...this.plans().map(({ pricing }) => pricing.length)),
  );
  private readonly body = viewChild<ElementRef<HTMLElement>>('body');
  /** The details, which slide open and shut, and close from their foot too (M5.7). */
  protected readonly details = slidingDetails(
    () => this.body()?.nativeElement,
    () => this.expandButton()?.nativeElement,
  );

  /** What a plan's price adds to a list: the plan, at that price's period (P7, F1). */
  protected planRequest(planId: string, price: PickedPrice): AddRequest {
    return { kind: 'plan', planId, interval: price.interval, intervalCount: price.intervalCount };
  }

  /**
   * What a reseller's price adds: the plan at the shop's period, with what the shop charges, in its own currency, as
   * the item's own price (BLUEPRINT §4.9). Tax is added to it where a catalog price's would be, unless it includes it.
   */
  protected resellerRequest(deal: ResellerDeal): AddRequest {
    const { price } = deal;
    return {
      kind: 'plan',
      // A deal is shown only for the plan chosen.
      planId: this.plan()?.plan.id ?? '',
      interval: price.interval,
      intervalCount: price.intervalCount,
      price: {
        amount: price.source.amount,
        currency: price.source.currency,
        plusTax: price.taxIncluded !== true,
      },
    };
  }

  protected readonly icon = catalogIcon;
  /** "Netflix Standard", for the links' and the details button's names. */
  protected readonly title = computed(() => {
    const plan = this.plan();
    return plan ? planTitle(this.provider().name, plan.plan.name) : this.provider().name;
  });
  /** Where to sign up: the plan's page, or the site of a provider not sold here, which has no plan to show. */
  protected readonly link = computed(() => this.plan()?.plan.link ?? this.provider().website);
  /**
   * The sign-up link's name, "Plan: Netflix Standard, opens in a new tab". One string: a browser puts a space before
   * words in a separate hidden box, which made "Plan : Netflix Standard".
   */
  protected readonly linkName = computed(
    () => `${this.plan() ? 'Plan' : 'Website'}: ${this.title()}, opens in a new tab`,
  );
  protected readonly status = computed<BadgeStatus>(() => {
    const activity = this.result().activity;
    const renewal = this.renewal();
    return activity
      ? {
          kind: activity.kind,
          activeFrom: activity.activeFrom,
          ...(renewal?.endsOn !== undefined && { endsOn: renewal.endsOn }),
          manual: renewal?.renewBy !== undefined,
        }
      : { kind: 'not-listed' };
  });
  /** The lists that have it, by name, for "· 2 lists" after the status. */
  protected readonly inLists = computed(() =>
    (this.result().activity?.listIds ?? []).flatMap((id): NamedList[] => {
      const name = this.listNames().get(id);
      return name === undefined ? [] : [{ id, name }];
    }),
  );
  protected readonly country = computed(() => {
    const code = this.settings.saved()?.country;
    return code && countryName(code);
  });
  /** "Cheaper at" over the shops when they all are, else "Also sold at" (Settings' "Show every reseller", M5.13). */
  protected readonly dealsLabel = computed(() =>
    (this.plan()?.deals ?? []).every((deal) => deal.cheaper) ? 'Cheaper at' : 'Also sold at',
  );
  /** The bundles in the lists that include one of its plans, by name (M7.11): "Netflix and Crave". */
  protected readonly inBundles = computed(() => {
    const ids = this.result().activity?.bundleIds ?? [];
    const bundles = this.catalog.catalog()?.bundles ?? [];
    const names = ids.flatMap((id) => bundles.find((bundle) => bundle.id === id)?.name ?? []);
    return names.length > 0 ? names.join(' and ') : undefined;
  });
}

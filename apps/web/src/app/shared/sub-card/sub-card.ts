import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import type { AddRequest, CatalogResult, PickedPrice, Rank, RankKey } from '@simply-sub/core';
import { SettingsStore } from '../../core/settings/settings-store';
import { AddToListMenu } from '../add-to-list/add-to-list-menu';
import { countryName } from '../country-name';
import { PriceTag } from '../price-tag/price-tag';
import { ProviderIcon } from '../provider-icon/provider-icon';
import { StatusBadge, type BadgeStatus } from '../status-badge/status-badge';
import { catalogIcon, planTitle } from './card-text';
import { PlanDetails } from './plan-details';

let nextId = 0;

/**
 * A subscription card (PROJECT-PLAN §4.3), the search variant (P8, M5.2): one provider, showing one of the plans
 * that matched, with its prices, the resellers that sell it for less, links to sign up and cancel, and the
 * provider's place in the user's lists. A price opens the Add to list menu (P7, M5.4). Chips switch between the
 * matching plans, and the expanded section adds the plan's features, add-ons, bundles and the rest (ss-plan-details),
 * whose bundle prices open the same menu. A provider that isn't sold in the user's country says so instead. The list
 * variant comes with List view (M6.8).
 */
@Component({
  selector: 'ss-sub-card',
  imports: [
    AddToListMenu,
    MatIcon,
    MatIconButton,
    PlanDetails,
    PriceTag,
    ProviderIcon,
    StatusBadge,
  ],
  templateUrl: './sub-card.html',
  styleUrl: './sub-card.scss',
})
export class SubCard {
  private readonly settings = inject(SettingsStore);

  /** A searchCatalog result. */
  readonly result = input.required<CatalogResult>();
  /** The user's ranks, beside the features the expanded card lists. */
  readonly ranks = input<Readonly<Partial<Record<RankKey, Rank>>>>({});

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
  protected readonly expanded = signal(false);

  /** What a plan's price adds to a list: the plan, at that price's period (P7, F1). */
  protected planRequest(planId: string, price: PickedPrice): AddRequest {
    return { kind: 'plan', planId, interval: price.interval, intervalCount: price.intervalCount };
  }

  protected readonly icon = catalogIcon;
  /** "Netflix Standard", for the links' and the details button's names. */
  protected readonly title = computed(() => {
    const plan = this.plan();
    return plan ? planTitle(this.provider().name, plan.plan.name) : this.provider().name;
  });
  /** Where to sign up: the plan's page, or the site of a provider not sold here, which has no plan to show. */
  protected readonly link = computed(() => this.plan()?.plan.link ?? this.provider().website);
  protected readonly status = computed<BadgeStatus>(() => {
    const activity = this.result().activity;
    return activity
      ? { kind: activity.kind, activeFrom: activity.activeFrom, manual: false }
      : { kind: 'not-listed' };
  });
  /** " · 2 lists", after the status. */
  protected readonly lists = computed(() => {
    const count = this.result().activity?.lists;
    return count === undefined ? '' : ` · ${count} ${count === 1 ? 'list' : 'lists'}`;
  });
  protected readonly country = computed(() => {
    const code = this.settings.saved()?.country;
    return code && countryName(code);
  });
}

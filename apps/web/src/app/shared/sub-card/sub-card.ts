import { DOCUMENT } from '@angular/common';
import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import type {
  AddRequest,
  CatalogResult,
  PickedPrice,
  Rank,
  RankKey,
  ResellerDeal,
  SubscriptionList,
} from '@simply-sub/core';
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
 * provider's place in the user's lists. A price opens the Add to list menu (P7, M5.4), or in Search's pick mode adds
 * to that mode's list at once (F2, M5.5). Chips switch between the matching plans, and the expanded section adds the
 * plan's features, add-ons, bundles and the rest (ss-plan-details), whose bundle prices do the same. It slides open
 * and shut, closes from its foot too, and keeps the card on screen (M5.7). A provider that isn't sold in the user's
 * country says so instead. The list variant comes with List view (M6.8).
 */
@Component({
  selector: 'ss-sub-card',
  host: { '[style.--price-rows]': 'priceRows()' },
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly window = inject(DOCUMENT).defaultView;
  private readonly expandButton = viewChild<string, ElementRef<HTMLElement>>('expandButton', {
    read: ElementRef,
  });

  /** A searchCatalog result. */
  readonly result = input.required<CatalogResult>();
  /** The user's ranks, beside the features the expanded card lists. */
  readonly ranks = input<Readonly<Partial<Record<RankKey, Rank>>>>({});
  /** Pick mode's list (P7, flow F2): its prices, and its bundles', add to it with no menu. */
  readonly pickList = input<Pick<SubscriptionList, 'id' | 'name'>>();

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
  /** The most prices any of its plans shows: wide, the card keeps room for them, so switching plans moves no chip. */
  protected readonly priceRows = computed(() =>
    Math.max(1, ...this.plans().map(({ pricing }) => pricing.length)),
  );
  /** Whether the details are open, as the details button says. */
  protected readonly expanded = signal(false);
  /** Whether they're in the page: open, or sliding shut. */
  protected readonly rendered = signal(false);
  /** While they slide: their content is clipped only then, so focus rings aren't. */
  protected readonly moving = signal(false);
  private readonly body = viewChild<ElementRef<HTMLElement>>('body');
  private slideAnimation?: Animation;

  protected toggle(): void {
    if (this.expanded()) {
      this.close();
    } else {
      this.open();
    }
  }

  /** Hide details, at the details' foot: closes them and puts focus back on the details button above. */
  protected collapse(): void {
    this.expandButton()?.nativeElement.focus({ preventScroll: true });
    this.close();
  }

  private open(): void {
    this.expanded.set(true);
    this.rendered.set(true);
    afterNextRender(() => void this.slide('open').then((done) => done && this.keepInView()), {
      injector: this.injector,
    });
  }

  private close(): void {
    this.expanded.set(false);
    void this.slide('shut').then((done) => {
      if (!done) return;
      this.rendered.set(false);
      afterNextRender(() => this.keepInView(), { injector: this.injector });
    });
  }

  /**
   * Slides the details open or shut (M5.7): their grid row from 0fr to 1fr, fading in, or back. With the browser's
   * own Web Animations, since Angular's animate.enter and animate.leave would add 9 kB to the first download. None
   * with reduced motion. False when another click cut it short, which takes over.
   */
  private async slide(way: 'open' | 'shut'): Promise<boolean> {
    const body = this.body()?.nativeElement;
    this.slideAnimation?.cancel();
    if (!body?.animate || this.window?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return true;
    }
    const closed = { gridTemplateRows: '0fr', opacity: 0 };
    const open = { gridTemplateRows: '1fr', opacity: 1 };
    const animation = body.animate(way === 'open' ? [closed, open] : [open, closed], {
      duration: way === 'open' ? 200 : 150,
      easing: way === 'open' ? 'ease-out' : 'ease-in',
      // Shut, they stay shut until they leave the page.
      fill: way === 'open' ? 'none' : 'forwards',
    });
    this.slideAnimation = animation;
    this.moving.set(true);
    try {
      await animation.finished;
      return true;
    } catch {
      return false;
    } finally {
      if (this.slideAnimation === animation) this.moving.set(false);
    }
  }

  /**
   * Once the details have opened or closed, scrolls the card back into view if that left part of it off screen:
   * open, as much of them as fits below the page's pinned bar (the card's scroll-margin); closed from their foot, the
   * card's top, which was scrolled past.
   */
  private keepInView(): void {
    const reduce = this.window?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.host.nativeElement.scrollIntoView?.({
      block: 'nearest',
      behavior: reduce ? 'auto' : 'smooth',
    });
  }

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

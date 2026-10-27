import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import {
  planExtras,
  planPolicies,
  type AddRequest,
  type BundleSaving,
  type PickedPrice,
  type PlanMatch,
  type PolicyGroup,
  type PolicyTier,
  type Rank,
  type RankKey,
  type SnapshotProvider,
  type SuiteContents,
} from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { FxStore } from '../../core/fx/fx-store';
import { SettingsStore } from '../../core/settings/settings-store';
import type { AddToListMenu } from '../add-to-list/add-to-list-menu';
import { countryName } from '../country-name';
import { dateText } from '../date-text';
import { FeatureList } from '../feature-list/feature-list';
import { PriceTag } from '../price-tag/price-tag';
import { ProviderIcon } from '../provider-icon/provider-icon';
import { catalogIcon, planTitle, savingText, type SavingText } from './card-text';

/** The tiers' names, as each rating's pill shows them (BLUEPRINT §4.10). */
const tierNames: Record<PolicyTier, string> = {
  good: 'Good',
  'leaning-good': 'Leaning good',
  neutral: 'Neutral',
  'leaning-bad': 'Leaning bad',
  bad: 'Bad',
};

const groupNames: Record<PolicyGroup, string> = {
  privacy: 'Privacy',
  billing: 'Billing',
  legal: 'Legal',
  service: 'Service',
};

/**
 * A Search card's expanded section (PROJECT-PLAN P8): the plan's features with the user's ranks, its add-ons, the
 * bundles that include it and what they save, what a suite includes and saves, its perks and notes, its terms and
 * policies rated with a line on why and links to the pages (M1.13), and when its price was checked. Core's
 * planExtras prices them for the user from the catalog file for their country.
 */
@Component({
  selector: 'ss-plan-details',
  imports: [FeatureList, MatIcon, NgTemplateOutlet, PriceTag, ProviderIcon],
  templateUrl: './plan-details.html',
  styleUrl: './plan-details.scss',
})
export class PlanDetails {
  private readonly catalog = inject(CatalogStore);
  private readonly settings = inject(SettingsStore);
  private readonly fx = inject(FxStore);

  readonly provider = input.required<SnapshotProvider>();
  readonly match = input.required<Pick<PlanMatch, 'plan' | 'pricing' | 'lastVerified' | 'stale'>>();
  readonly ranks = input<Readonly<Partial<Record<RankKey, Rank>>>>({});
  /** The card's Add to list menu, which a bundle's price opens (P7, F4). Without it, prices are text. */
  readonly addMenu = input<AddToListMenu>();

  /** What a bundle's price adds to a list: the bundle, at that price's period. */
  protected bundleRequest(bundleId: string, price: PickedPrice): AddRequest {
    return {
      kind: 'bundle',
      bundleId,
      interval: price.interval,
      intervalCount: price.intervalCount,
    };
  }

  protected readonly plan = computed(() => this.match().plan);
  protected readonly hasFeatures = computed(() => Object.keys(this.plan().features).length > 0);
  protected readonly extras = computed(() => {
    const saved = this.settings.saved();
    const data = this.catalog.catalog();
    if (!saved || !data) return undefined;
    const fx = this.fx.rates();
    return planExtras(this.provider(), this.plan(), data, {
      region: saved.country,
      currency: saved.currency,
      ...(fx && { fx }),
    });
  });
  /** Its terms and policies for this plan, as they apply where the user lives (core's planPolicies). */
  protected readonly policies = computed(() => {
    const saved = this.settings.saved();
    const data = this.catalog.catalog();
    if (!saved || !data) return undefined;
    return planPolicies(this.provider(), this.plan().id, saved.country, data.policyTopics);
  });
  protected readonly tierNames = tierNames;
  protected readonly groupNames = groupNames;
  protected readonly country = computed(() => {
    const code = this.settings.saved()?.country;
    return code && countryName(code);
  });
  protected readonly checked = computed(() => dateText(this.match().lastVerified));
  protected readonly icon = catalogIcon;

  protected savingParts(saving: BundleSaving, pricing: readonly PickedPrice[]): SavingText {
    return savingText(saving, pricing, this.settings.saved()?.country);
  }

  protected includedName({ provider, plan }: SuiteContents['includes'][number]): string {
    return plan ? planTitle(provider.name, plan.name) : provider.name;
  }
}

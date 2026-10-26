import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import {
  planExtras,
  type BundleSaving,
  type PickedPrice,
  type PlanMatch,
  type Rank,
  type RankKey,
  type SnapshotProvider,
  type SuiteContents,
} from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { FxStore } from '../../core/fx/fx-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { countryName } from '../country-name';
import { dateText } from '../date-text';
import { FeatureList } from '../feature-list/feature-list';
import { PriceTag } from '../price-tag/price-tag';
import { ProviderIcon } from '../provider-icon/provider-icon';
import { catalogIcon, planTitle, savingText, type SavingText } from './card-text';

/**
 * A Search card's expanded section (PROJECT-PLAN P8): the plan's features with the user's ranks, its add-ons, the
 * bundles that include it and what they save, what a suite includes and saves, its perks and notes, and when its
 * price was checked. Core's planExtras prices them for the user from the catalog file for their country.
 */
@Component({
  selector: 'ss-plan-details',
  imports: [FeatureList, NgTemplateOutlet, PriceTag, ProviderIcon],
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

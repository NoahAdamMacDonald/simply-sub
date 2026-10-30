import { NgTemplateOutlet } from '@angular/common';
import { Component, Injector, computed, inject, input } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import {
  planExtras,
  planPolicies,
  planTitle,
  type AddRequest,
  type BundleSaving,
  type PickedPrice,
  type PlanMatch,
  type PolicyCitation,
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
import type { ReportPriceData } from '../report-price/report-price-dialog';
import { catalogIcon, savingText, type SavingText } from './card-text';

/** The grades' names, in muted text beside each rating's topic (BLUEPRINT §4.10). */
const tierNames: Record<PolicyTier, string> = {
  great: 'Great',
  good: 'Good',
  neutral: 'Neutral',
  poor: 'Poor',
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
 * policies graded with why in plain words and a citation of each page it quotes (M1.13, M1.14), and when its price
 * was checked, with Report a wrong price beside it (M10.11). Core's planExtras prices them for the user from the
 * catalog file for their country.
 */
@Component({
  selector: 'ss-plan-details',
  imports: [FeatureList, MatButton, MatIcon, MatTooltip, NgTemplateOutlet, PriceTag, ProviderIcon],
  templateUrl: './plan-details.html',
  styleUrl: './plan-details.scss',
})
export class PlanDetails {
  private readonly catalog = inject(CatalogStore);
  private readonly settings = inject(SettingsStore);
  private readonly fx = inject(FxStore);
  private readonly injector = inject(Injector);

  readonly provider = input.required<SnapshotProvider>();
  readonly match = input.required<Pick<PlanMatch, 'plan' | 'pricing' | 'lastVerified' | 'stale'>>();
  readonly ranks = input<Readonly<Partial<Record<RankKey, Rank>>>>({});
  /**
   * The card's Add to list menu, which a bundle's price opens (P7, F4), or adds through at once in pick mode (F2).
   * Without it, prices are text.
   */
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

  /** Report a wrong price (M10.11): its dialog loads as it opens, and a report sent says what happens next. */
  protected async report(): Promise<void> {
    const country = this.settings.saved()?.country;
    if (!country) return;
    const provider = this.provider().name;
    const [{ MatDialog }, { ReportPriceDialog }] = await Promise.all([
      import('@angular/material/dialog'),
      import('../report-price/report-price-dialog'),
    ]);
    const data: ReportPriceData = {
      plan: this.plan().id,
      title: planTitle(provider, this.plan().name),
      prices: this.match().pricing ?? [],
      country,
    };
    const dialog = this.injector.get(MatDialog).open(ReportPriceDialog, {
      data,
      autoFocus: 'first-tabbable',
      maxWidth: 'min(640px, calc(100vw - 32px))',
      width: '640px',
    });
    dialog.afterClosed().subscribe((sent?: boolean) => {
      if (sent) void this.thank(provider);
    });
  }

  private async thank(provider: string): Promise<void> {
    const { MatSnackBar } = await import('@angular/material/snack-bar');
    this.injector
      .get(MatSnackBar)
      .open(`Thanks. ${provider}’s page will be checked tonight.`, undefined, { duration: 5000 });
  }

  /** A citation's tooltip: the words it quotes, and the page. */
  protected quoteText({ quotes, name }: PolicyCitation): string {
    return `${quotes.map((quote) => `“${quote}”`).join(' ')} (${name})`;
  }

  protected includedName({ provider, plan }: SuiteContents['includes'][number]): string {
    return plan ? planTitle(provider.name, plan.name) : provider.name;
  }
}

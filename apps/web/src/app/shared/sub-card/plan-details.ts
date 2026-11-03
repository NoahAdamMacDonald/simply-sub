import { NgTemplateOutlet } from '@angular/common';
import { Component, Injector, computed, inject, input } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import {
  currenciesIn,
  outsideRatings,
  ownerCitation,
  paymentMethodNames,
  paymentMethodsIn,
  planExtras,
  planPolicies,
  planTitle,
  quoteLink,
  renewalAnchorNames,
  repositoryLabel,
  type AddRequest,
  type BundleSaving,
  type CurrenciesEntry,
  type PaymentMethods,
  type PickedPrice,
  type PlanMatch,
  type PolicyCitation,
  type PolicyGroup,
  type PolicyStatus,
  type PolicyTier,
  type Rank,
  type RankKey,
  type SnapshotProvider,
  type SuiteContents,
} from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { ClockService } from '../../core/clock/clock-service';
import { FxStore } from '../../core/fx/fx-store';
import { SettingsStore } from '../../core/settings/settings-store';
import type { AddToListMenu } from '../add-to-list/add-to-list-menu';
import { countryName } from '../country-name';
import { dateText, monthText } from '../date-text';
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

/** What a rating without a grade says instead, in grey (M11.1). */
const statusNames: Record<PolicyStatus, string> = {
  'not-stated': 'Not stated',
  'not-applicable': 'Not applicable',
};

/** A fact's citation (M11.5): the provider's page by name, linked to its words, which are its tooltip. */
interface CitedFact {
  page: string;
  href: string;
  quotes: readonly string[];
}

const groupNames: Record<PolicyGroup, string> = {
  privacy: 'Privacy',
  billing: 'Billing',
  legal: 'Legal',
  security: 'Security',
  service: 'Service',
  finance: 'Money',
  other: 'Notable',
};

/**
 * A Search card's expanded section (PROJECT-PLAN P8): the plan's features with the user's ranks, its add-ons, the
 * bundles that include it and what they save, what a suite includes and saves, its perks and notes, its terms and
 * policies graded with why in plain words and a citation of each page it quotes (M1.13, M1.14), outside raters' labels
 * and the company behind it, citing its own page (M11.2), how it can be paid, in which currencies, on which day it
 * renews and where its source code is (M11.5), and when its price was checked, with Report a wrong price beside it
 * (M10.11). Core's planExtras prices them for the user from the catalog file for their country.
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
  private readonly today = inject(ClockService).today;
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
    return planExtras(
      this.provider(),
      this.plan(),
      data,
      { region: saved.country, currency: saved.currency, ...(fx && { fx }) },
      this.today(),
    );
  });
  /** Its terms and policies for this plan, as they apply where the user lives (core's planPolicies). */
  protected readonly policies = computed(() => {
    const saved = this.settings.saved();
    const data = this.catalog.catalog();
    if (!saved || !data) return undefined;
    return planPolicies(
      this.provider(),
      this.plan().id,
      saved.country,
      data.policyTopics,
      data.policySets,
    );
  });
  /** Outside raters' labels by subject (M11.2): each with its date and a link to the rater's page, never its text. */
  protected readonly outside = computed(() =>
    outsideRatings(this.provider(), this.catalog.catalog()?.raters),
  );
  /** The company behind it, and its own page that says so (M11.2). */
  protected readonly owner = computed(() => {
    const owner = this.provider().owner;
    return owner && ownerCitation(owner);
  });
  /** How a buyer where the user lives can pay it (M11.5), and the provider's page that says so. */
  protected readonly payment = computed(() => {
    const country = this.settings.saved()?.country;
    return country ? paymentMethodsIn(this.provider(), country) : undefined;
  });
  /** The currencies they can pay it in beyond its price lists (M11.5), each with its page. */
  protected readonly currencies = computed(() => {
    const country = this.settings.saved()?.country;
    return country ? currenciesIn(this.provider(), country) : [];
  });
  /** The day it renews on (M11.5), citing its page, or that its pages don't say. */
  protected readonly renewal = computed((): { text: string; cited?: CitedFact } | undefined => {
    const anchor = this.provider().renewalAnchor;
    if (!anchor) return undefined;
    if (anchor.kind === 'not-stated') return { text: 'Not stated: its pages don’t say' };
    return {
      text: renewalAnchorNames[anchor.kind],
      cited: {
        page: anchor.page,
        href: quoteLink(anchor.url, anchor.quotes),
        quotes: anchor.quotes,
      },
    };
  });
  /** Where its source code is (M11.5), and its own page that links it. */
  protected readonly repo = computed(() => {
    const repo = this.provider().sourceRepo;
    return (
      repo && {
        url: repo.url,
        label: repositoryLabel(repo.url),
        page: repo.page.name,
        href: quoteLink(repo.page.url, repo.quotes),
        quotes: repo.quotes,
      }
    );
  });
  protected readonly tierNames = tierNames;
  protected readonly statusNames = statusNames;
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
    const { openSnack, snackMillis } = await import('../snack/snack');
    openSnack(this.injector, `Thanks. ${provider}’s page will be checked tonight.`, undefined, {
      duration: snackMillis,
    });
  }

  /** A rater's date: "Sep 14, 2026", or a lab test's month, "August 2026". */
  protected ratingDate(date: string): string {
    return date.length === 7 ? monthText(date) : dateText(date);
  }

  /** "Card, PayPal and Cash". */
  protected methodsText(methods: PaymentMethods[number]['methods']): string {
    return listText(
      methods.map((method) => paymentMethodNames[method]),
      'and',
    );
  }

  /** "Cash in EUR, USD or CAD", or "Pay in USD or CAD" for every way to pay. */
  protected currenciesText({ codes, methods }: CurrenciesEntry): string {
    const currencies = listText(codes, 'or');
    return methods ? `${this.methodsText(methods)} in ${currencies}` : `Pay in ${currencies}`;
  }

  /** The page, scrolled to the words that name the methods or currencies. */
  protected paymentHref({ url, quotes }: { url: string; quotes: readonly string[] }): string {
    return quoteLink(url, quotes);
  }

  /** A citation's tooltip when it links one page: the words it quotes there. */
  protected quotesText(quotes: readonly string[]): string {
    return quotes.map((quote) => `“${quote}”`).join(' ');
  }

  /** A citation's tooltip: the words it quotes, and the page; a page read that's silent on the topic, by name. */
  protected quoteText({ quotes, name }: PolicyCitation): string {
    return quotes.length > 0 ? `${quotes.map((quote) => `“${quote}”`).join(' ')} (${name})` : name;
  }

  protected includedName({ provider, plan }: SuiteContents['includes'][number]): string {
    return plan ? planTitle(provider.name, plan.name) : provider.name;
  }
}

/** "A, B and C" (or "or"). */
function listText(items: readonly string[], conjunction: 'and' | 'or'): string {
  return items.length > 1
    ? `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`
    : (items[0] ?? '');
}

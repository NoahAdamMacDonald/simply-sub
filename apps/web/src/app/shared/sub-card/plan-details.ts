import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  Injector,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import {
  acceptedNetworksIn,
  cardNetworkNames,
  currenciesIn,
  outsideRatings,
  ownerCitation,
  paymentMethodNames,
  paymentMethodsIn,
  planExtras,
  planFeatureRows,
  planHighlights,
  planPolicies,
  planTitle,
  policyGradeCounts,
  quoteLink,
  renewalAnchorNames,
  repositoryLabel,
  type AddRequest,
  type BundleSaving,
  type CardNetwork,
  type CurrenciesEntry,
  type PaymentMethod,
  type PaymentMethods,
  type PickedPrice,
  type PlanMatch,
  type Rank,
  type RankKey,
  type SnapshotProvider,
  type SuiteContents,
} from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { PolicyFiles } from '../../core/catalog/policy-files';
import { ClockService } from '../../core/clock/clock-service';
import { FxStore } from '../../core/fx/fx-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { AccountTerms } from '../account-terms/account-terms';
import type { AddToListMenu } from '../add-to-list/add-to-list-menu';
import { countryName } from '../country-name';
import { dateText, monthText } from '../date-text';
import { FeatureList } from '../feature-list/feature-list';
import { PriceTag } from '../price-tag/price-tag';
import { ProviderIcon } from '../provider-icon/provider-icon';
import type { ReportPriceData } from '../report-price/report-price-dialog';
import { catalogIcon, savingText, type SavingText } from './card-text';
import { hostGlyph, methodGlyphs, networkGlyphs, type Glyph } from './pay-glyphs';
import { PolicyRatings, tierNames } from './policy-ratings';

/** A fact's citation (M11.5): the provider's page by name, linked to its words, which are its tooltip. */
interface CitedFact {
  page: string;
  href: string;
  quotes: readonly string[];
  /** The words before the page's name, when not ", according to its " (after a line of chips). */
  lead?: string;
}

/**
 * A way to pay as a chip (the owner's design, 2026-11-03): its glyphs, and its name, which is its tooltip and what a
 * screen reader says, with any words it shows too (a network with no glyph, "networks not verified"). One with no
 * glyph shows its name.
 */
interface PayChip {
  name: string;
  glyphs: readonly Glyph[];
  words?: string;
}

/** A line of Ways to pay: its chips, and the page that names them. */
interface PayLine {
  chips: readonly PayChip[];
  cited: CitedFact;
}

/** A line of Ways to pay: what it says, and the page that says so. */
interface CitedLine {
  text: string;
  cited: CitedFact;
}

/** The details' tabs (the owner's design, 2026-11-03), in this order. */
type DetailsTab = 'overview' | 'features' | 'terms' | 'facts';

const tabNames: Record<DetailsTab, string> = {
  overview: 'Overview',
  features: 'Features',
  terms: 'Terms',
  facts: 'Facts',
};

/** How many ways to pay the Overview shows before "and 3 more". */
const glancedChips = 4;

/** Each card's details get their own ids for their tabs and panels. */
let nextId = 0;

/**
 * A Search card's expanded section (PROJECT-PLAN P8), in tabs (the owner's design, 2026-11-03, WAI-ARIA's tabs
 * pattern): Overview, at a glance (its highlights, a finance account's terms, what a suite includes, its Terms and
 * policies' grades, its owner and ways to pay, and when its price was checked, with Report a wrong price beside it,
 * M10.11); Features (the plan's features with the user's ranks, its perks, add-ons and the bundles that include it);
 * Terms (its terms and policies graded with why in plain words and a citation of each page it quotes, M1.13, M1.14,
 * and outside raters' labels, M11.2); and Facts (what a suite includes and saves, the company behind it, citing its own
 * page, how it can be paid, in which currencies, on which day it renews, where its source code is, M11.5, and its
 * notes). A tab with nothing to show is left out, and a panel renders the first time its tab is chosen. Core's
 * planExtras prices them for the user from the catalog file for their country.
 */
@Component({
  selector: 'ss-plan-details',
  imports: [
    AccountTerms,
    FeatureList,
    MatButton,
    MatIcon,
    MatTooltip,
    NgTemplateOutlet,
    PolicyRatings,
    PriceTag,
    ProviderIcon,
  ],
  templateUrl: './plan-details.html',
  styleUrl: './plan-details.scss',
  host: { '(window:online)': 'retryPolicies()' },
})
export class PlanDetails {
  private readonly catalog = inject(CatalogStore);
  private readonly policyFiles = inject(PolicyFiles);
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

  /** The id its tabs and panels are named by. */
  protected readonly id = `plan-details-${nextId++}`;
  /** The tab chosen: Overview as the card opens. */
  private readonly selected = signal<DetailsTab>('overview');
  /** The tabs chosen so far: a panel renders the first time its tab is, and stays. */
  protected readonly visited = signal<ReadonlySet<DetailsTab>>(new Set(['overview']));
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

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
  /** The plan's perks as its provider names them (M11.6). */
  protected readonly perks = computed(() => {
    const perks = this.provider().perks ?? [];
    return (this.plan().perks ?? []).flatMap((id) => perks.find((perk) => perk.id === id) ?? []);
  });
  /** How many features its feature list shows, groups' members included. */
  protected readonly featureCount = computed(() => {
    const count = (rows: ReturnType<typeof planFeatureRows>): number =>
      rows.reduce((total, row) => total + 1 + count(row.children), 0);
    return count(planFeatureRows(this.plan().features, this.catalog.catalog()?.features ?? []));
  });
  /** Its features at a glance (Overview): those the user ranks highest, then the headlines. */
  protected readonly highlights = computed(() =>
    planHighlights(this.plan().features, this.catalog.catalog()?.features ?? [], this.ranks()).join(
      ' · ',
    ),
  );
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
  /**
   * Its Terms and policies' file, loaded as the card opens (M11.8): only for a provider whose catalog file points to
   * one instead of holding them, as files from before M11.8 did.
   */
  private readonly policyLoad = resource({
    params: () => {
      const provider = this.provider();
      return provider.policiesUrl && !provider.policies ? provider.id : undefined;
    },
    loader: ({ params }) => this.policyFiles.load(params),
  });
  /** Its terms and policies for this plan, as they apply where the user lives (core's planPolicies). */
  protected readonly policies = computed(() => {
    const saved = this.settings.saved();
    const data = this.catalog.catalog();
    if (!saved || !data) return undefined;
    const provider = this.provider();
    const load = this.policyLoad.hasValue() ? this.policyLoad.value() : undefined;
    const [policies, sets] =
      load?.status === 'ready' ? [load.policies, load.sets] : [provider.policies, data.policySets];
    return (
      policies &&
      planPolicies(
        { ...provider, policies },
        this.plan().id,
        saved.country,
        data.policyTopics,
        sets,
      )
    );
  });
  /** Why its Terms and policies aren't shown yet: they're loading, or out of reach the first time (M11.8). */
  protected readonly policyNote = computed(() => {
    if (this.policyLoad.isLoading()) return 'Loading its terms and policies…';
    const load = this.policyLoad.hasValue() ? this.policyLoad.value() : undefined;
    if (load?.status === 'offline') {
      return 'Its terms and policies need a connection the first time: they’ll show once you’re online.';
    }
    if (load?.status === 'failed') return 'Its terms and policies couldn’t be loaded.';
    return undefined;
  });
  /** Back online, Terms and policies that were out of reach load. */
  protected retryPolicies(): void {
    const load = this.policyLoad.hasValue() ? this.policyLoad.value() : undefined;
    if (load?.status === 'offline') this.policyLoad.reload();
  }
  /** Outside raters' labels by subject (M11.2): each with its date and a link to the rater's page, never its text. */
  protected readonly outside = computed(() =>
    outsideRatings(this.provider(), this.catalog.catalog()?.raters),
  );
  /** The company behind it, and its own page that says so (M11.2). */
  protected readonly owner = computed(() => {
    const owner = this.provider().owner;
    return owner && ownerCitation(owner);
  });
  /** Where that company is from (the owner's choice, 2026-11-03), by name, and its own page when it has one. */
  protected readonly ownerCountry = computed(() => {
    const country = this.owner()?.country;
    return country && { name: countryName(country.code), cited: country.cited };
  });
  /**
   * How a buyer where the user lives can pay it (M11.5), a line of chips per page that says so. A card shows the
   * networks a page names there, or says no page names them (the owner's wording, 2026-11-03).
   */
  protected readonly payment = computed((): PayLine[] => {
    const country = this.settings.saved()?.country;
    if (!country) return [];
    const networks = acceptedNetworksIn(this.provider(), country);
    return paymentMethodsIn(this.provider(), country).map((entry) => ({
      chips: entry.methods.map((method) => payChip(method, networks)),
      cited: { ...citedFact(entry), lead: 'according to its ' },
    }));
  });
  /** The currencies they can pay it in beyond its price lists (M11.5), each with its page. */
  protected readonly currencies = computed((): CitedLine[] => {
    const country = this.settings.saved()?.country;
    return (country ? currenciesIn(this.provider(), country) : []).map((entry) => ({
      text: this.currenciesText(entry),
      cited: citedFact(entry),
    }));
  });
  /** The user's country, for how an account's money is written (M11.10). */
  protected readonly countryCode = computed(() => this.settings.saved()?.country);
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
  /** Where its source code is (M11.5), its host's chip, and its own page that links it. */
  protected readonly repo = computed(() => {
    const repo = this.provider().sourceRepo;
    return (
      repo && {
        url: repo.url,
        label: repositoryLabel(repo.url),
        host: hostChip(repo.url),
        page: repo.page.name,
        href: quoteLink(repo.page.url, repo.quotes),
        quotes: repo.quotes,
      }
    );
  });
  /**
   * Its Terms and policies' grades at a glance (Overview and Terms): how many ratings have each, "7 Great", then how
   * many have none, "3 not graded", and how many there are in all.
   */
  protected readonly grades = computed(() => {
    const policies = this.policies();
    if (!policies) return undefined;
    const counts = policyGradeCounts(policies).map(({ tier, count }) => ({
      tier,
      count,
      words: `${count} ${tier === 'none' ? 'not graded' : tierNames[tier]}`,
    }));
    return {
      counts,
      total: counts.reduce((total, { count }) => total + count, 0),
      /** The bar's slices, one a rating, in the counts' order. */
      slices: counts.flatMap(({ tier, count }) => Array.from({ length: count }, () => tier)),
    };
  });
  /** Its owner and ways to pay at a glance (Overview): the first few chips, and how many more Facts shows. */
  protected readonly glance = computed(() => {
    const chips = this.payment()
      .flatMap((line) => line.chips)
      .filter((chip, index, all) => all.findIndex((other) => other.name === chip.name) === index);
    const owner = this.owner();
    return {
      heading:
        owner && chips.length > 0 ? 'Owner and ways to pay' : owner ? 'Owner' : 'Ways to pay',
      chips: chips.slice(0, glancedChips),
      more: Math.max(0, chips.length - glancedChips),
    };
  });
  /** The tabs with something to show, Overview always; Features with how many it lists. */
  protected readonly tabs = computed(() => {
    const extras = this.extras();
    const shows: Record<DetailsTab, boolean> = {
      overview: true,
      features:
        this.featureCount() > 0 ||
        this.perks().length > 0 ||
        (extras?.addOns.length ?? 0) > 0 ||
        (extras?.bundles.length ?? 0) > 0,
      terms: !!this.policies() || !!this.policyNote() || this.outside().length > 0,
      facts:
        !!extras?.suite ||
        !!this.owner() ||
        this.payment().length > 0 ||
        this.currencies().length > 0 ||
        !!this.renewal() ||
        !!this.repo() ||
        !!this.plan().notes ||
        !!this.provider().notes,
    };
    return (Object.keys(tabNames) as DetailsTab[])
      .filter((tab) => shows[tab])
      .map((tab) => ({
        id: tab,
        name: tabNames[tab],
        count: tab === 'features' ? this.featureCount() : 0,
      }));
  });
  /** The tab shown: the one chosen, or Overview when that one has nothing to show any more. */
  protected readonly current = computed(() => {
    const chosen = this.selected();
    return this.tabs().some(({ id }) => id === chosen) ? chosen : 'overview';
  });
  /** What the tab list is called: "Proton Unlimited details". */
  protected readonly tabsLabel = computed(
    () => `${planTitle(this.provider().name, this.plan().name)} details`,
  );

  /** Shows a tab's panel, rendering it the first time; `focus` moves to its tab, as arrow keys and See all do. */
  protected select(tab: DetailsTab, focus = false): void {
    this.selected.set(tab);
    this.visited.update((seen) => (seen.has(tab) ? seen : new Set([...seen, tab])));
    // By the DOM, not viewChildren: that would put its code in the initial bundle, which nothing else uses it in.
    if (focus)
      this.host.nativeElement.querySelector<HTMLElement>(`#${this.id}-tab-${tab}`)?.focus();
  }

  /**
   * The tab list's keys (WAI-ARIA's tabs pattern, selection following focus): an arrow moves to the next or previous
   * tab, wrapping round, and Home and End to the first and last.
   */
  protected tabKey(event: KeyboardEvent, index: number): void {
    const tabs = this.tabs();
    const moves: Partial<Record<string, number>> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    this.select(tabs[(next + tabs.length) % tabs.length].id, true);
  }
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
  private methodsText(methods: PaymentMethods[number]['methods']): string {
    return listText(
      methods.map((method) => paymentMethodNames[method]),
      'and',
    );
  }

  /** "Cash in EUR, USD or CAD", or "Pay in USD or CAD" for every way to pay. */
  private currenciesText({ codes, methods }: CurrenciesEntry): string {
    const currencies = listText(codes, 'or');
    return methods ? `${this.methodsText(methods)} in ${currencies}` : `Pay in ${currencies}`;
  }

  /** A citation's tooltip when it links one page: the words it quotes there. */
  protected quotesText(quotes: readonly string[]): string {
    return quotes.map((quote) => `“${quote}”`).join(' ');
  }

  /** What a suite includes, in a line (Overview): "Mail Plus, Drive Plus, VPN Plus and Pass Plus". */
  protected includedList({ includes }: SuiteContents): string {
    return listText(
      includes.map((entry) => this.includedName(entry)),
      'and',
    );
  }

  protected includedName({ provider, plan }: SuiteContents['includes'][number]): string {
    return plan ? planTitle(provider.name, plan.name) : provider.name;
  }
}

/** A ways-to-pay or currencies entry's page, scrolled to the words that name them. */
function citedFact({ page, url, quotes }: CurrenciesEntry | PaymentMethods[number]): CitedFact {
  return { page, href: quoteLink(url, quotes), quotes };
}

/** A repository's host as a chip: GitHub's mark, say, named GitHub. */
function hostChip(url: string): PayChip {
  const { name, glyph } = hostGlyph(url);
  return { name, glyphs: [glyph] };
}

/**
 * A way to pay's chip. A card's carries the networks a page names where the user lives ("Card: Visa or Interac", each
 * by its mark, or by name when it has none), or "networks not verified" when no page names them.
 */
function payChip(method: PaymentMethod, networks: readonly CardNetwork[] | undefined): PayChip {
  const glyph = methodGlyphs[method];
  const own = glyph ? [glyph] : [];
  if (method !== 'card') return { name: paymentMethodNames[method], glyphs: own };
  if (!networks) {
    return {
      name: `${paymentMethodNames.card} (networks not verified)`,
      glyphs: own,
      words: 'networks not verified',
    };
  }
  const marks = networks.flatMap((network) => {
    const mark = networkGlyphs[network];
    return mark ? [mark] : [];
  });
  const unmarked = networks
    .filter((network) => !networkGlyphs[network])
    .map((network) => cardNetworkNames[network]);
  return {
    name: `${paymentMethodNames.card}: ${listText(
      networks.map((network) => cardNetworkNames[network]),
      'or',
    )}`,
    glyphs: [...own, ...marks],
    ...(unmarked.length > 0 ? { words: unmarked.join(', ') } : {}),
  };
}

/** "A, B and C" (or "or"). */
function listText(items: readonly string[], conjunction: 'and' | 'or'): string {
  return items.length > 1
    ? `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`
    : (items[0] ?? '');
}

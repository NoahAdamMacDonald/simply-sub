import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatOption, MatSelect } from '@angular/material/select';
import {
  catalogIconFile,
  monthOf,
  pickPrice,
  searchCatalog,
  tagColorPresets,
  type CatalogResult,
  type FeatureSummaryRow,
  type FxRates,
  type Interval,
  type IsoDate,
  type PickedPrice,
  type Price,
  type Rank,
  type RankCounts as Counts,
  type RankKey,
  type Tag,
} from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { ClockService } from '../../core/clock/clock-service';
import { FxStore } from '../../core/fx/fx-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { ItemsRepository } from '../../core/storage/items-repository';
import { TagsRepository } from '../../core/storage/tags-repository';
import { BudgetBar } from '../../shared/budget-bar/budget-bar';
import { ConfirmService } from '../../shared/confirm/confirm-service';
import { EmptyState } from '../../shared/empty-state/empty-state';
import { FeatureList } from '../../shared/feature-list/feature-list';
import { FeatureSummary } from '../../shared/feature-summary/feature-summary';
import { MiniCalendar, type CalendarCharge } from '../../shared/mini-calendar/mini-calendar';
import { PageHeader } from '../../shared/page-header/page-header';
import { PriceTag } from '../../shared/price-tag/price-tag';
import { amountText, intervalText } from '../../shared/price-tag/price-text';
import { ProviderIcon } from '../../shared/provider-icon/provider-icon';
import { RankChip } from '../../shared/rank/rank-chip';
import { RankCounts } from '../../shared/rank/rank-counts';
import { RankDot } from '../../shared/rank/rank-dot';
import { RankSelect } from '../../shared/rank/rank-select';
import { rankNames } from '../../shared/rank/rank-text';
import { SplitButton, type SplitButtonItem } from '../../shared/split-button/split-button';
import { StatusBadge, type BadgeStatus } from '../../shared/status-badge/status-badge';
import { SubCard } from '../../shared/sub-card/sub-card';
import { TagChip } from '../../shared/tags/tag-chip';
import { TagPicker } from '../../shared/tags/tag-picker';

/** GET /fx's example rates, so the fixed cases convert the same way on every visit. */
const exampleRates: FxRates = {
  base: 'CAD',
  date: '2026-10-21',
  source: 'European Central Bank via Frankfurter',
  rates: { EUR: 0.664, GBP: 0.5571, USD: 0.7243 },
};

interface PriceCase {
  name: string;
  price: PickedPrice;
  /** ListItem.region, for an item bought outside the user's country. */
  region?: string;
}

interface BarCase {
  name: string;
  value: number;
  max: number;
  marker?: number;
  labelMode: 'percent' | 'amount';
}

const barCases: BarCase[] = [
  { name: 'Half the monthly budget', value: 100, max: 200, labelMode: 'percent' },
  { name: 'A short fill', value: 24, max: 200, labelMode: 'percent' },
  { name: 'Almost nothing', value: 4, max: 200, labelMode: 'percent' },
  { name: 'Amber from 75%', value: 160, max: 200, labelMode: 'percent' },
  { name: 'Exactly the budget', value: 200, max: 200, labelMode: 'percent' },
  { name: 'Over the budget', value: 224, max: 200, labelMode: 'percent' },
  { name: 'Calendar: over the budget', value: 44.45, max: 66.45, marker: 60, labelMode: 'amount' },
  { name: 'Calendar: well within it', value: 10, max: 40, marker: 60, labelMode: 'amount' },
  { name: 'Calendar: no payments', value: 0, max: 0, marker: 60, labelMode: 'amount' },
];

const statusCases: { name: string; status: BadgeStatus; nextCharge?: IsoDate; lists?: number }[] = [
  { name: 'Active', status: { kind: 'active', manual: false } },
  { name: 'Ending', status: { kind: 'active', endsOn: '2026-11-03', manual: false } },
  {
    name: 'Manual renewal',
    status: { kind: 'active', manual: true },
    nextCharge: '2026-11-03',
  },
  { name: 'Starts later', status: { kind: 'inactive', activeFrom: '2027-09-10', manual: false } },
  { name: 'Inactive', status: { kind: 'inactive', manual: false } },
  { name: 'In two lists (Search)', status: { kind: 'active', manual: false }, lists: 2 },
  { name: 'Not listed (Search)', status: { kind: 'not-listed' } },
];

const rankCounts: Counts = {
  essential: 1,
  critical: 0,
  needed: 2,
  wanted: 4,
  uses: 2,
  sometimes: 1,
  unused: 2,
  unwanted: 1,
};

const noCounts: Counts = {
  essential: 0,
  critical: 0,
  needed: 0,
  wanted: 0,
  uses: 0,
  sometimes: 0,
  unused: 0,
  unwanted: 0,
};

const summaryRows: FeatureSummaryRow[] = [
  { key: 'vpn.included', label: 'VPN', active: 2, total: 3 },
  { key: 'video.quality=1080p', label: '1080p', active: 6, total: 10 },
  { key: 'video.quality=4k', label: '4k', active: 2, total: 5 },
  { key: 'ai.assistant', label: 'AI', active: 1, total: 3 },
];

/** Ranks for the feature list, as if the user had set them. */
const exampleRanks: Partial<Record<RankKey, Rank>> = {
  'streaming.ad-free': 'essential',
  'video.quality=1080p': 'wanted',
  'video.quality=4k': 'uses',
  'streaming.concurrent-streams=2-4': 'needed',
  'vpn.included': 'needed',
  'vpn.kill-switch': 'critical',
  'vpn.protocols=wireguard': 'wanted',
  'password-manager': 'wanted',
  'password-manager.item-types=passkey': 'unwanted',
};

const exportItems: SplitButtonItem[] = [
  { id: 'ics', label: 'Calendar (.ics)', icon: 'calendar_month' },
  { id: 'csv', label: 'Payment schedule (.csv)', icon: 'table' },
  { id: 'xlsx', label: 'Excel (.xlsx)', icon: 'grid_on' },
];

const syncItems: SplitButtonItem[] = [
  { id: 'google', label: 'Google Calendar' },
  { id: 'apple', label: 'Apple Calendar' },
  { id: 'proton', label: 'Proton Calendar' },
];

/** The presets as tags, to show every colour; their ids aren't stored records'. */
const presetTags: Tag[] = tagColorPresets.map(({ name, color }, index) => ({
  id: `preset-${index}`,
  name,
  color,
  createdAt: '2026-10-26T12:00:00.000Z',
  updatedAt: '2026-10-26T12:00:00.000Z',
}));

/**
 * The shared components (PROJECT-PLAN §4.3) with hand-made inputs and the user's settings, in development builds
 * only (dev-routes.ts). Check it in both themes, at 360 and 1280 px, by keyboard and with axe (M4.5).
 */
@Component({
  selector: 'ss-components-page',
  imports: [
    BudgetBar,
    EmptyState,
    FeatureList,
    FeatureSummary,
    MatButton,
    MatFormField,
    MatLabel,
    MatOption,
    MatSelect,
    MiniCalendar,
    PageHeader,
    PriceTag,
    ProviderIcon,
    RankChip,
    RankCounts,
    RankDot,
    RankSelect,
    SplitButton,
    StatusBadge,
    SubCard,
    TagChip,
    TagPicker,
  ],
  templateUrl: './components-page.html',
  styleUrl: './components-page.scss',
})
export class ComponentsPage {
  private readonly settings = inject(SettingsStore);
  private readonly catalog = inject(CatalogStore);
  private readonly fx = inject(FxStore);
  private readonly confirmService = inject(ConfirmService);
  private readonly items = inject(ItemsRepository);
  private readonly today = inject(ClockService).today;

  protected readonly saved = this.settings.saved;
  protected readonly picked = signal('');

  /** One price per case, picked for the user's region and currency with the example rates. */
  protected readonly cases = computed<PriceCase[]>(() => {
    const saved = this.saved();
    if (!saved) return [];
    const { country: region, currency } = saved;
    // fx null: no rates, as on a first visit with /fx down.
    const pick = (price: Price, fx: FxRates | null = exampleRates) =>
      pickPrice([price], { region, currency, ...(fx && { fx }) })[0];
    return [
      { name: 'In your currency', price: pick(listed(region, currency, 18.99)) },
      { name: 'Converted', price: pick(listed('GLOBAL', 'EUR', 5)) },
      {
        name: 'Includes tax everywhere (Mullvad)',
        price: pick({ ...listed('GLOBAL', 'EUR', 5), taxIncluded: { quote: 'Including VAT.' } }),
      },
      { name: 'No exchange rate yet', price: pick(listed('GLOBAL', 'USD', 9.99), null) },
      { name: 'Free', price: pick(listed(region, currency, 0)) },
      { name: 'Yearly', price: pick(listed(region, currency, 169.99, 'year')) },
      { name: 'Every 3 months', price: pick(listed(region, currency, 45, 'month', 3)) },
      { name: 'Every 30 days', price: pick(listed(region, currency, 12, 'day', 30)) },
      {
        name: 'Bought in the US',
        price: pickPrice([listed('US', 'USD', 7.99)], {
          region: 'US',
          currency,
          fx: exampleRates,
        })[0],
        region: 'US',
      },
    ];
  });

  /** Every plan in the user's catalog, with its prices picked with the live rates. */
  protected readonly plans = computed(() => {
    const saved = this.saved();
    const data = this.catalog.catalog();
    if (!saved || !data) return [];
    const fx = this.fx.rates();
    return data.providers.flatMap((provider) =>
      provider.plans.map((plan) => ({
        id: plan.id,
        name: `${provider.name} · ${plan.name}`,
        plan,
        prices: pickPrice(plan.prices, {
          region: saved.country,
          currency: saved.currency,
          ...(provider.billingCurrency && { billingCurrency: provider.billingCurrency }),
          ...(fx && { fx }),
        }),
      })),
    );
  });

  /** Which rates the catalog's prices were converted with: the gallery's fixed cases use the example ones. */
  protected readonly ratesNote = computed(() => {
    const rates = this.fx.rates();
    return rates
      ? `Converted with the rates of ${rates.date} (${rates.source}).`
      : 'No exchange rates yet, so prices in other currencies stay in their own. On ng serve, start the API too (npm run dev:api).';
  });

  protected pick(price: PickedPrice): void {
    const amount = amountText(price.amount, price.currency, this.saved()?.country);
    this.picked.set(`Picked ${amount} ${intervalText(price.interval, price.intervalCount)}`);
  }

  // ss-budget-bar
  protected readonly barCases = barCases;

  // ss-provider-icon: the catalog's own icons, as ResolvedItem.iconUrl gives them (PROJECT-PLAN §3.4).
  protected readonly providers = computed(() =>
    (this.catalog.catalog()?.providers ?? []).map((provider) => ({
      id: provider.id,
      name: provider.name,
      ...(provider.iconUrl && { src: `icons/${catalogIconFile(provider.id)}` }),
    })),
  );

  // ss-status-badge
  protected readonly statusCases = statusCases;

  // ss-rank-dot, ss-rank-chip, ss-rank-select, ss-rank-counts
  protected readonly ranks = Object.keys(rankNames) as Rank[];
  protected readonly adFreeRank = signal<Rank | undefined>('needed');
  protected readonly qualityOverride = signal<Rank | undefined>(undefined);
  protected readonly streamsOverride = signal<Rank | undefined>('essential');
  protected readonly rankCounts = rankCounts;
  protected readonly noCounts = noCounts;

  protected rankValue(rank: Rank | undefined): string {
    return rank === undefined ? 'none (profile default)' : rank;
  }

  // ss-feature-summary, ss-feature-list
  protected readonly summaryRows = summaryRows;
  protected readonly exampleRanks = exampleRanks;
  /** The plan with the most features to start with: Proton's suites show groups and their features. */
  protected readonly featurePlanId = linkedSignal(() => {
    const richest = [...this.plans()].sort(
      (a, b) => Object.keys(b.plan.features).length - Object.keys(a.plan.features).length,
    )[0];
    return richest?.id;
  });
  protected readonly featurePlan = computed(
    () => this.plans().find((entry) => entry.id === this.featurePlanId())?.plan,
  );

  // ss-sub-card: the catalog as Search shows it with no text, then its first provider as if it weren't sold here.
  protected readonly subCards = computed<CatalogResult[]>(() => {
    const saved = this.saved();
    const data = this.catalog.catalog();
    if (!saved || !data) return [];
    const fx = this.fx.rates();
    const results = searchCatalog(
      {},
      {
        catalog: data,
        settings: saved,
        ...(fx && { fx }),
        items: this.items.records(),
        today: this.today(),
      },
    );
    const [first] = data.providers;
    const notOffered: CatalogResult[] = first
      ? [{ kind: 'not-offered', provider: first, matchedOn: ['name'], relevance: 1 }]
      : [];
    return [...results, ...notOffered];
  });

  // ss-mini-calendar: payments made up for whichever month is shown.
  protected readonly calendarMonth = linkedSignal(() => monthOf(this.today()));
  protected readonly calendarCharges = computed<CalendarCharge[]>(() => {
    const month = this.calendarMonth();
    const currency = this.saved()?.currency ?? 'CAD';
    return [
      {
        date: `${month}-03`,
        name: 'Mullvad VPN',
        amount: 7.53,
        currency,
        converted: true,
        manual: true,
      },
      { date: `${month}-12`, name: 'Netflix', amount: 18.99, currency },
      { date: `${month}-12`, name: 'Crave', amount: 22, currency },
      { date: `${month}-15`, name: 'Proton Unlimited', amount: 17.93, currency, converted: true },
      { date: `${month}-28`, name: 'Disney+', amount: 16.99, currency },
    ];
  });
  protected readonly calendarEvent = signal('');

  // ss-tag-chip, ss-tag-picker
  protected readonly tags = inject(TagsRepository).records;
  protected readonly presetTags = presetTags;
  protected readonly tagIds = signal<readonly string[]>([]);
  protected readonly chosenTags = computed(() => {
    const byName = new Map(this.tags().map((tag) => [tag.id, tag.name]));
    const names = this.tagIds().map((id) => byName.get(id) ?? id);
    return names.length ? names.join(', ') : 'none';
  });

  // ss-split-button
  protected readonly exportItems = exportItems;
  protected readonly syncItems = syncItems;
  protected readonly splitAction = signal('');

  // ss-confirm
  protected readonly confirmResult = signal('');

  protected async confirm(danger: boolean): Promise<void> {
    const confirmed = await this.confirmService.confirm(
      danger
        ? {
            title: 'Delete “Work Related”?',
            message: 'Its 12 subscriptions will be removed.',
            confirmText: 'Delete list',
            danger: true,
          }
        : {
            title: 'Apply this suggestion?',
            message: 'Netflix Standard becomes Standard with ads in your draft of Work Related.',
            confirmText: 'Apply',
          },
    );
    this.confirmResult.set(confirmed ? 'Confirmed' : 'Cancelled');
  }
}

function listed(
  region: string,
  currency: string,
  amount: number,
  interval: Interval = 'month',
  intervalCount = 1,
): Price {
  return {
    region,
    currency,
    amount,
    interval,
    intervalCount,
    autoRenew: true,
    lastVerified: '2026-10-20',
  };
}

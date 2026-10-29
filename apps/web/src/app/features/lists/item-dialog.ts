import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  FormField,
  FormRoot,
  form,
  validateTree,
  type FieldTree,
  type ReadonlyFieldTree,
} from '@angular/forms/signals';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import {
  MatDatepicker,
  MatDatepickerInput,
  MatDatepickerToggle,
} from '@angular/material/datepicker';
import { MatError, MatFormField, MatHint, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import { MatOption, MatSelect, MatSelectTrigger } from '@angular/material/select';
import {
  addPeriods,
  afterPlanChange,
  availability,
  bestCard,
  billingDayChoices,
  cardChoices,
  cardNetworkNames,
  cardTitle,
  draftItems,
  emptyWindow,
  filterRanking,
  intervalSchema,
  isDuplicate,
  itemFormFor,
  itemFormIssues,
  itemFromForm,
  itemTitle,
  monthlyAverage,
  monthlyOnCard,
  monthlyParts,
  namesText,
  newItemForm,
  periodChoices,
  periodOf,
  periodText,
  pickPrice,
  planTitle,
  rankChanges,
  rankSiblings,
  rankingSections,
  renewalAfterPeriodChange,
  samePeriod,
  sharedRankEdits,
  sharedRanksFor,
  taxAddedRegions,
  typedPrice,
  type BillingDay,
  type CatalogData,
  type CustomSubscription,
  type Interval,
  type ItemForm,
  type ItemFormContext,
  type ListDraft,
  type ListItem,
  type Period,
  type PickedPrice,
  type PriceContext,
  type Rank,
  type RankKey,
  type RankingEntry,
  type RankingRow,
  type RequestedPrice,
  type RewardsContext,
  type SnapshotProvider,
} from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { ClockService } from '../../core/clock/clock-service';
import { FxStore } from '../../core/fx/fx-store';
import { ListDraftService } from '../../core/lists/list-draft-service';
import { MetricsService } from '../../core/metrics/metrics-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { CardsRepository } from '../../core/storage/cards-repository';
import { CustomSubsRepository } from '../../core/storage/custom-subs-repository';
import { RankingsRepository } from '../../core/storage/rankings-repository';
import { TagsRepository } from '../../core/storage/tags-repository';
import { ConfirmService } from '../../shared/confirm/confirm-service';
import { CalendarHeader } from '../../shared/calendar-header';
import { nearDateText } from '../../shared/charge-text';
import { focusFirstError } from '../../shared/focus-first-error';
import { isoDateProviders } from '../../shared/iso-date-adapter';
import { issueErrors } from '../../shared/form-issues';
import { countryChoices, currencyChoices } from '../../shared/place-choices';
import { PriceTag } from '../../shared/price-tag/price-tag';
import { amountText, intervalSpoken, intervalText } from '../../shared/price-tag/price-text';
import { ProviderIcon } from '../../shared/provider-icon/provider-icon';
import { RankSelect } from '../../shared/rank/rank-select';
import { catalogIcon } from '../../shared/sub-card/card-text';
import { TagPicker } from '../../shared/tags/tag-picker';
import { fillScreenWhenNarrow } from '../../shared/wide-dialog';
import { ChoiceField } from '../../shared/choice-field/choice-field';

/** What the dialog opens on: a plan, bundle or custom subscription to add, at a period, or an item to change. */
export type ItemDialogRequest =
  | { kind: 'plan'; planId: string; period: Period; ownPrice?: RequestedPrice }
  | { kind: 'bundle'; bundleId: string; period: Period }
  | { kind: 'custom'; customSubId: string }
  | { kind: 'item'; item: ListItem };

export interface ItemDialogData {
  listId: string;
  /** The list's name, for "Already in this list". */
  listName: string;
  request: ItemDialogRequest;
  /**
   * The list's draft as the editor had it when it opened the dialog: the drafts' live query can come a moment after
   * the draft was started, and the dialog's first ranks need its items then (M6.14).
   */
  draft: ListDraft;
}

/**
 * What was saved to the draft: the item's id, what it's called ("Netflix Standard"), whether it's new, and how many of
 * its provider's other plans in the list took its rank changes (M6.14).
 */
export interface ItemDialogResult {
  itemId: string;
  title: string;
  added: boolean;
  shared: number;
}

/** A choice in a menu, as it shows ("Standard — $18.99 / mo") and as it's read ("Standard, $18.99 a month"). */
interface ChoiceText {
  shown: string;
  spoken: string;
}

const intervalNames: Record<Interval, string> = {
  day: 'Days',
  week: 'Weeks',
  month: 'Months',
  year: 'Years',
};

let nextId = 0;

/**
 * The item dialog (PROJECT-PLAN P6), which the list editor (P5) opens to add a plan, a bundle or a custom subscription
 * to its draft, or to change an item there. Core decides the rules (item-form.ts): the periods the plan is priced for
 * where it's bought, the suggested renewal and the billing day, the windows of Specific dates, what must be right
 * before it's saved, and the item it saves. A free plan has nothing to bill. Add asks first when the plan is in the
 * list already, and saves to the draft through ListDraftService. Under 600 px it fills the screen.
 */
@Component({
  selector: 'ss-item-dialog',
  imports: [
    ChoiceField,
    FormField,
    FormRoot,
    MatButton,
    MatCheckbox,
    MatDatepicker,
    MatDatepickerInput,
    MatDatepickerToggle,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatError,
    MatFormField,
    MatHint,
    MatIcon,
    MatIconButton,
    MatInput,
    MatLabel,
    MatOption,
    MatRadioButton,
    MatRadioGroup,
    MatSelect,
    MatSelectTrigger,
    MatSuffix,
    PriceTag,
    ProviderIcon,
    RankSelect,
    TagPicker,
  ],
  templateUrl: './item-dialog.html',
  styleUrl: './item-dialog.scss',
  providers: isoDateProviders,
})
export class ItemDialog {
  private readonly data = inject<ItemDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<ItemDialog, ItemDialogResult>>(MatDialogRef);
  private readonly catalogStore = inject(CatalogStore);
  private readonly settings = inject(SettingsStore);
  private readonly fx = inject(FxStore);
  private readonly customSubs = inject(CustomSubsRepository);
  private readonly cards = inject(CardsRepository);
  private readonly rankings = inject(RankingsRepository);
  private readonly tags = inject(TagsRepository);
  private readonly metrics = inject(MetricsService);
  private readonly drafts = inject(ListDraftService);
  private readonly confirmer = inject(ConfirmService);
  private readonly today = inject(ClockService).today;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly billedSelect = viewChild<MatSelect>('billed');
  private readonly addWindowButton = viewChild('addWindowButton', { read: ElementRef });

  /** The item being changed; undefined when one is being added. */
  protected readonly editing =
    this.data.request.kind === 'item' ? this.data.request.item : undefined;
  protected readonly heading = this.editing ? 'Edit subscription' : 'Add subscription';
  protected readonly ids = `ss-item-dialog-${nextId++}`;
  /** The datepickers' header, whose month and year button is named by what it shows. */
  protected readonly calendarHeader = CalendarHeader;
  protected readonly countries = countryChoices;
  protected readonly currencies = currencyChoices;
  protected readonly intervals = intervalSchema.options.map((interval) => ({
    interval,
    name: intervalNames[interval],
  }));

  protected readonly country = computed(() => this.settings.saved()?.country ?? '');
  private readonly currency = computed(() => this.settings.saved()?.currency ?? '');

  protected readonly model = signal<ItemForm>(this.initialForm());
  /** Its ranks when the dialog opened: what Save compares them with, to share the changes (M6.14). */
  private readonly startRanks = this.model().rankOverrides;
  /** The keys this subscription ranked when the dialog opened, whose groups start open. */
  private readonly rankedAtStart = new Set(Object.keys(this.model().rankOverrides));
  /** Groups opened or closed since, by their category id. */
  private readonly toggledGroups = signal<ReadonlyMap<string, boolean>>(new Map());
  /** The period the suggested renewal was last worked out for (followPeriod). */
  private renewalPeriod: Period = periodOf(this.model());

  /** The catalog file for where it's bought, once it's downloaded. */
  private readonly regionCatalog = computed(() =>
    this.catalogStore.catalogFor(this.model().region),
  );
  /** The catalog to name things from: the region's file, else the user's country's while it downloads. */
  private readonly catalog = computed(() => this.regionCatalog() ?? this.catalogStore.catalog());
  /** The region's prices haven't downloaded yet (a custom plan has its own). */
  protected readonly pricesPending = computed(
    () => this.model().kind !== 'custom' && this.regionCatalog() === undefined,
  );

  private readonly priceContext = computed<PriceContext>(() => {
    const fx = this.fx.rates();
    const billingCurrency = this.provider()?.billingCurrency;
    return {
      region: this.model().region,
      currency: this.currency(),
      ...(billingCurrency && { billingCurrency }),
      ...(fx && { fx }),
    };
  });

  /** A catalog plan's provider, or a bundle's seller. */
  protected readonly provider = computed<SnapshotProvider | undefined>(() => {
    const { kind, planId } = this.model();
    const catalog = this.catalog();
    if (kind === 'catalog') {
      return catalog?.providers.find((provider) =>
        provider.plans.some((plan) => plan.id === planId),
      );
    }
    if (kind === 'bundle') {
      return catalog?.providers.find((provider) => provider.id === this.bundle()?.soldBy);
    }
    return undefined;
  });
  protected readonly plan = computed(() =>
    this.provider()?.plans.find((plan) => plan.id === this.model().planId),
  );
  protected readonly bundle = computed(() =>
    this.model().kind === 'bundle'
      ? this.catalog()?.bundles.find((bundle) => bundle.id === this.model().bundleId)
      : undefined,
  );
  protected readonly customSub = computed<CustomSubscription | undefined>(() =>
    this.model().kind === 'custom'
      ? this.customSubs.byId().get(this.model().customSubId)
      : undefined,
  );
  private readonly customPlan = computed(() =>
    this.customSub()?.plans.find((plan) => plan.id === this.model().planId),
  );

  /** What the dialog shows it's about: the provider's, bundle's or custom subscription's name and icon. */
  protected readonly subject = computed(() => {
    const provider = this.provider();
    const bundle = this.bundle();
    const sub = this.customSub();
    if (bundle) return { name: bundle.name, iconUrl: provider && catalogIcon(provider) };
    if (sub) return { name: sub.name, iconUrl: this.preview()?.iconUrl };
    return {
      name: provider?.name ?? this.model().planId,
      iconUrl: provider && catalogIcon(provider),
    };
  });

  /** What the item is called: "Netflix Standard", "Netflix and Crave". */
  private readonly title = computed(() => {
    const plan = this.plan();
    const custom = this.customPlan();
    if (this.bundle()) return this.subject().name;
    if (custom) return planTitle(this.subject().name, custom.name);
    return plan ? planTitle(this.subject().name, plan.name) : this.model().planId;
  });

  /** The bundle's plans, shown and not changed (P6): "Netflix Standard". */
  protected readonly bundlePlans = computed(() => {
    const catalog = this.catalog();
    return (this.bundle()?.includes ?? []).map((planId) => {
      const provider = catalog?.providers.find((candidate) =>
        candidate.plans.some((plan) => plan.id === planId),
      );
      const plan = provider?.plans.find((candidate) => candidate.id === planId);
      return provider && plan ? planTitle(provider.name, plan.name) : planId;
    });
  });

  /**
   * The plans the Plan menu offers, each with its price for the period chosen, or its first: the provider's that are
   * sold where it's bought, and the one chosen; a custom subscription's.
   */
  protected readonly planChoices = computed(() => {
    const context = this.priceContext();
    const provider = this.provider();
    const sub = this.customSub();
    const plans: { id: string; name: string; prices: PickedPrice[] }[] = provider
      ? provider.plans
          .filter(
            (plan) =>
              plan.id === this.model().planId ||
              availability(plan.prices, provider, context.region) !== 'not-offered',
          )
          .map((plan) => ({
            id: plan.id,
            name: plan.name,
            prices: pickPrice(plan.prices, context),
          }))
      : (sub?.plans ?? []).map((plan) => ({
          id: plan.id,
          name: plan.name,
          prices: [typedPrice(plan.price, plan.autoRenewAvailable, context)],
        }));
    return plans.map(({ id, name, prices }) => {
      const price = prices.find((candidate) => samePeriod(candidate, this.model())) ?? prices[0];
      return {
        id,
        text: price ? this.choiceText(name, price, true) : { shown: name, spoken: name },
      };
    });
  });
  protected readonly chosenPlanText = computed(
    () => this.planChoices().find((choice) => choice.id === this.model().planId)?.text,
  );

  /** The chosen plan's or bundle's prices where it's bought, one per period, or a custom plan's own. */
  private readonly prices = computed<PickedPrice[]>(() => {
    const context = this.priceContext();
    const custom = this.customPlan();
    if (custom) return [typedPrice(custom.price, custom.autoRenewAvailable, context)];
    const prices = this.bundle()?.prices ?? this.plan()?.prices;
    return prices && !this.pricesPending() ? pickPrice(prices, context) : [];
  });
  /**
   * The periods it can be billed for. Undefined for any: a custom plan, prices still downloading, or a plan that's left
   * the catalog, whose item can still be changed.
   */
  private readonly periods = computed(() => {
    if (this.model().kind === 'custom' || this.pricesPending()) return undefined;
    const periods = periodChoices(this.prices());
    return periods.length > 0 ? periods : undefined;
  });
  /** The price for the period chosen. A custom plan has one, whatever it's billed by. */
  private readonly price = computed(() =>
    this.model().kind === 'custom'
      ? this.prices()[0]
      : this.prices().find((price) => samePeriod(price, this.model())),
  );
  /** The picked price is 0: nothing to bill (P6). */
  protected readonly free = computed(() => this.price()?.amount === 0);
  /** Auto-renews is offered only where the price renews by itself (P6). */
  protected readonly autoRenewAvailable = computed(() => {
    const custom = this.customPlan();
    return custom ? custom.autoRenewAvailable : (this.price()?.autoRenew ?? true);
  });

  /** Billed (P6): only the periods the plan is priced for, each with its price. */
  protected readonly periodChoices = computed(() =>
    this.prices().map((price) => ({
      key: periodKey(price),
      text: this.choiceText(capitalized(periodText(price.interval, price.intervalCount)), price),
    })),
  );
  protected readonly chosenPeriodKey = computed(() => periodKey(this.model()));
  protected readonly chosenPeriodText = computed(
    () => this.periodChoices().find((choice) => choice.key === this.chosenPeriodKey())?.text,
  );

  /** The add-ons, each with its price for the period chosen (or its shortest) and how many the plan allows. */
  protected readonly addOns = computed(() => {
    const provider = this.provider();
    const context = this.priceContext();
    const limit = this.plan()?.addOnLimit;
    return this.model().addOns.map((row, index) => {
      const addOn = provider?.addOns?.find((candidate) => candidate.id === row.id);
      const prices = addOn ? pickPrice(addOn.prices, context) : [];
      return {
        index,
        id: row.id,
        name: addOn?.name ?? row.id,
        price: prices.find((price) => samePeriod(price, this.model())) ?? prices[0],
        quantities: limit === undefined || limit < 2 ? [] : range(1, limit),
      };
    });
  });

  /** Ongoing: the days later in the month it can be billed on, when the date is a shorter month's last day. */
  protected readonly billingDays = computed(() => {
    return billingDayChoices(this.model().anchorDate, this.model());
  });
  protected readonly billingDayChoices = computed(() => {
    const days = this.billingDays();
    if (days.length === 0) return [];
    // billingDayChoices offers days only for a real date.
    const own = Number(this.model().anchorDate?.slice(8));
    return [
      { value: 0, text: `the ${ordinal(own)}` },
      ...days.map((day) => ({
        value: day,
        text: `the ${ordinal(day)} (the last day in shorter months)`,
      })),
    ];
  });
  /** The billing day as the choice shows it: the date's own day unless a later one still applies. */
  protected readonly billingDay = computed(() => {
    const day = this.model().billingDay;
    return day !== 0 && this.billingDays().includes(day) ? day : 0;
  });
  /** The next renewal is the one the dialog suggested, which the hint asks to check. */
  protected readonly renewalSuggested = computed(() => {
    const form = this.model();
    return this.validPeriod() && form.anchorDate === addPeriods(this.today(), form);
  });

  /** Where tax is added on top of the price (BLUEPRINT §4.8), so "plus tax" means something. */
  protected readonly taxAdded = computed(() => taxAddedRegions.has(this.model().region));

  private readonly rules = computed(() => ({
    ...(this.periods() && { periods: this.periods() }),
    free: this.free(),
    ...(this.plan()?.addOnLimit !== undefined && { addOnLimit: this.plan()?.addOnLimit }),
  }));

  /** The item as the form has it now, priced as the list's are, for its monthly price and the keys it provides. */
  private readonly preview = computed(() => {
    // Its own ranks don't change its price or what it provides.
    const fields = itemFromForm(
      this.model(),
      this.context(Object.keys(this.model().rankOverrides)),
    );
    const item: ListItem = {
      id: this.editing?.id ?? previewId,
      listId: this.data.listId,
      pinned: false,
      createdAt: previewTime,
      updatedAt: previewTime,
      ...fields,
    };
    const [result] = this.metrics.resolve([item]);
    return result?.ok ? result.resolved : undefined;
  });

  /**
   * The footer's "≈ $18.99 / mo · next charge Nov 12": the monthly equivalent, before tax, with ≈ when it's converted,
   * and the date of its next charge as the form has it (M7.1).
   */
  protected readonly monthly = computed<ChoiceText | undefined>(() => {
    const resolved = this.preview();
    if (!resolved) return undefined;
    if (this.free()) return { shown: 'Free', spoken: 'Free' };
    const average = monthlyAverage([resolved], this.currency());
    if (average.leftOut > 0) return undefined;
    const amount = amountText(average.amount, average.currency, this.country());
    const next = resolved.nextCharge;
    const nextText = next ? ` next charge ${nearDateText(next.date, this.today())}` : '';
    return {
      shown: `${average.approx ? '≈ ' : ''}${amount} / mo${nextText && ` ·${nextText}`}`,
      spoken: `${average.approx ? 'about ' : ''}${amount} a month${nextText && `,${nextText}`}`,
    };
  });

  /** The keys it provides, grouped as the Features page groups them, each with its own rank and the profile's. */
  protected readonly rankGroups = computed(() => {
    const catalog = this.catalog();
    const keys = this.preview()?.providedKeys;
    if (!catalog || !keys) return [];
    const ranks = this.rankings.ranks();
    const sections = filterRanking(rankingSections(catalog.features, catalog.categories.feature), {
      ranks,
      keys: new Set(keys),
    });
    const overrides = this.model().rankOverrides;
    const toggled = this.toggledGroups();
    return sections.map((section) => {
      const rows = section.entries.flatMap(entryRows).map((row) => ({
        key: row.key,
        label: row.label,
        labelId: `${this.ids}-rank-${row.key}`,
        override: Object.hasOwn(overrides, row.key) ? overrides[row.key] : undefined,
        inherited: ranks.get(row.key) ?? ('not-ranked' as const),
      }));
      const id = section.category.id;
      return {
        id,
        name: section.category.name,
        rows,
        /** How many of its keys this subscription ranks itself. */
        ranked: rows.filter((row) => row.override !== undefined).length,
        open: toggled.get(id) ?? rows.some((row) => this.rankedAtStart.has(row.key)),
      };
    });
  });

  /** What the card maths needs (BLUEPRINT §9.3): today, the user's currency and tax place, and the rates. */
  private readonly rewardsContext = computed<RewardsContext | undefined>(() => {
    const saved = this.settings.saved();
    if (!saved) return undefined;
    const fx = this.fx.rates();
    return { today: this.today(), currency: saved.currency, place: saved, ...(fx && { fx }) };
  });

  /**
   * The list's other plans of its provider, priced, with the keys each provides (M6.14): the ones its ranks are shared
   * with, unless either has ranks of its own. A plan that can't be priced has no keys to share.
   */
  private readonly rankSiblings = computed(() => {
    const resolved = this.preview();
    const draft = this.listDraft();
    if (!resolved) return [];
    const self = { id: this.editing?.id ?? previewId, source: resolved.item.source };
    const items = this.metrics.resolve(draftItems(draft)).flatMap((result) =>
      result.ok
        ? [
            {
              item: result.resolved.item,
              providedKeys: result.resolved.providedKeys,
              resolved: result.resolved,
            },
          ]
        : [],
    );
    return rankSiblings(self, items);
  });
  /** What Feature ranks says about sharing: with whom, or that its ranks are its own (M6.14). */
  protected readonly rankSharing = computed(() => {
    const siblings = this.rankSiblings();
    const own = this.model().ownRanks;
    if (siblings.length === 0 && !own) return undefined;
    const names = siblings.map(({ resolved }) => itemTitle(resolved));
    return {
      own,
      text: own
        ? 'Changes here stay on this plan, and changes to its provider’s other plans don’t reach it.'
        : `Changes here go to the same features of ${namesText(names)} in this list too. Essential stays on this plan.`,
    };
  });

  /** Whether there are cards to pay with: else Payment says where to add them. */
  protected readonly hasCards = computed(() => this.cards.records().length > 0);

  /**
   * The cards the item can be paid with (P6, M9.4): the ones its seller takes where it's bought, or every card when
   * that isn't known, marked "acceptance not confirmed" (but for a custom subscription, which never says).
   */
  protected readonly cardChoices = computed(() => {
    const resolved = this.preview();
    const context = this.rewardsContext();
    if (!resolved || !context) return [];
    const unconfirmed = resolved.customSubId === undefined;
    return cardChoices(resolved, this.cards.records(), context).map((choice) => ({
      ...choice,
      label:
        `${cardTitle(choice.card)} (${cardNetworkNames[choice.card.network]}, ` +
        `${percentText(choice.card.cashbackPercent)} back)` +
        (choice.acceptance === 'unknown' && unconfirmed ? ' · acceptance not confirmed' : ''),
    }));
  });

  /** The chosen card's month: "$21.46 / mo with tax, $21.14 after cash back and FX fees". */
  protected readonly cardMonth = computed<ChoiceText | undefined>(() => {
    const resolved = this.preview();
    const context = this.rewardsContext();
    const choice = this.cardChoices().find(({ card }) => card.id === this.model().cardId);
    if (!resolved || !context || !choice || this.free()) return undefined;
    const month = monthlyOnCard(resolved, choice.card, context);
    if (!month) return undefined;
    const shown = month.converted ? '≈ ' : '';
    const spoken = month.converted ? 'about ' : '';
    const money = (amount: number) => amountText(amount, context.currency, this.country());
    return {
      shown: `${shown}${money(month.gross)} / mo with tax, ${shown}${money(month.net)} after cash back and FX fees`,
      spoken: `${spoken}${money(month.gross)} a month with tax, ${spoken}${money(month.net)} after cash back and FX fees`,
    };
  });

  /** The Best card chip (P6): the card that leaves the least to pay a month, when it isn't the one chosen. */
  protected readonly bestCardChip = computed(() => {
    const resolved = this.preview();
    const context = this.rewardsContext();
    if (!resolved || !context || this.free()) return undefined;
    const best = bestCard(this.cardChoices(), this.model().cardId || undefined, resolved, context);
    if (!best) return undefined;
    const title = cardTitle(best.choice.card);
    const saving = amountText(best.saving, context.currency, this.country());
    return {
      cardId: best.choice.card.id,
      shown: `Best card: ${title}, saves ${best.estimated ? '≈ ' : ''}${saving} / mo`,
      spoken: `Best card: ${title}, saves ${best.estimated ? 'about ' : ''}${saving} a month`,
    };
  });

  /**
   * What the chosen card means here: acceptance its seller doesn't confirm, and an FX fee on a charge in another
   * currency, with a word on a checkout's own conversion (the user's choice for Mullvad, M9.3).
   */
  protected readonly cardNotes = computed(() => {
    const resolved = this.preview();
    const context = this.rewardsContext();
    const choice = this.cardChoices().find(({ card }) => card.id === this.model().cardId);
    if (!resolved || !context || !choice || this.free()) return [];
    const notes: string[] = [];
    if (choice.acceptance === 'unknown' && resolved.customSubId === undefined) {
      notes.push(`Acceptance not confirmed: ${resolved.name} doesn’t say which cards it takes.`);
    }
    const charged = (monthlyParts(resolved, context.currency, context.place) ?? [])
      .filter((part) => part.charged.amount > 0)
      .map((part) => part.charged.currency);
    const foreign = [...new Set(charged)].filter((currency) => currency !== choice.card.currency);
    if (foreign.length > 0) {
      const fee =
        choice.card.fxFeePercent > 0
          ? `this card’s ${percentText(choice.card.fxFeePercent)} FX fee applies (estimated at the ECB’s rate)`
          : 'this card adds no FX fee';
      notes.push(
        `${resolved.name} charges in ${foreign.join(' and ')}, so ${fee}. A checkout that offers to charge you ` +
          `in ${choice.card.currency} instead converts at its own rate, which can cost more.`,
      );
    }
    return notes;
  });

  /** The card the item was paid with when the dialog opened, when its seller doesn't take it: it's dropped. */
  protected readonly cardNotTaken = signal<string | undefined>(undefined);

  protected readonly form = form(
    this.model,
    (path) => {
      validateTree(path, ({ value, fieldTree }) =>
        issueErrors(fieldTree, itemFormIssues(value(), this.rules())),
      );
    },
    { submission: { action: () => this.save(), onInvalid: (tree) => this.focusError(tree) } },
  );

  /** The period's own error: Billed is a menu of prices, not a field of the form. */
  protected readonly periodError = computed(() => this.firstError(this.form.interval));
  private readonly validPeriod = computed(
    () => this.firstError(this.form.intervalCount) === undefined,
  );

  constructor() {
    // What's asked for opens on the period asked for when the plan is priced for it, else on its first.
    if (!this.editing) this.planChanged();

    // The region's prices, which an item bought elsewhere needs before Save puts it in the saved items.
    this.catalogStore.need(
      computed(() => (this.model().kind === 'custom' ? [] : [this.model().region])),
    );

    fillScreenWhenNarrow(this.dialogRef);

    // An item paid with a card its seller doesn't take (its networks became known since) loses it, with a note: the
    // menu offers only the cards it takes (P11). Once the cards and the item's price have loaded.
    const dropUntaken = effect(() => {
      const cardId = untracked(() => this.model().cardId);
      if (cardId !== '' && (this.cards.status() !== 'ready' || !this.preview())) return;
      if (cardId !== '' && !this.cardChoices().some(({ card }) => card.id === cardId)) {
        const card = this.cards.byId().get(cardId);
        untracked(() => {
          this.model.update((current) => ({ ...current, cardId: '' }));
          if (card) this.cardNotTaken.set(cardTitle(card));
        });
      }
      dropUntaken.destroy();
    });
  }

  /** The Best card chip: pays with it. */
  protected useBestCard(cardId: string): void {
    this.model.update((current) => ({ ...current, cardId }));
  }

  /**
   * The Plan menu chose another plan: the period stays if it's priced for it, and the add-ons are its own. A custom
   * plan can be billed any way, but a new one starts on its own price's period.
   */
  protected planChanged(): void {
    const custom = this.customPlan();
    const periods = custom ? [periodOf(custom.price)] : this.periods();
    this.model.update((form) =>
      afterPlanChange(form, {
        ...(periods && { periods }),
        addOnIds: this.plan()?.addOnIds ?? [],
      }),
    );
    this.followPeriod();
  }

  /** Bought in changed, and with it the prices. */
  protected regionChanged(): void {
    this.planChanged();
  }

  /** Billed: a period the plan is priced for, or a custom plan's interval. */
  protected choosePeriod(key: string): void {
    const [interval, count] = key.split(':');
    const parsed = intervalSchema.safeParse(interval);
    if (!parsed.success) return;
    this.model.update((form) => ({ ...form, interval: parsed.data, intervalCount: Number(count) }));
    this.followPeriod();
  }

  protected chooseInterval(interval: Interval): void {
    this.choosePeriod(`${interval}:${this.model().intervalCount}`);
  }

  /** A custom plan's count was changed in its field ([formField] has stored it). */
  protected countChanged(): void {
    this.followPeriod();
  }

  protected chooseBillingDay(day: BillingDay | 0): void {
    this.model.update((form) => ({ ...form, billingDay: day }));
  }

  /** Adds a window, and puts focus on its start. */
  protected addWindow(): void {
    this.model.update((form) => ({
      ...form,
      windows: [...form.windows, emptyWindow(this.today())],
    }));
    afterNextRender(
      () => {
        const starts = this.host.nativeElement.querySelectorAll<HTMLElement>('.window-start');
        starts[starts.length - 1]?.focus();
      },
      { injector: this.injector },
    );
  }

  /** Removes a window; focus moves to Add window, since its own button has gone. */
  protected removeWindow(index: number): void {
    this.model.update((form) => ({
      ...form,
      windows: form.windows.filter((_, other) => other !== index),
    }));
    afterNextRender(() => this.addWindowButton()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  /** Opens or closes a group of feature ranks. */
  protected toggleGroup(id: string, open: boolean): void {
    this.toggledGroups.update((toggled) => new Map(toggled).set(id, !open));
  }

  /** A rank for this subscription; the profile default (undefined) removes its override. */
  protected setRank(key: RankKey, rank: Rank | undefined): void {
    this.model.update((form) => {
      const others = Object.fromEntries(
        Object.entries(form.rankOverrides).filter(([other]) => other !== key),
      );
      return { ...form, rankOverrides: rank === undefined ? others : { ...others, [key]: rank } };
    });
  }

  protected setTags(tagIds: readonly string[]): void {
    this.model.update((form) => ({ ...form, tagIds: [...tagIds] }));
  }

  /** A field's first error. */
  protected firstError(field: ReadonlyFieldTree<unknown> | FieldTree<unknown>): string | undefined {
    return field().errors()[0]?.message;
  }

  /** The first error of a field shown outside a form field (a checkbox, a menu), once it's been touched. */
  protected shownError(field: FieldTree<unknown>): string | undefined {
    return field().touched() ? this.firstError(field) : undefined;
  }

  /**
   * The suggested renewal follows the period whenever it changes (renewalAfterPeriodChange): a month from today
   * becomes a year from today, and a date the user entered stays, with its billing day while that applies.
   */
  private followPeriod(): void {
    const form = this.model();
    if (!this.validPeriod() || samePeriod(form, this.renewalPeriod)) return;
    const renewal = renewalAfterPeriodChange(
      { anchorDate: form.anchorDate, billingDay: form.billingDay || undefined },
      this.renewalPeriod,
      form,
      this.today(),
    );
    this.renewalPeriod = periodOf(form);
    this.model.update((current) => ({
      ...current,
      anchorDate: renewal.anchorDate,
      billingDay: renewal.billingDay ?? 0,
    }));
  }

  /** What the form's item is made with: ranks are kept for `providedKeys`. */
  private context(providedKeys: readonly RankKey[]): ItemFormContext {
    return {
      ...this.rules(),
      autoRenew: this.autoRenewAvailable(),
      country: this.country(),
      providedKeys,
      today: this.today(),
      ...(this.editing && { billingBefore: this.editing.billing }),
    };
  }

  /**
   * Puts focus on the first error's field. Billed is a menu of prices rather than a field of the form, so an error
   * with no field bound is its.
   */
  private focusError(tree: FieldTree<unknown>): void {
    const [first] = tree().errorSummary();
    if (first && first.fieldTree().formFieldBindings().length === 0) this.billedSelect()?.focus();
    else focusFirstError(tree);
  }

  /** Add or Save: asks first when the plan is in the list already, then saves to the draft and closes. */
  private async save(): Promise<void> {
    const { listId, listName } = this.data;
    // Ranks are kept for the keys it provides, or all of them when it can't be priced to know.
    const provided = this.preview()?.providedKeys ?? Object.keys(this.model().rankOverrides);
    const fields = itemFromForm(this.model(), this.context(provided));
    // A tag deleted since it was picked, in Settings or another tab, isn't saved back onto the item (M6.11).
    if (this.tags.status() === 'ready') {
      fields.tagIds = fields.tagIds.filter((id) => this.tags.byId().has(id));
    }
    const draft = this.listDraft();
    const title = this.title();
    if (
      isDuplicate(fields.source, draftItems(draft), this.editing) &&
      !(await this.confirmer.confirm({
        title: 'Already in this list — add another?',
        message: `${title} is in ${listName} already. A list can have it more than once, for each person who has it.`,
        confirmText: this.editing ? 'Save anyway' : 'Add another',
      }))
    ) {
      return;
    }
    // The ranks it changed go to its provider's other plans in the list (M6.14).
    const siblings = this.rankSiblings();
    let itemId: string;
    if (this.editing) {
      itemId = this.editing.id;
      // Optional fields the form leaves out are cleared, the card too; pinned isn't the dialog's to change.
      await this.drafts.updateItem(listId, itemId, {
        region: undefined,
        priceOverride: undefined,
        nickname: undefined,
        note: undefined,
        cardId: undefined,
        ownRanks: undefined,
        ...fields,
      });
    } else {
      itemId = (await this.drafts.addItem(listId, { ...fields, pinned: false })).id;
    }
    const edits = sharedRankEdits(
      { id: itemId, source: fields.source, ...(fields.ownRanks && { ownRanks: true }) },
      rankChanges(this.startRanks, fields.rankOverrides, provided),
      siblings,
    );
    if (edits.length > 0) await this.drafts.applyEdits(listId, edits);
    this.dialogRef.close({
      itemId,
      title,
      added: this.editing === undefined,
      shared: edits.length,
    });
  }

  /** "Standard — $18.99 / mo", read "Standard, $18.99 a month"; ≈ and "about" when it's converted. */
  private choiceText(name: string, price: PickedPrice, period = false): ChoiceText {
    if (price.amount === 0) return { shown: `${name} — Free`, spoken: `${name}, Free` };
    const amount = amountText(price.amount, price.currency, this.country());
    const converted = price.fx !== undefined;
    return {
      shown:
        `${name} — ${converted ? '≈ ' : ''}${amount}` +
        (period ? ` ${intervalText(price.interval, price.intervalCount)}` : ''),
      spoken:
        `${name}, ${converted ? 'about ' : ''}${amount}` +
        (period ? ` ${intervalSpoken(price.interval, price.intervalCount)}` : ''),
    };
  }

  /**
   * The form the dialog opens with: the item as it is, or what was asked for, with the ranks the provider's other plans
   * in the list share (M6.14).
   */
  private initialForm(): ItemForm {
    const form = this.requestedForm();
    if (this.editing) return form;
    const draft = this.listDraft();
    const source =
      form.kind === 'catalog' && form.planId !== ''
        ? { kind: 'catalog' as const, planId: form.planId }
        : form.kind === 'custom'
          ? { kind: 'custom' as const, customSubId: form.customSubId, customPlanId: form.planId }
          : undefined;
    if (!source) return form;
    const shared = sharedRanksFor(
      { id: previewId, source },
      draftItems(draft).map((item) => ({ item, providedKeys: [] })),
    );
    return { ...form, rankOverrides: { ...shared, ...form.rankOverrides } };
  }

  /** The list's draft as stored now, or before the drafts' query has it, as the editor had it. */
  private listDraft(): ListDraft {
    return this.drafts.byList().get(this.data.listId) ?? this.data.draft;
  }

  /** What was asked for, or the item as it is. */
  private requestedForm(): ItemForm {
    const country = this.settings.saved()?.country ?? '';
    const currency = this.settings.saved()?.currency ?? '';
    const today = this.today();
    const { request } = this.data;
    const catalog = (region: string): CatalogData | undefined =>
      this.catalogStore.catalogFor(region) ?? this.catalogStore.catalog();
    const addOnIdsOf = (planId: string, region: string) =>
      catalog(region)
        ?.providers.flatMap((provider) => provider.plans)
        .find((plan) => plan.id === planId)?.addOnIds ?? [];
    switch (request.kind) {
      case 'item': {
        const { item } = request;
        const planId = item.source.kind === 'catalog' ? item.source.planId : '';
        return itemFormFor(item, {
          addOnIds: addOnIdsOf(planId, item.region ?? country),
          today,
          country,
          currency,
        });
      }
      case 'plan':
        return newItemForm({
          source: { kind: 'catalog', planId: request.planId },
          period: request.period,
          ...(request.ownPrice && { ownPrice: request.ownPrice }),
          addOnIds: addOnIdsOf(request.planId, country),
          today,
          country,
          currency,
        });
      case 'bundle':
        return newItemForm({
          source: { kind: 'bundle', bundleId: request.bundleId },
          period: request.period,
          addOnIds: [],
          today,
          country,
          currency,
        });
      case 'custom': {
        const sub = this.customSubs.byId().get(request.customSubId);
        const [plan] = sub?.plans ?? [];
        return newItemForm({
          source: {
            kind: 'custom',
            customSubId: request.customSubId,
            customPlanId: plan?.id ?? '',
          },
          period: plan ? periodOf(plan.price) : { interval: 'month', intervalCount: 1 },
          addOnIds: [],
          today,
          country,
          currency,
        });
      }
    }
  }
}

/** An id and time for the item the dialog prices before it's saved: never stored. */
const previewId = '00000000-0000-7000-8000-000000000000';
const previewTime = '1970-01-01T00:00:00.000Z';

/** The rank rows of an entry and its children's, in order. */
function entryRows(entry: RankingEntry): RankingRow[] {
  return [...entry.rows, ...entry.children.flatMap(entryRows)];
}

function periodKey({ interval, intervalCount }: Period): string {
  return `${interval}:${intervalCount}`;
}

/** "1.5%", "0%": a card's cash back or FX fee. */
function percentText(value: number): string {
  return `${value.toLocaleString('en', { maximumFractionDigits: 3 })}%`;
}

function capitalized(text: string): string {
  return text[0].toUpperCase() + text.slice(1);
}

/** 28 → "28th", 31 → "31st". */
function ordinal(day: number): string {
  const ones = day % 10;
  const suffix =
    day >= 11 && day <= 13
      ? 'th'
      : ones === 1
        ? 'st'
        : ones === 2
          ? 'nd'
          : ones === 3
            ? 'rd'
            : 'th';
  return `${day}${suffix}`;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

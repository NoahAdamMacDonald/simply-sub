import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
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
  billingDayChoices,
  draftItems,
  emptyWindow,
  filterRanking,
  intervalSchema,
  isDuplicate,
  itemFormFor,
  itemFormIssues,
  itemFromForm,
  monthlyAverage,
  newItemForm,
  periodChoices,
  periodOf,
  pickPrice,
  rankingSections,
  renewalAfterPeriodChange,
  samePeriod,
  taxAddedRegions,
  typedPrice,
  type BillingDay,
  type CatalogData,
  type CustomSubscription,
  type Interval,
  type ItemForm,
  type ItemFormContext,
  type ListItem,
  type Period,
  type PickedPrice,
  type PriceContext,
  type Rank,
  type RankKey,
  type RankingEntry,
  type RankingRow,
  type RequestedPrice,
  type SnapshotProvider,
} from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { ClockService } from '../../core/clock/clock-service';
import { FxStore } from '../../core/fx/fx-store';
import { ListDraftService } from '../../core/lists/list-draft-service';
import { MetricsService } from '../../core/metrics/metrics-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { CustomSubsRepository } from '../../core/storage/custom-subs-repository';
import { RankingsRepository } from '../../core/storage/rankings-repository';
import { ConfirmService } from '../../shared/confirm/confirm-service';
import { CalendarHeader } from '../../shared/calendar-header';
import { periodText } from '../../shared/billing-text';
import { focusFirstError } from '../../shared/focus-first-error';
import { isoDateProviders } from '../../shared/iso-date-adapter';
import { issueErrors } from '../../shared/form-issues';
import { countryChoices, currencyChoices } from '../../shared/place-choices';
import { PriceTag } from '../../shared/price-tag/price-tag';
import { amountText, intervalSpoken, intervalText } from '../../shared/price-tag/price-text';
import { ProviderIcon } from '../../shared/provider-icon/provider-icon';
import { RankSelect } from '../../shared/rank/rank-select';
import { catalogIcon, planTitle } from '../../shared/sub-card/card-text';
import { TagPicker } from '../../shared/tags/tag-picker';
import { fillScreenWhenNarrow } from '../../shared/wide-dialog';

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
}

/** What was saved to the draft: the item's id, what it's called ("Netflix Standard"), and whether it's new. */
export interface ItemDialogResult {
  itemId: string;
  title: string;
  added: boolean;
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
  private readonly rankings = inject(RankingsRepository);
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

  /** The footer's "≈ $18.99 / mo": the monthly equivalent, before tax, with ≈ when it's converted. */
  protected readonly monthly = computed<ChoiceText | undefined>(() => {
    const resolved = this.preview();
    if (!resolved) return undefined;
    if (this.free()) return { shown: 'Free', spoken: 'Free' };
    const average = monthlyAverage([resolved], this.currency());
    if (average.leftOut > 0) return undefined;
    const amount = amountText(average.amount, average.currency, this.country());
    return {
      shown: `${average.approx ? '≈ ' : ''}${amount} / mo`,
      spoken: `${average.approx ? 'about ' : ''}${amount} a month`,
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
    const draft = this.drafts.byList().get(listId);
    const title = this.title();
    if (
      draft &&
      isDuplicate(fields.source, draftItems(draft), this.editing) &&
      !(await this.confirmer.confirm({
        title: 'Already in this list — add another?',
        message: `${title} is in ${listName} already. A list can have it more than once, for each person who has it.`,
        confirmText: this.editing ? 'Save anyway' : 'Add another',
      }))
    ) {
      return;
    }
    let itemId: string;
    if (this.editing) {
      itemId = this.editing.id;
      // Optional fields the form leaves out are cleared; pinned and cardId aren't the dialog's to change.
      await this.drafts.updateItem(listId, itemId, {
        region: undefined,
        priceOverride: undefined,
        ...fields,
      });
    } else {
      itemId = (await this.drafts.addItem(listId, { ...fields, pinned: false })).id;
    }
    this.dialogRef.close({ itemId, title, added: this.editing === undefined });
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

  /** The form the dialog opens with: what was asked for, or the item as it is. */
  private initialForm(): ItemForm {
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

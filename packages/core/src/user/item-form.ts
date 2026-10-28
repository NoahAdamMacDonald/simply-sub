import { isoDateSchema } from '../catalog/formats';
import type { Interval } from '../catalog/price';
import { addDays, addMonths, type IsoDate } from '../dates/iso-date';
import type { RankKey } from '../ranking/rank-keys';
import { maxIntervalCount } from './add-request';
import {
  maxNicknameLength,
  maxNoteLength,
  type Billing,
  type ItemSource,
  type ListItem,
  type PriceOverride,
} from './list-item';
import type { Rank } from './rank';

// The item dialog's rules (PROJECT-PLAN P6, M6.5): the billing periods a plan offers, when an Ongoing item renews by
// default and which day of the month it's billed on, Specific dates' windows, what the form needs before it's saved,
// and the list item it saves. The dialog holds the form and the catalog; what it decides is here.

/** A billing period: an interval, and how many of them one payment covers (3 months). */
export interface Period {
  interval: Interval;
  intervalCount: number;
}

/** The day an item is billed on when its anchor is a shorter month's last day (PROJECT-PLAN §3.1). */
export type BillingDay = 29 | 30 | 31;

/** An Ongoing item's next renewal: its anchor date, and its billing day when that's later in the month. */
export interface Renewal {
  anchorDate: IsoDate;
  billingDay?: BillingDay;
}

/**
 * One window of Specific dates, as the form edits it: '' for a date not entered yet, and null for one typed that isn't
 * a date (the date picker's answer).
 */
export interface WindowForm {
  start: string | null;
  end: string | null;
  repeatYearly: boolean;
}

/** An add-on of the plan, taken or not, and how many. */
export interface AddOnForm {
  id: string;
  chosen: boolean;
  quantity: number;
}

/**
 * The item dialog's form. Signal Forms models hold no undefined, so a date not entered is '' (or null, for text the
 * date picker can't read), no billing day is 0 and no amount is null. It keeps both billing modes' fields, so
 * switching between them loses nothing.
 */
export interface ItemForm {
  kind: ItemSource['kind'];
  /** A catalog plan's id, or a custom plan's; '' for a bundle. */
  planId: string;
  /** '' unless it's a bundle. */
  bundleId: string;
  /** '' unless it's a custom subscription. */
  customSubId: string;
  /** The plan's add-ons, in its order. */
  addOns: AddOnForm[];
  mode: Billing['mode'];
  interval: Interval;
  intervalCount: number;
  /** Ongoing: the next renewal. */
  anchorDate: string | null;
  billingDay: BillingDay | 0;
  /** Ongoing: subscribed since. */
  startDate: string | null;
  /** Ongoing: ends on. */
  endDate: string | null;
  autoRenew: boolean;
  /** Specific dates. */
  windows: WindowForm[];
  /** "I pay a different price". */
  ownPrice: boolean;
  priceAmount: number | null;
  priceCurrency: string;
  priceUntil: string | null;
  plusTax: boolean;
  /** Where it was bought: Settings' country unless it's changed. */
  region: string;
  rankOverrides: Record<RankKey, Rank>;
  tagIds: string[];
  /** The user's own name for it and their note, as typed: '' for none. */
  nickname: string;
  note: string;
}

/** A rule the form breaks, at the field it's about: `['windows', 0, 'end']`. */
export interface FormIssue {
  path: readonly (string | number)[];
  message: string;
}

/** What a new item's form starts from: what it is, and the period Search's price asked for (P7). */
export interface NewItemOptions {
  source: ItemSource;
  period: Period;
  /** A reseller's price, which starts "I pay a different price" (BLUEPRINT §4.9). */
  ownPrice?: { amount: number; currency: string; plusTax: boolean };
  /** The plan's add-ons (Plan.addOnIds). */
  addOnIds: readonly string[];
  today: IsoDate;
  /** Settings' country and currency: where it's bought and what an own price is in, until they're changed. */
  country: string;
  currency: string;
}

/** Whether two periods are the same: monthly isn't every 2 months. */
export function samePeriod(a: Period, b: Period): boolean {
  return a.interval === b.interval && a.intervalCount === b.intervalCount;
}

/**
 * Whether two periods are as long as each other, whatever their units: every 12 months is a year, and both bill on
 * the same dates (Amazon sells Mullvad for 12 months, which Mullvad prices as a year).
 */
export function sameLength(a: Period, b: Period): boolean {
  return samePeriod(inYears(a), inYears(b));
}

/**
 * The periods a plan or bundle can be billed for (P6's Billed): one for each price pickPrice gives where it's bought,
 * in its order, shortest first. A custom plan can be billed any way, so it has no list.
 */
export function periodChoices(prices: readonly Period[]): Period[] {
  const periods: Period[] = [];
  for (const { interval, intervalCount } of prices) {
    const period = { interval, intervalCount };
    if (!periods.some((known) => samePeriod(known, period))) periods.push(period);
  }
  return periods;
}

/**
 * The period once the plan changes: the same one if the new plan is priced for it, or one as long (a year for 12
 * months), else its first (P6).
 */
export function periodAfterPlanChange(current: Period, choices: readonly Period[]): Period {
  const kept =
    choices.find((choice) => samePeriod(choice, current)) ??
    choices.find((choice) => sameLength(choice, current));
  const { interval, intervalCount } = kept ?? choices[0] ?? current;
  return { interval, intervalCount };
}

/** `date` plus `count` periods. Months and years land on the same day, or the month's last day when it's shorter. */
export function addPeriods(date: IsoDate, period: Period, count = 1): IsoDate {
  const n = period.intervalCount * count;
  switch (period.interval) {
    case 'day':
      return addDays(date, n);
    case 'week':
      return addDays(date, 7 * n);
    case 'month':
      return addMonths(date, n);
    case 'year':
      return addMonths(date, 12 * n);
  }
}

/**
 * The days later in the month than `anchorDate`'s that it can be billed on, which P6 offers as a choice that sets
 * billingDay: none unless the period is in months or years and the anchor is the last day of a month shorter than 31
 * days, and only days that a later charge's month has. Feb 28 billed monthly can be the 29th, 30th or 31st; Apr 30,
 * the 31st; Feb 28 billed yearly, the 29th once a leap year comes round. A date input's value that isn't a date we
 * take (a year of 6 digits) has none.
 */
export function billingDayChoices(anchorDate: string | null, period: Period): BillingDay[] {
  if (!isDate(anchorDate) || (period.interval !== 'month' && period.interval !== 'year')) return [];
  const day = dayOf(anchorDate);
  if (!isLastDay(anchorDate) || day >= 31) return [];
  const months = (period.interval === 'year' ? 12 : 1) * period.intervalCount;
  // Within 8 charges every month a charge can fall in comes round, a 31-day one included unless every charge is in
  // the anchor's month, and a leap February does too unless none ever comes.
  let longest = day;
  for (let n = 1; n <= 8; n++) {
    longest = Math.max(longest, monthLength(addMonths(anchorDate, n * months)));
  }
  return ([29, 30, 31] as const).filter((choice) => choice > day && choice <= longest);
}

/** `billingDay` if it still applies to `anchorDate` billed by `period`, else undefined. */
export function keptBillingDay(
  anchorDate: string | null,
  period: Period,
  billingDay: number | undefined,
): BillingDay | undefined {
  if (billingDay === undefined || !isDate(anchorDate)) return undefined;
  return billingDayChoices(anchorDate, period).find((choice) => choice === billingDay);
}

/**
 * A new Ongoing item's next renewal (P6): one period from today, the date the dialog suggests until the user enters
 * their own. Months and years keep today's day: added on Jan 31, it renews on Feb 28 with billingDay 31, then Mar 31.
 */
export function defaultRenewal(today: IsoDate, period: Period): Renewal {
  const anchorDate = addPeriods(today, period);
  const billingDay = keptBillingDay(anchorDate, period, dayOf(today));
  return { anchorDate, ...(billingDay !== undefined && { billingDay }) };
}

/**
 * The renewal once the billing period changes. The date the dialog suggested moves with the period (a month from today
 * becomes a year from today); a date the user entered stays, with its billing day while that still applies.
 */
export function renewalAfterPeriodChange(
  renewal: { anchorDate: string | null; billingDay?: number },
  from: Period,
  to: Period,
  today: IsoDate,
): Renewal {
  if (!isDate(renewal.anchorDate) || renewal.anchorDate === addPeriods(today, from)) {
    return defaultRenewal(today, to);
  }
  const billingDay = keptBillingDay(renewal.anchorDate, to, renewal.billingDay);
  return { anchorDate: renewal.anchorDate, ...(billingDay !== undefined && { billingDay }) };
}

/**
 * What's wrong with Specific dates' windows (P6): there's at least one, each has both dates with its end after its
 * start, and none overlaps another, a yearly one's later copies included. A window is active through its end date
 * (§3.1), so two that share a day overlap, and one that repeats yearly must be shorter than a year, or it would
 * overlap its own copy. An overlap is reported at the later window's start.
 */
export function windowIssues(windows: readonly WindowForm[]): FormIssue[] {
  if (windows.length === 0) return [{ path: ['windows'], message: 'Add at least one window' }];
  const issues: FormIssue[] = [];
  // Each window with both its dates, in order, or undefined when it breaks a rule of its own.
  const valid = windows.map((window, index): DatedWindow | undefined => {
    const at = (field: keyof WindowForm, message: string) =>
      issues.push({ path: ['windows', index, field], message });
    const { start, end, repeatYearly } = window;
    if (!isDate(start)) at('start', 'Enter the start date');
    if (!isDate(end)) at('end', 'Enter the end date');
    if (!isDate(start) || !isDate(end)) return undefined;
    if (end <= start) {
      at('end', 'Must be after the start date');
      return undefined;
    }
    if (repeatYearly && end >= addMonths(start, 12)) {
      at('end', 'A window that repeats every year must be shorter than a year');
      return undefined;
    }
    return { start, end, repeatYearly };
  });
  valid.forEach((window, index) => {
    if (!window) return;
    const earlier = valid.findIndex(
      (other, otherIndex) => otherIndex < index && other !== undefined && overlap(other, window),
    );
    if (earlier >= 0) {
      issues.push({ path: ['windows', index, 'start'], message: `Overlaps window ${earlier + 1}` });
    }
  });
  return issues;
}

/** Windows in the order they come: by start, then by end. A date that isn't one sorts first. */
export function sortedWindows<T extends WindowForm>(windows: readonly T[]): T[] {
  return [...windows].sort(
    (a, b) =>
      compare(a.start ?? '', b.start ?? '') ||
      compare(a.end ?? '', b.end ?? '') ||
      Number(a.repeatYearly) - Number(b.repeatYearly),
  );
}

/** A window with both its dates. */
interface DatedWindow {
  start: IsoDate;
  end: IsoDate;
  repeatYearly: boolean;
}

/** What the form's rules depend on: the chosen plan's prices where it's bought. */
export interface ItemFormRules {
  /**
   * The periods the plan or bundle is priced for (periodChoices). Undefined when any will do: a custom plan, or one
   * whose prices for the region haven't loaded.
   */
  periods?: readonly Period[];
  /** The chosen price is 0: nothing is billed, so there's no period, renewal or own price to check. */
  free: boolean;
  /** The most add-ons the plan allows in all (Plan.addOnLimit). */
  addOnLimit?: number;
}

/**
 * Everything that stops the form from being saved, at the field it's about (P6): a period the plan isn't priced for,
 * add-ons past the plan's limit, an Ongoing item with no next renewal or that ends before it started, Specific dates'
 * window rules (windowIssues), and an own price that isn't above 0 or has no currency. A free plan bills nothing, so
 * only its dates are checked.
 */
export function itemFormIssues(form: ItemForm, rules: ItemFormRules): FormIssue[] {
  const issues: FormIssue[] = [];
  const add = (path: FormIssue['path'], message: string) => issues.push({ path, message });

  const chosen = form.addOns.flatMap((addOn, index) => (addOn.chosen ? [{ ...addOn, index }] : []));
  for (const { quantity, index } of chosen) {
    if (!Number.isInteger(quantity) || quantity < 1) {
      add(['addOns', index, 'quantity'], 'Choose how many');
    }
  }
  const total = chosen.reduce((sum, { quantity }) => sum + quantity, 0);
  const last = chosen.at(-1);
  if (rules.addOnLimit !== undefined && last && total > rules.addOnLimit) {
    // At the last one taken: a plan that allows only one has no quantity to choose.
    add(['addOns', last.index, 'chosen'], `This plan allows ${rules.addOnLimit} in all`);
  }

  if (!rules.free) {
    const { intervalCount } = form;
    if (!Number.isInteger(intervalCount) || intervalCount < 1 || intervalCount > maxIntervalCount) {
      add(['intervalCount'], `Enter a whole number from 1 to ${maxIntervalCount}`);
    } else if (rules.periods && !rules.periods.some((period) => samePeriod(period, form))) {
      add(['interval'], 'This plan isn’t billed that way');
    }
  }

  if (form.mode === 'recurring' || rules.free) {
    if (!rules.free && !isDate(form.anchorDate)) add(['anchorDate'], 'Enter the next renewal date');
    if (isDate(form.startDate) && isDate(form.endDate) && form.endDate <= form.startDate) {
      add(['endDate'], 'Must be after the date you subscribed');
    }
  } else {
    issues.push(...windowIssues(form.windows));
  }

  if (form.ownPrice && !rules.free) {
    if (form.priceAmount === null || !(form.priceAmount > 0)) {
      add(['priceAmount'], 'Enter an amount above 0');
    }
    if (form.priceCurrency === '') add(['priceCurrency'], 'Choose a currency');
  }

  if (form.nickname.trim().length > maxNicknameLength) {
    add(['nickname'], `Use at most ${maxNicknameLength} characters`);
  }
  if (form.note.trim().length > maxNoteLength) {
    add(['note'], `Use at most ${maxNoteLength} characters`);
  }
  return issues;
}

/** What the form saves: all of a list item but its id, list, pinning, card and timestamps. */
export type ItemFields = Pick<ListItem, 'source' | 'billing' | 'tagIds' | 'rankOverrides'> &
  Partial<Pick<ListItem, 'region' | 'priceOverride' | 'nickname' | 'note'>>;

export interface ItemFormContext extends ItemFormRules {
  /** The chosen price's autoRenew: a plan that's renewed by hand never auto-renews. */
  autoRenew: boolean;
  /** Settings' country: an item bought there has no region of its own. */
  country: string;
  /** The keys the item provides: an override of any other key is left out. */
  providedKeys: readonly RankKey[];
  today: IsoDate;
  /** The item's billing before this change, when it's an item being changed: a free plan keeps its anchor. */
  billingBefore?: Billing;
}

/**
 * The list item the form describes, once itemFormIssues finds nothing wrong (what it would find is left out). A free
 * plan is saved as Ongoing with today as its anchor (P6), or the anchor it had, so opening and saving an item changes
 * nothing; it has no own price, since there's nothing to pay. Windows are saved in date order, a billing day only
 * while it applies, and ranks only for the keys the item provides. An item bought in Settings' country has no region.
 */
export function itemFromForm(form: ItemForm, context: ItemFormContext): ItemFields {
  const period: Period = { interval: form.interval, intervalCount: form.intervalCount };
  const free = context.free;
  const tagIds = [...form.tagIds];
  const provided = new Set(context.providedKeys);
  const rankOverrides = Object.fromEntries(
    Object.entries(form.rankOverrides).filter(([key]) => provided.has(key)),
  );
  return {
    source: itemSource(form),
    ...(form.region !== context.country && { region: form.region }),
    billing: free ? freeBilling(form, period, context) : billing(form, period, context),
    ...(!free && form.ownPrice && { ...priceOverride(form) }),
    tagIds,
    rankOverrides,
    ...trimmed('nickname', form.nickname),
    ...trimmed('note', form.note),
  };
}

/** A typed text as a field of its own, trimmed, or nothing when it's empty. */
function trimmed<K extends 'nickname' | 'note'>(key: K, text: string): Partial<Record<K, string>> {
  const value = text.trim();
  return value === '' ? {} : ({ [key]: value } as Record<K, string>);
}

/** A new item's form: what Search asked for (P7), billed from today with the suggested renewal (defaultRenewal). */
export function newItemForm({
  source,
  period,
  ownPrice,
  addOnIds,
  today,
  country,
  currency,
}: NewItemOptions): ItemForm {
  const renewal = defaultRenewal(today, period);
  return {
    ...sourceFields(source),
    addOns: addOnRows(addOnIds),
    mode: 'recurring',
    interval: period.interval,
    intervalCount: period.intervalCount,
    anchorDate: renewal.anchorDate,
    billingDay: renewal.billingDay ?? 0,
    startDate: '',
    endDate: '',
    autoRenew: true,
    windows: [emptyWindow(today)],
    ownPrice: ownPrice !== undefined,
    priceAmount: ownPrice?.amount ?? null,
    priceCurrency: ownPrice?.currency ?? currency,
    priceUntil: '',
    plusTax: ownPrice?.plusTax ?? false,
    region: country,
    rankOverrides: {},
    tagIds: [],
    nickname: '',
    note: '',
  };
}

/**
 * The form for an item in the list. The fields of the billing mode it doesn't use start as a new item's would, so
 * switching to it has something to show.
 */
export function itemFormFor(
  item: ListItem,
  options: Omit<NewItemOptions, 'source' | 'period'>,
): ItemForm {
  const { billing, priceOverride: own } = item;
  const form = newItemForm({ ...options, source: item.source, period: billing });
  const chosen = item.source.kind === 'catalog' ? (item.source.addOns ?? []) : [];
  return {
    ...form,
    addOns: addOnRows(options.addOnIds, chosen),
    mode: billing.mode,
    ...(billing.mode === 'recurring'
      ? {
          anchorDate: billing.anchorDate,
          billingDay: billing.billingDay ?? 0,
          startDate: billing.startDate ?? '',
          endDate: billing.endDate ?? '',
          autoRenew: billing.autoRenew,
        }
      : { windows: billing.windows.map((window) => ({ ...window })) }),
    ...(own && {
      ownPrice: true,
      priceAmount: own.amount,
      priceCurrency: own.currency,
      priceUntil: own.until ?? '',
      plusTax: own.plusTax ?? false,
    }),
    region: item.region ?? options.country,
    rankOverrides: { ...item.rankOverrides },
    tagIds: [...item.tagIds],
    nickname: item.nickname ?? '',
    note: item.note ?? '',
  };
}

/** What the new plan or region prices it for, and which add-ons it has. */
export interface PlanChoice {
  /** As in ItemFormRules: undefined when any will do. */
  periods?: readonly Period[];
  addOnIds: readonly string[];
}

/**
 * The form once the plan changes, or the region it's bought in, which can change the prices (P6): the period stays if
 * the plan is priced for it, else it's the plan's first. The add-ons are the new plan's, the ones it shares with the
 * old taken as they were. The suggested renewal then follows the period (renewalAfterPeriodChange).
 */
export function afterPlanChange(form: ItemForm, plan: PlanChoice): ItemForm {
  const period = plan.periods ? periodAfterPlanChange(form, plan.periods) : periodOf(form);
  const chosen = form.addOns.filter((addOn) => addOn.chosen);
  return { ...form, ...period, addOns: addOnRows(plan.addOnIds, chosen) };
}

/** A window for Specific dates to start from: starting today, its end not entered yet. */
export function emptyWindow(today: IsoDate): WindowForm {
  return { start: today, end: '', repeatYearly: false };
}

/**
 * Whether saving `source` puts a plan in the list twice (P6 asks first, since duplicates are allowed): the same catalog
 * plan, whatever its add-ons, bundle or custom plan as another item of `items`, unless it's the plan `editing`, the
 * item being changed, had already.
 */
export function isDuplicate(
  source: ItemSource,
  items: readonly ListItem[],
  editing?: ListItem,
): boolean {
  if (editing && samePlan(editing.source, source)) return false;
  return items.some((item) => item.id !== editing?.id && samePlan(item.source, source));
}

function samePlan(a: ItemSource, b: ItemSource): boolean {
  switch (a.kind) {
    case 'catalog':
      return b.kind === 'catalog' && a.planId === b.planId;
    case 'bundle':
      return b.kind === 'bundle' && a.bundleId === b.bundleId;
    case 'custom':
      return b.kind === 'custom' && a.customPlanId === b.customPlanId;
  }
}

function sourceFields(
  source: ItemSource,
): Pick<ItemForm, 'kind' | 'planId' | 'bundleId' | 'customSubId'> {
  switch (source.kind) {
    case 'catalog':
      return { kind: 'catalog', planId: source.planId, bundleId: '', customSubId: '' };
    case 'bundle':
      return { kind: 'bundle', planId: '', bundleId: source.bundleId, customSubId: '' };
    case 'custom':
      return {
        kind: 'custom',
        planId: source.customPlanId,
        bundleId: '',
        customSubId: source.customSubId,
      };
  }
}

function itemSource(form: ItemForm): ItemSource {
  switch (form.kind) {
    case 'catalog': {
      const addOns = form.addOns
        .filter((addOn) => addOn.chosen)
        .map(({ id, quantity }) => ({ id, quantity }));
      return { kind: 'catalog', planId: form.planId, ...(addOns.length > 0 && { addOns }) };
    }
    case 'bundle':
      return { kind: 'bundle', bundleId: form.bundleId };
    case 'custom':
      return { kind: 'custom', customSubId: form.customSubId, customPlanId: form.planId };
  }
}

/** The plan's add-ons as the form lists them, the ones in `chosen` taken with their quantity. */
function addOnRows(
  addOnIds: readonly string[],
  chosen: readonly { id: string; quantity: number }[] = [],
): AddOnForm[] {
  return addOnIds.map((id) => {
    const taken = chosen.find((addOn) => addOn.id === id);
    return { id, chosen: taken !== undefined, quantity: taken?.quantity ?? 1 };
  });
}

function billing(form: ItemForm, period: Period, context: ItemFormContext): Billing {
  if (form.mode === 'limited') {
    // What itemFormIssues passes has both dates.
    const windows = sortedWindows(form.windows).map(({ start, end, repeatYearly }) => ({
      start: start ?? '',
      end: end ?? '',
      repeatYearly,
    }));
    return { mode: 'limited', windows, ...period };
  }
  const billingDay = keptBillingDay(form.anchorDate, period, form.billingDay || undefined);
  return {
    mode: 'recurring',
    ...period,
    anchorDate: form.anchorDate ?? '',
    ...(billingDay !== undefined && { billingDay }),
    ...ongoingDates(form),
    autoRenew: context.autoRenew && form.autoRenew,
  };
}

function freeBilling(form: ItemForm, period: Period, context: ItemFormContext): Billing {
  const before = context.billingBefore?.mode === 'recurring' ? context.billingBefore : undefined;
  const anchorDate = before?.anchorDate ?? context.today;
  const billingDay = keptBillingDay(anchorDate, period, before?.billingDay);
  return {
    mode: 'recurring',
    ...period,
    anchorDate,
    ...(billingDay !== undefined && { billingDay }),
    ...ongoingDates(form),
    autoRenew: context.autoRenew,
  };
}

function ongoingDates(form: ItemForm): { startDate?: IsoDate; endDate?: IsoDate } {
  return {
    ...(isDate(form.startDate) && { startDate: form.startDate }),
    ...(isDate(form.endDate) && { endDate: form.endDate }),
  };
}

function priceOverride(form: ItemForm): { priceOverride?: PriceOverride } {
  if (form.priceAmount === null || !(form.priceAmount > 0) || form.priceCurrency === '') return {};
  return {
    priceOverride: {
      amount: form.priceAmount,
      currency: form.priceCurrency,
      ...(isDate(form.priceUntil) && { until: form.priceUntil }),
      ...(form.plusTax && { plusTax: true }),
    },
  };
}

/** A period in years when it's a whole number of them: every 24 months is every 2 years. */
function inYears({ interval, intervalCount }: Period): Period {
  return interval === 'month' && intervalCount % 12 === 0
    ? { interval: 'year', intervalCount: intervalCount / 12 }
    : { interval, intervalCount };
}

/** Just the period of a form or price. */
export function periodOf({ interval, intervalCount }: Period): Period {
  return { interval, intervalCount };
}

/**
 * Whether two windows share a day, in any year: a window that repeats yearly is copied into every later year, as far
 * as a year past the later of their ends, where every overlap has shown.
 */
function overlap(a: DatedWindow, b: DatedWindow): boolean {
  const lastYear = Math.max(yearOf(a.end), yearOf(b.end)) + 1;
  const others = copies(b, lastYear);
  return copies(a, lastYear).some((x) => others.some((y) => x.start <= y.end && y.start <= x.end));
}

function copies(window: DatedWindow, lastYear: number): { start: IsoDate; end: IsoDate }[] {
  if (!window.repeatYearly) return [window];
  const found = [];
  for (let years = 0; yearOf(window.start) + years <= lastYear; years++) {
    found.push({
      start: addMonths(window.start, 12 * years),
      end: addMonths(window.end, 12 * years),
    });
  }
  return found;
}

function isDate(value: string | null): value is string {
  return isoDateSchema.safeParse(value).success;
}

function dayOf(date: IsoDate): number {
  return Number(date.slice(8));
}

function yearOf(date: IsoDate): number {
  return Number(date.slice(0, 4));
}

function isLastDay(date: IsoDate): boolean {
  return addDays(date, 1).endsWith('-01');
}

/** How many days `date`'s month has. */
function monthLength(date: IsoDate): number {
  return dayOf(addDays(addMonths(`${date.slice(0, 7)}-01`, 1), -1));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

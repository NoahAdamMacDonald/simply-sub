import type { Feature, FeatureValue } from '../catalog/feature';
import { httpsUrlSchema } from '../catalog/formats';
import type { Interval } from '../catalog/price';
import { nameMatcher } from '../search/name-match';
import { maxIntervalCount } from './add-request';
import type { CustomPlan, CustomSubscription } from './custom-subscription';
import type { FormIssue } from './item-form';
import type { ListItem } from './list-item';

// The custom subscription editor's rules (PROJECT-PLAN P12, M6.6): what the form needs before it's saved, the record
// it saves, the features a plan can list and the values they take, and what a change does to the list items that
// use the subscription. The dialog holds the form; what it decides is here.

/** One plan as the form edits it. */
export interface CustomPlanForm {
  /** A UUID v7, made by the app for a new plan; an item names its plan by it. */
  id: string;
  name: string;
  /**
   * The cost as typed: text, since a number field in a list of plans loses a decimal point typed quickly (Signal Forms
   * writes the number back as the plan changes). parseAmount reads it.
   */
  amount: string;
  currency: string;
  interval: Interval;
  intervalCount: number;
  /** The cost is before sales tax (BLUEPRINT §4.8). */
  plusTax: boolean;
  autoRenewAvailable: boolean;
  features: Record<string, FeatureValue>;
}

/** The custom subscription editor's form: '' for a link not entered. */
export interface CustomSubForm {
  name: string;
  link: string;
  cancelUrl: string;
  plans: CustomPlanForm[];
}

/** What the editor saves: all of a custom subscription but its id and timestamps. */
export type CustomSubFields = Pick<CustomSubscription, 'name' | 'plans'> &
  Partial<Pick<CustomSubscription, 'link' | 'cancelUrl'>>;

/** A new plan: monthly, in the user's currency, renewing by itself, with nothing else filled in. */
export function newCustomPlan(id: string, currency: string): CustomPlanForm {
  return {
    id,
    name: '',
    amount: '',
    currency,
    interval: 'month',
    intervalCount: 1,
    plusTax: false,
    autoRenewAvailable: true,
    features: {},
  };
}

/** A new custom subscription's form, with one plan to fill in, since it needs at least one (P12). */
export function newCustomSubForm(planId: string, currency: string): CustomSubForm {
  return { name: '', link: '', cancelUrl: '', plans: [newCustomPlan(planId, currency)] };
}

/** The form for a saved custom subscription. */
export function customSubFormFor(sub: CustomSubscription): CustomSubForm {
  return {
    name: sub.name,
    link: sub.link ?? '',
    cancelUrl: sub.cancelUrl ?? '',
    plans: sub.plans.map(({ id, name, price, autoRenewAvailable, features }) => ({
      id,
      name,
      amount: String(price.amount),
      currency: price.currency,
      interval: price.interval,
      intervalCount: price.intervalCount,
      plusTax: price.plusTax ?? false,
      autoRenewAvailable,
      features: { ...features },
    })),
  };
}

/**
 * Everything that stops the form from being saved, at the field it's about (P12): a name, links that are full
 * https:// addresses (BLUEPRINT §11.5), and at least one plan, each with a name of its own, a cost of 0 or more, a
 * currency and a period of 1 to 120 intervals.
 */
export function customSubFormIssues(form: CustomSubForm): FormIssue[] {
  const issues: FormIssue[] = [];
  const add = (path: FormIssue['path'], message: string) => issues.push({ path, message });
  if (form.name.trim() === '') add(['name'], 'Give it a name');
  for (const field of ['link', 'cancelUrl'] as const) {
    const url = form[field].trim();
    if (url !== '' && !httpsUrlSchema.safeParse(url).success) {
      add([field], 'Use a full address that starts with https://');
    }
  }
  if (form.plans.length === 0) add(['plans'], 'Add at least one plan');
  const names = form.plans.map((plan) => plan.name.trim().toLocaleLowerCase('en'));
  form.plans.forEach((plan, index) => {
    const at = (field: keyof CustomPlanForm, message: string) =>
      add(['plans', index, field], message);
    if (names[index] === '') at('name', 'Give the plan a name');
    else if (names.indexOf(names[index]) < index) at('name', 'Another plan has this name');
    if (parseAmount(plan.amount) === undefined) at('amount', 'Enter what it costs, 0 or more');
    if (plan.currency === '') at('currency', 'Choose a currency');
    const count = plan.intervalCount;
    if (!Number.isInteger(count) || count < 1 || count > maxIntervalCount) {
      at('intervalCount', `Enter a whole number from 1 to ${maxIntervalCount}`);
    }
  });
  return issues;
}

/** The custom subscription a valid form describes (customSubFormIssues finds nothing), trimmed. */
export function customSubFromForm(form: CustomSubForm): CustomSubFields {
  const link = form.link.trim();
  const cancelUrl = form.cancelUrl.trim();
  return {
    name: form.name.trim(),
    ...(link !== '' && { link }),
    ...(cancelUrl !== '' && { cancelUrl }),
    plans: form.plans.map((plan) => ({
      id: plan.id,
      name: plan.name.trim(),
      features: { ...plan.features },
      price: {
        amount: parseAmount(plan.amount) ?? 0,
        currency: plan.currency,
        interval: plan.interval,
        intervalCount: plan.intervalCount,
        ...(plan.plusTax && { plusTax: true }),
      },
      autoRenewAvailable: plan.autoRenewAvailable,
    })),
  };
}

/** A typed amount, "29.99", "29", "29." or ".5": digits with a decimal point at most. Undefined for anything else. */
export function parseAmount(text: string): number | undefined {
  const typed = text.trim();
  return /^(\d+\.?\d*|\.\d+)$/.test(typed) ? Number(typed) : undefined;
}

/** How a custom subscription is used: by how many list items and lists, and each plan by how many items. */
export interface CustomSubUsage {
  items: number;
  lists: number;
  /** Items by plan id; a plan no item uses isn't there. */
  plans: ReadonlyMap<string, number>;
}

/** How the saved list items (not deleted) use the custom subscription `subId`. */
export function customSubUsage(subId: string, items: readonly ListItem[]): CustomSubUsage {
  const lists = new Set<string>();
  const plans = new Map<string, number>();
  let count = 0;
  for (const { source, listId, deletedAt } of items) {
    if (deletedAt !== undefined || source.kind !== 'custom' || source.customSubId !== subId)
      continue;
    count++;
    lists.add(listId);
    plans.set(source.customPlanId, (plans.get(source.customPlanId) ?? 0) + 1);
  }
  return { items: count, lists: lists.size, plans };
}

/** What saving a custom subscription does to the items that use it (P12 warns first). */
export interface CustomSubChange {
  /** Items whose plan changed: its name, price, renewal or features. They follow it. */
  changed: number;
  /** Items whose plan was removed, which are removed from their lists with it. */
  removed: number;
  /** The lists those removed items are in. */
  removedLists: number;
}

/** What saving `after` in place of `before` does to the list items that use its plans. */
export function customSubChange(
  before: CustomSubscription,
  after: Pick<CustomSubscription, 'plans'>,
  items: readonly ListItem[],
): CustomSubChange {
  const usage = customSubUsage(before.id, items);
  const lists = new Set<string>();
  let changed = 0;
  let removed = 0;
  for (const plan of before.plans) {
    const count = usage.plans.get(plan.id) ?? 0;
    if (count === 0) continue;
    const kept = after.plans.find((candidate) => candidate.id === plan.id);
    if (!kept) {
      removed += count;
      for (const item of items) {
        if (
          item.deletedAt === undefined &&
          item.source.kind === 'custom' &&
          item.source.customSubId === before.id &&
          item.source.customPlanId === plan.id
        ) {
          lists.add(item.listId);
        }
      }
    } else if (!samePlan(plan, kept)) {
      changed += count;
    }
  }
  return { changed, removed, removedLists: lists.size };
}

/**
 * The features a custom plan can list (P12), in registry order: the rankable ones. A set of provider ids
 * (`includes-subscription`) is the catalog's own, and isn't one.
 */
export function customFeatureChoices(registry: readonly Feature[]): Feature[] {
  return registry.filter(
    (feature) =>
      feature.rankable !== false && !(feature.type === 'set' && feature.values === undefined),
  );
}

/**
 * The features the editor's "Add feature" box offers for `text`: the choices whose name or an alias it starts a word
 * of, as Search's Features box finds them (nameMatcher), leaving out the ones the plan lists. All of them for no text.
 */
export function featureMatches(
  choices: readonly Feature[],
  text: string,
  listed: Readonly<Record<string, FeatureValue>>,
): Feature[] {
  const matcher = nameMatcher(text);
  return choices.filter(
    (feature) =>
      !Object.hasOwn(listed, feature.id) &&
      (matcher?.([feature.name, ...(feature.aliases ?? [])]) ?? true),
  );
}

/**
 * Whether `value` is one `feature` can take on a custom plan: true for a boolean, one of an enum's values, a number of
 * 0 or more or unlimited, and one or more of a set's values, each once.
 */
export function isFeatureValue(feature: Feature, value: FeatureValue): boolean {
  switch (feature.type) {
    case 'boolean':
      return value === true;
    case 'enum':
      return feature.values.some((option) => option.id === value);
    case 'number':
      return value === 'unlimited' || (typeof value === 'number' && value >= 0);
    case 'set':
      return (
        Array.isArray(value) &&
        value.length > 0 &&
        new Set(value).size === value.length &&
        value.every((id) => feature.values?.some((option) => option.id === id))
      );
  }
}

/**
 * The address of a custom subscription's icon: GET /icon for its link's domain (BLUEPRINT §5.4). None without a link,
 * and the app shows its first letter. customSubscriptionSchema checked the link is an https URL with a domain name;
 * GET /icon checks the domain again.
 */
export function customIconUrl(link: string | undefined): string | undefined {
  if (link === undefined) return undefined;
  const domain = (/^https:\/\/(?:[^@/?#]*@)?([^/:?#]+)/i.exec(link)?.[1] ?? '').toLowerCase();
  return domain === '' ? undefined : `api/v1/icon?domain=${domain}`;
}

/** Whether two plans are the same to the items that use them: name, price, renewal and features. */
function samePlan(a: CustomPlan, b: CustomPlan): boolean {
  return (
    a.name === b.name &&
    a.autoRenewAvailable === b.autoRenewAvailable &&
    a.price.amount === b.price.amount &&
    a.price.currency === b.price.currency &&
    a.price.interval === b.price.interval &&
    a.price.intervalCount === b.price.intervalCount &&
    (a.price.plusTax ?? false) === (b.price.plusTax ?? false) &&
    sameFeatures(a.features, b.features)
  );
}

function sameFeatures(
  a: Readonly<Record<string, FeatureValue>>,
  b: Readonly<Record<string, FeatureValue>>,
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && JSON.stringify(a[key]) === JSON.stringify(b[key]))
  );
}

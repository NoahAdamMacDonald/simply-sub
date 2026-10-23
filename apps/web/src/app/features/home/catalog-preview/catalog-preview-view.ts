// TEMPORARY (catalog preview, see catalog-preview-data.ts): turns catalog files into what the preview shows.
// Display only: no price picking or conversion, which come from packages/core (M1.7).
import type { Bundle, Feature, FeatureValue, Plan, Price, Provider } from '@simply-sub/core';
import type { PreviewCatalog, PreviewFile } from './catalog-preview-data';

/** The prices one region sells in one currency ("CA · CAD"). A provider has one per region and currency. */
export interface PriceList {
  key: string;
  label: string;
}

export interface PriceView {
  amount: number;
  currency: string;
  /** "/ month", or "/ year, prepaid" when it doesn't renew by itself. */
  period: string;
}

export interface PlanView {
  id: string;
  name: string;
  prices: PriceView[];
  features: string[];
  perks: string[];
  notes?: string;
  addOns?: string;
}

export interface AddOnView {
  id: string;
  name: string;
  grants?: string;
  prices: PriceView[];
}

export interface ProviderCard {
  file: string;
  issues: string[];
  id?: string;
  name: string;
  category?: string;
  website?: string;
  notes?: string;
  lists: PriceList[];
  list?: string;
  plans: PlanView[];
  addOns: AddOnView[];
}

export interface BundleCard {
  file: string;
  issues: string[];
  name: string;
  soldBy?: string;
  includes: string[];
  prices: (PriceView & { list: string })[];
}

/** Lookups shared by every card: features by id and display names of providers and plans. */
export interface PreviewContext {
  features: Map<string, Feature>;
  categoryNames: Map<string, string>;
  names: Map<string, string>;
}

export function previewContext(catalog: PreviewCatalog): PreviewContext {
  const providers = catalog.providers.flatMap((file) => (file.data ? [file.data] : []));
  const names = new Map<string, string>();
  for (const provider of providers) {
    names.set(provider.id, provider.name);
    for (const plan of provider.plans) {
      names.set(
        plan.id,
        plan.name.includes(provider.name) ? plan.name : `${provider.name} ${plan.name}`,
      );
    }
  }
  return {
    features: new Map((catalog.features.data ?? []).map((feature) => [feature.id, feature])),
    categoryNames: new Map((catalog.categories.data?.service ?? []).map((c) => [c.id, c.name])),
    names,
  };
}

const listKey = (price: Price) => `${price.region} · ${price.currency}`;

/** Every region and currency the provider has prices in, in file order. */
export function priceLists(provider: Provider): PriceList[] {
  const prices = [...provider.plans, ...(provider.addOns ?? [])].flatMap((item) => item.prices);
  return [...new Set(prices.map(listKey))].map((key) => ({ key, label: key }));
}

/** Canada first (the app's home region), then any CAD price, then the first list. */
export function defaultPriceList(lists: PriceList[]): string | undefined {
  return (
    lists.find((list) => list.key.startsWith('CA ')) ??
    lists.find((list) => list.key.endsWith(' CAD')) ??
    lists[0]
  )?.key;
}

export function priceView(price: Price): PriceView {
  const unit =
    price.intervalCount === 1 ? price.interval : `${price.intervalCount} ${price.interval}s`;
  return {
    amount: price.amount,
    currency: price.currency,
    period: `/ ${unit}${price.autoRenew ? '' : ', prepaid'}`,
  };
}

/** The prices in one list. A free plan (one price of 0) is free in every list, whatever its currency. */
function pricesIn(prices: Price[], list: string | undefined): PriceView[] {
  const inList = prices.filter((price) => listKey(price) === list).map(priceView);
  const free = prices.length > 0 && prices.every((price) => price.amount === 0);
  return inList.length || !free ? inList : [priceView(prices[0])];
}

function optionName(feature: Feature, id: string, plan: Plan, context: PreviewContext): string {
  const label = plan.featureLabels?.[`${feature.id}=${id}`];
  if (label) return label;
  const values = 'values' in feature ? feature.values : undefined;
  if (values) return values.find((value) => value.id === id)?.name ?? id;
  return context.names.get(id) ?? id; // valuesFrom: providers lists provider and plan ids
}

/** "Video quality: 4K (Ultra HD)", with the plan's own wording where it has featureLabels. */
export function featureText(
  id: string,
  value: FeatureValue,
  plan: Plan,
  context: PreviewContext,
): string {
  const feature = context.features.get(id);
  const name = plan.featureLabels?.[id] ?? feature?.name ?? id;
  if (!feature) return `${name}: ${String(value)}`;
  switch (feature.type) {
    case 'boolean':
      return `${name}: ${value ? 'yes' : 'no'}`;
    case 'number':
      return value === 'unlimited'
        ? `${name}: unlimited`
        : `${name}: ${String(value)}${feature.unit ? ` ${feature.unit}` : ''}`;
    case 'enum':
      return `${name}: ${optionName(feature, String(value), plan, context)}`;
    case 'set': {
      const ids = Array.isArray(value) ? value : [String(value)];
      return `${name}: ${ids.map((item) => optionName(feature, item, plan, context)).join(', ')}`;
    }
  }
}

export function providerCard(
  file: PreviewFile<Provider>,
  chosen: string | undefined,
  context: PreviewContext,
): ProviderCard {
  const provider = file.data;
  if (!provider) {
    return {
      file: file.file,
      issues: file.issues,
      name: file.file,
      lists: [],
      plans: [],
      addOns: [],
    };
  }
  const lists = priceLists(provider);
  const list = lists.some((option) => option.key === chosen) ? chosen : defaultPriceList(lists);
  const addOnNames = new Map((provider.addOns ?? []).map((addOn) => [addOn.id, addOn.name]));
  return {
    file: file.file,
    issues: file.issues,
    id: provider.id,
    name: provider.name,
    category: context.categoryNames.get(provider.category) ?? provider.category,
    website: provider.website,
    notes: provider.notes,
    lists,
    list,
    plans: provider.plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      prices: pricesIn(plan.prices, list),
      features: Object.entries(plan.features).map(([id, value]) =>
        featureText(id, value, plan, context),
      ),
      perks: plan.perks ?? [],
      notes: plan.notes,
      addOns: plan.addOnIds
        ? plan.addOnIds.map((id) => addOnNames.get(id) ?? id).join(', ') +
          (plan.addOnLimit ? ` (up to ${plan.addOnLimit})` : '')
        : undefined,
    })),
    addOns: (provider.addOns ?? []).map((addOn) => ({
      id: addOn.id,
      name: addOn.name,
      grants: addOn.grantsPlan ? context.names.get(addOn.grantsPlan) : undefined,
      prices: pricesIn(addOn.prices, list),
    })),
  };
}

export function bundleCard(file: PreviewFile<Bundle>, context: PreviewContext): BundleCard {
  const bundle = file.data;
  if (!bundle) {
    return { file: file.file, issues: file.issues, name: file.file, includes: [], prices: [] };
  }
  return {
    file: file.file,
    issues: file.issues,
    name: bundle.name,
    soldBy: context.names.get(bundle.soldBy) ?? bundle.soldBy,
    includes: bundle.includes.map((id) => context.names.get(id) ?? id),
    prices: bundle.prices.map((price) => ({ ...priceView(price), list: listKey(price) })),
  };
}

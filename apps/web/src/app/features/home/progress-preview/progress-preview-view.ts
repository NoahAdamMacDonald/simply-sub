import {
  availability,
  pickPrice,
  type Availability,
  type CatalogSnapshot,
  type Feature,
  type FxRates,
  type PickedPrice,
  type SnapshotProvider,
} from '@simply-sub/core';

// TEMPORARY (see progress-preview.ts): turns the catalog the app downloads into cards, with prices picked by core's
// pickPrice for the chosen region and currency, as the real pages will (M4–M5).

export interface PriceLine {
  text: string;
  /** "≈ 13.79 CAD/month", plus where it came from when converted. */
  title: string;
}

export interface PlanCard {
  id: string;
  name: string;
  availability: Availability;
  prices: PriceLine[];
  features: string[];
}

export interface ProviderCard {
  id: string;
  name: string;
  category: string;
  /** The icon as a path on this site, so a local build shows its own files. */
  icon?: string;
  plans: PlanCard[];
}

const per: Record<PickedPrice['interval'], string> = {
  day: 'day',
  week: 'week',
  month: 'month',
  year: 'year',
};

/** An amount in a currency, the way the app will show money. */
export function money(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(amount);
}

function priceLine(price: PickedPrice): PriceLine {
  const period =
    price.intervalCount === 1
      ? per[price.interval]
      : `${price.intervalCount} ${per[price.interval]}s`;
  const free = price.amount === 0;
  const text = free
    ? 'Free'
    : `${price.native ? '' : '≈ '}${money(price.amount, price.currency)} / ${period}`;
  const source = `${money(price.source.amount, price.source.currency)} (${price.source.region})`;
  const title = price.native
    ? `Listed price: ${source}`
    : price.fx
      ? `Converted from ${source} at ${price.fx.rate.toFixed(4)} on ${price.fx.date}`
      : `No exchange rate yet: shown in ${price.source.currency}`;
  return { text, title };
}

/** A plan's feature as the registry names it: "VPN devices: 5 devices", "Ad free: yes", "Live TV and sports: Live sports". */
function featureText(registry: readonly Feature[], [id, value]: [string, unknown]): string {
  const feature = registry.find((candidate) => candidate.id === id);
  if (!feature) {
    return `${id}: ${String(value)}`;
  }
  const valueName = (item: unknown) =>
    feature.type === 'enum' || feature.type === 'set'
      ? (feature.values?.find((candidate) => candidate.id === item)?.name ?? String(item))
      : String(item);
  const shown =
    typeof value === 'boolean'
      ? value
        ? 'yes'
        : 'no'
      : Array.isArray(value)
        ? value.map(valueName).join(', ')
        : `${valueName(value)}${feature.type === 'number' && feature.unit ? ` ${feature.unit}` : ''}`;
  return `${feature.name}: ${shown}`;
}

/** One card per provider, each plan priced for `region` in `currency`. */
export function providerCards(
  catalog: CatalogSnapshot,
  region: string,
  currency: string,
  fx: FxRates | undefined,
): ProviderCard[] {
  return catalog.data.providers.map((provider: SnapshotProvider) => ({
    id: provider.id,
    name: provider.name,
    category: provider.category,
    ...(provider.iconUrl !== undefined && { icon: new URL(provider.iconUrl).pathname }),
    plans: provider.plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      availability: availability(plan.prices, provider, region),
      prices: pickPrice(plan.prices, {
        region,
        currency,
        billingCurrency: provider.billingCurrency,
        fx,
      }).map(priceLine),
      features: Object.entries(plan.features).map((entry) =>
        featureText(catalog.data.features, entry),
      ),
    })),
  }));
}

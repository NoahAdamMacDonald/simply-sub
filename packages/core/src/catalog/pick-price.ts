import type { IsoDate } from '../dates/iso-date';
import { exchangeRate, type FxRates } from './convert';
import { monthlyEquivalent } from './monthly-equivalent';
import type { Interval, Price } from './price';

// pickPrice (BLUEPRINT §4.7): which of a plan's, add-on's or bundle's stored prices a user sees, and in which
// currency. Everything is shown and totalled in the user's currency, converted when the price isn't in it.

export interface PriceContext {
  /** The user's region, from Settings or a list item's own region: what decides the price they're charged. */
  region: string;
  /** The user's currency. */
  currency: string;
  /** The provider's billingCurrency: in a region priced in several currencies, the one it charges. */
  billingCurrency?: Readonly<Record<string, string>>;
  /** Exchange rates (GET /fx). Without a rate, a price in another currency stays in its own. */
  fx?: FxRates;
}

/** A price as the user sees it. The key order matches the API's `pricing` (docs/api-output-examples.json). */
export interface PickedPrice {
  interval: Interval;
  intervalCount: number;
  /** In `currency`, at full precision. */
  amount: number;
  /** The user's currency, or the source's own when there was no rate to convert it. */
  currency: string;
  monthlyEquivalent: number;
  autoRenew: boolean;
  /** True when no conversion was needed: the source price is in the user's currency. */
  native: boolean;
  /** The stored price it comes from. */
  source: { region: string; amount: number; currency: string };
  /** The conversion, when there was one. `rate` is how much of `currency` one unit of the source's is worth. */
  fx?: { rate: number; date: IsoDate; source: string };
}

/** The regions to fall back to, in order, when nothing else fits (rule 4). */
const fallbackRegions = ['US', 'GB', 'EU'];

const periodOrder: Record<Interval, number> = { day: 0, week: 1, month: 2, year: 3 };

/**
 * The prices to show, one per interval and shortest first, all from one source region and currency, so a plan
 * never mixes a region's monthly price with another region's yearly one. The source is the first that fits:
 * 1. The user's region: what they're charged there, converted if it isn't in their currency.
 * 2. A price in the user's currency from elsewhere: GLOBAL first, then US, GB, EU and the regions listed.
 * 3. A GLOBAL price in another currency, converted.
 * 4. US, GB or EU, then the first region listed, converted.
 * In a region with several currencies, the user's wins, then the one billingCurrency names, then the first listed.
 * No prices give an empty list.
 */
export function pickPrice(prices: readonly Price[], context: PriceContext): PickedPrice[] {
  const source = pickSource(prices, context);
  return prices
    .filter((price) => price.region === source?.region && price.currency === source.currency)
    .sort(
      (a, b) =>
        periodOrder[a.interval] - periodOrder[b.interval] || a.intervalCount - b.intervalCount,
    )
    .map((price) => toPicked(price, context));
}

function pickSource(
  prices: readonly Price[],
  { region, currency, billingCurrency }: PriceContext,
): { region: string; currency: string } | undefined {
  const inRegion = (where: string) => {
    const currencies = prices
      .filter((price) => price.region === where)
      .map((price) => price.currency);
    const charged =
      billingCurrency && Object.hasOwn(billingCurrency, where) ? billingCurrency[where] : undefined;
    const chosen = [currency, charged, currencies[0]].find(
      (candidate) => candidate !== undefined && currencies.includes(candidate),
    );
    return chosen === undefined ? undefined : { region: where, currency: chosen };
  };
  const elsewhere = [
    ...new Set(['GLOBAL', ...fallbackRegions, ...prices.map((price) => price.region)]),
  ];
  const sameCurrency = elsewhere.find((where) =>
    prices.some((price) => price.region === where && price.currency === currency),
  );
  return (
    inRegion(region) ??
    (sameCurrency === undefined ? undefined : { region: sameCurrency, currency }) ??
    elsewhere.map(inRegion).find((found) => found !== undefined)
  );
}

function toPicked(price: Price, { currency, fx }: PriceContext): PickedPrice {
  const native = price.currency === currency;
  const rate = native || !fx ? undefined : exchangeRate(price.currency, currency, fx);
  const amount = rate === undefined ? price.amount : price.amount * rate;
  return {
    interval: price.interval,
    intervalCount: price.intervalCount,
    amount,
    currency: native || rate !== undefined ? currency : price.currency,
    monthlyEquivalent: monthlyEquivalent({ ...price, amount }),
    autoRenew: price.autoRenew,
    native,
    source: { region: price.region, amount: price.amount, currency: price.currency },
    ...(fx && rate !== undefined && { fx: { rate, date: fx.date, source: fx.source } }),
  };
}

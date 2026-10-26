import * as z from 'zod';
import { exchangeRate, type FxRates } from './convert';
import { currencySchema, isoDateSchema, regionSchema, textSchema } from './formats';
import { monthlyEquivalent } from './monthly-equivalent';
import { intervalSchema, type Interval, type Price } from './price';
import { globalRegion, groupsOf } from './regions';

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

/** A price as the user sees it: the API's `pricing` entries (docs/api-output-examples.json), in their key order. */
export const pickedPriceSchema = z.strictObject({
  interval: intervalSchema,
  intervalCount: z.int().positive(),
  amount: z
    .number()
    .nonnegative()
    .describe('In currency, at full precision (the API rounds it to 2 decimals)'),
  currency: currencySchema.describe(
    "The user's currency, or the source's own when there was no rate to convert it",
  ),
  monthlyEquivalent: z.number().nonnegative(),
  autoRenew: z.boolean(),
  native: z
    .boolean()
    .describe(
      "True when no conversion was needed: the source price is in the user's currency, or free (0 is 0 anywhere)",
    ),
  taxIncluded: z
    .literal(true)
    .describe(
      "The source price includes sales tax wherever the buyer is (its catalog price's taxIncluded)",
    )
    .optional(),
  source: z
    .strictObject({
      region: regionSchema,
      amount: z.number().nonnegative(),
      currency: currencySchema,
    })
    .describe('The stored price it comes from'),
  fx: z
    .strictObject({
      rate: z
        .number()
        .positive()
        .describe("How much of currency one unit of the source's is worth"),
      date: isoDateSchema,
      source: textSchema,
    })
    .describe('The conversion, when there was one')
    .optional(),
});
export type PickedPrice = z.infer<typeof pickedPriceSchema>;

/** The regions to fall back to, in order, when nothing else fits (rule 4). */
const fallbackRegions = ['US', 'GB', 'EU'];

const periodOrder: Record<Interval, number> = { day: 0, week: 1, month: 2, year: 3 };

/**
 * The prices to show, one per interval and shortest first, all from one source region and currency, so a plan
 * never mixes a region's monthly price with another region's yearly one. The source is the first that fits:
 * 1. The user's region, then a group it belongs to (EU for Sweden): what they're charged there, converted if it
 *    isn't in their currency.
 * 2. A price in the user's currency from elsewhere: GLOBAL first, then US, GB, EU and the regions listed.
 * 3. A GLOBAL price in another currency, converted.
 * 4. US, GB or EU, then the first region listed, converted.
 * In a region with several currencies, the user's wins, then the one billingCurrency names, then the first listed.
 * A free price is native whatever its currency, since 0 needs no rate. No prices give an empty list. Whether the
 * item is sold in the user's region at all is availability's question (availability.ts).
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
    ...new Set([globalRegion, ...fallbackRegions, ...prices.map((price) => price.region)]),
  ];
  const sameCurrency = elsewhere.find((where) =>
    prices.some((price) => price.region === where && price.currency === currency),
  );
  return (
    [region, ...groupsOf(region)].map(inRegion).find((found) => found !== undefined) ??
    (sameCurrency === undefined ? undefined : { region: sameCurrency, currency }) ??
    elsewhere.map(inRegion).find((found) => found !== undefined)
  );
}

function toPicked(price: Price, { currency, fx }: PriceContext): PickedPrice {
  const native = price.currency === currency || price.amount === 0;
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
    ...(price.taxIncluded && { taxIncluded: true as const }),
    source: { region: price.region, amount: price.amount, currency: price.currency },
    ...(fx && rate !== undefined && { fx: { rate, date: fx.date, source: fx.source } }),
  };
}

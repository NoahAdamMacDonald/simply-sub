import { z } from 'zod';
import { fxRatesSchema, type FxRates } from './convert';
import { currencySchema, isoDateSchema } from './formats';

// The ECB's daily reference rates (BLUEPRINT §5.2), which GET /fx serves and GET /providers converts prices with.
// The Worker fetches them from Frankfurter in euros, the ECB's own base, keeps them in KV, and turns them into
// rates for the user's currency with rebaseRates, so one fetch serves every base.

export const fxSource = 'European Central Bank via Frankfurter';

/** Frankfurter's v2 route for the ECB's rates alone, in euros. Its default blends other central banks in. */
export const ecbRatesUrl = 'https://api.frankfurter.dev/v2/providers/ecb/rates?base=EUR';

/** How long fetched rates stay fresh: then the Worker asks Frankfurter again (12 hours). */
export const fxFreshSeconds = 12 * 60 * 60;

export const ecbRatesSchema = z.strictObject({
  date: isoDateSchema.describe("The ECB's reference date"),
  rates: z
    .record(currencySchema, z.number().positive())
    .describe('Currency → how much of it one euro buys'),
});
export type EcbRates = z.infer<typeof ecbRatesSchema>;

/** The rates the Worker keeps in KV: when it fetched them, too. */
export const keptEcbRatesSchema = ecbRatesSchema.safeExtend({
  fetchedAt: z.iso.datetime().describe('When Frankfurter answered, in UTC'),
});
export type KeptEcbRates = z.infer<typeof keptEcbRatesSchema>;

/**
 * GET /fx's body (docs/api-output-examples.json): the rates in the requested base, when Frankfurter gave them, and
 * whether they're the last good ones, kept while it's down.
 */
export const fxBodySchema = z.strictObject({
  data: fxRatesSchema.extend({ source: z.literal(fxSource) }),
  meta: z.strictObject({
    fetchedAt: keptEcbRatesSchema.shape.fetchedAt,
    stale: z.boolean().describe('True when Frankfurter failed and these are the last good rates'),
  }),
});
export type FxBody = z.infer<typeof fxBodySchema>;

/** One row of Frankfurter's answer. Other fields it may add are ignored. */
const frankfurterRowsSchema = z.array(
  z.object({
    date: isoDateSchema,
    base: z.literal('EUR'),
    quote: currencySchema,
    rate: z.number().positive(),
  }),
);

/**
 * Frankfurter's answer to ecbRatesUrl as EcbRates, or undefined when it isn't one day's euro rates: anything else
 * from the network is treated as a failed fetch.
 */
export function readEcbRates(json: unknown): EcbRates | undefined {
  const rows = frankfurterRowsSchema.safeParse(json);
  const others = rows.success ? rows.data.filter((row) => row.quote !== 'EUR') : [];
  const date = others[0]?.date;
  if (date === undefined || others.some((row) => row.date !== date)) {
    return undefined;
  }
  const rates = others
    .map((row): [string, number] => [row.quote, row.rate])
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return { date, rates: Object.fromEntries(rates) };
}

/** The currencies the rates can be given in, sorted: the euro and every currency the ECB has a rate for. */
export function ecbCurrencies(ecb: EcbRates): string[] {
  return ['EUR', ...Object.keys(ecb.rates)].sort();
}

/**
 * The rates relative to `base`, the user's currency, for every other currency, the euro included: GET /fx's data.
 * In euros they're the ECB's own. In another base they're rounded to 6 significant digits, more than the ECB's
 * rates carry and never fewer than Frankfurter's own rebased rates show. Undefined when the ECB has no rate for
 * `base`.
 */
export function rebaseRates(ecb: EcbRates, base: string): FxRates | undefined {
  const perEuro = (currency: string) =>
    currency === 'EUR' ? 1 : Object.hasOwn(ecb.rates, currency) ? ecb.rates[currency] : undefined;
  const baseRate = perEuro(base);
  if (baseRate === undefined) {
    return undefined;
  }
  const rates = ecbCurrencies(ecb)
    .filter((currency) => currency !== base)
    .map((currency): [string, number] => {
      const rate = (perEuro(currency) ?? 0) / baseRate;
      return [currency, base === 'EUR' ? rate : Number(rate.toPrecision(6))];
    });
  return { base, date: ecb.date, source: fxSource, rates: Object.fromEntries(rates) };
}

/**
 * How many more seconds rates fetched at `fetchedAt` stay fresh at `now`, both ISO 8601 timestamps: 0 once they're
 * due to be fetched again, and never more than fxFreshSeconds, even if the clocks disagree.
 */
export function fxFreshFor(fetchedAt: string, now: string): number {
  const age = (Date.parse(now) - Date.parse(fetchedAt)) / 1000;
  return Math.min(fxFreshSeconds, Math.max(0, Math.floor(fxFreshSeconds - age)));
}

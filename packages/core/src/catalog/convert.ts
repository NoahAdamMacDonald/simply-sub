import { z } from 'zod';
import { currencySchema, isoDateSchema, textSchema } from './formats';

// Exchange rates and currency conversion (BLUEPRINT §4.7). The rates are GET /fx's data: the ECB's daily rates
// from Frankfurter, relative to the user's currency.

export const fxRatesSchema = z.strictObject({
  base: currencySchema.describe("The currency the rates are relative to: the user's"),
  date: isoDateSchema.describe("The ECB's reference date for the rates"),
  source: textSchema.describe('Where the rates come from: European Central Bank via Frankfurter'),
  rates: z
    .record(currencySchema, z.number().positive())
    .describe('Currency → how much of it one unit of base buys (CAD base: USD 0.7243)'),
});
export type FxRates = z.infer<typeof fxRatesSchema>;

/** How much of `to` one unit of `from` is worth, or undefined when `fx` has no rate for either. */
export function exchangeRate(from: string, to: string, fx: FxRates): number | undefined {
  const perBase = (currency: string) =>
    currency === fx.base ? 1 : Object.hasOwn(fx.rates, currency) ? fx.rates[currency] : undefined;
  const fromRate = perBase(from);
  const toRate = perBase(to);
  return fromRate === undefined || toRate === undefined ? undefined : toRate / fromRate;
}

/** `amount` of `from` in `to`, at full precision, or undefined without a rate. Only the UI rounds. */
export function convert(amount: number, from: string, to: string, fx: FxRates): number | undefined {
  const rate = exchangeRate(from, to, fx);
  return rate === undefined ? undefined : amount * rate;
}

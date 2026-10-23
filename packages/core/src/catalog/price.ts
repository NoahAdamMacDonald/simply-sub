import { z } from 'zod';
import { currencySchema, httpsUrlSchema, isoDateSchema, regionSchema } from './formats';

export const intervalSchema = z.enum(['day', 'week', 'month', 'year']);
export type Interval = z.infer<typeof intervalSchema>;

/** One stored price: a plan, add-on or bundle's cost in one region for one billing period. */
export const priceSchema = z.strictObject({
  region: regionSchema.describe(
    'Where this price applies: an ISO 3166-1 alpha-2 region, or GLOBAL',
  ),
  currency: currencySchema.describe('The ISO 4217 currency of amount'),
  amount: z
    .number()
    .positive('Must be more than 0')
    .describe("In the currency's major unit: 18.99 means $18.99"),
  interval: intervalSchema.describe('The billing period unit'),
  intervalCount: z
    .int()
    .positive('Must be a whole number of at least 1')
    .describe('How many intervals one payment covers: 3 with month means quarterly'),
  autoRenew: z.boolean().describe('false for prepaid plans that have to be renewed by hand'),
  lastVerified: isoDateSchema.describe(
    "The date someone last checked this price on the provider's site",
  ),
  sourceUrl: httpsUrlSchema.describe('The page the price was read from').optional(),
});
export type Price = z.infer<typeof priceSchema>;

export const pricesSchema = z.array(priceSchema).min(1, 'List at least one price');

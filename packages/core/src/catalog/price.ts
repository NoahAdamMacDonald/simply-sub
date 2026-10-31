import * as z from 'zod';
import { currencySchema, httpsUrlSchema, isoDateSchema, regionSchema, textSchema } from './formats';

export const intervalSchema = z.enum(['day', 'week', 'month', 'year']);
export type Interval = z.infer<typeof intervalSchema>;

/**
 * One stored price: a plan, add-on or bundle's cost in one region for one billing period. A free plan has one
 * price of 0 (BLUEPRINT §4.3). A billing period no longer sold keeps its price, `retired` (M10.28).
 */
export const priceSchema = z
  .strictObject({
    region: regionSchema.describe(
      'Where this price applies: an ISO 3166-1 alpha-2 region, or GLOBAL',
    ),
    currency: currencySchema.describe('The ISO 4217 currency of amount'),
    amount: z
      .number()
      .nonnegative('Must be 0 or more')
      .describe("In the currency's major unit: 18.99 means $18.99. 0 means a free plan"),
    interval: intervalSchema.describe('The billing period unit'),
    intervalCount: z
      .int()
      .positive('Must be a whole number of at least 1')
      .describe('How many intervals one payment covers: 3 with month means quarterly'),
    autoRenew: z.boolean().describe('false for prepaid plans that have to be renewed by hand'),
    taxIncluded: z
      .strictObject({
        quote: textSchema.describe(
          'The source page\'s own words that say so (Mullvad\'s "Including VAT."), which the nightly check looks for',
        ),
      })
      .describe(
        "The amount already includes sales tax wherever the buyer is, so none is added in Canada or the US. Left out, the buyer's region decides (BLUEPRINT §4.8)",
      )
      .optional(),
    lastVerified: isoDateSchema.describe(
      "The date someone last checked this price on the provider's site",
    ),
    sourceUrl: httpsUrlSchema.describe('The page the price was read from').optional(),
    retired: isoDateSchema
      .describe(
        'The day this billing period stopped being sold to new subscribers (M10.28): never delete a price. Items billed this way switch to the closest period still sold at their next renewal',
      )
      .optional(),
    endsOn: isoDateSchema
      .describe(
        'When the provider lets existing subscribers keep this period longer: the day they lose it. Needs retired',
      )
      .optional(),
  })
  .superRefine(({ retired, endsOn }, ctx) => {
    if (endsOn === undefined) return;
    if (retired === undefined) {
      ctx.addIssue({ code: 'custom', message: 'endsOn needs retired', path: ['endsOn'] });
    } else if (endsOn < retired) {
      ctx.addIssue({
        code: 'custom',
        message: `Must be on or after retired (${retired})`,
        path: ['endsOn'],
      });
    }
  });
export type Price = z.infer<typeof priceSchema>;

export const pricesSchema = z.array(priceSchema).min(1, 'List at least one price');

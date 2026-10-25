import { z } from 'zod';
import { currencySchema } from '../catalog/formats';
import { countrySchema, timestampSchema } from './record';

const subdivisionSchema = z
  .string()
  .regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/, 'Use an ISO 3166-2 code (CA-ON)');

/**
 * The user's settings: one record, under the key `settings` (BLUEPRINT §4.6). The app lock's settings (M6.10) and
 * per-device preferences (PROJECT-PLAN §3.5) arrive with their tasks as optional fields, which stored records
 * without them still pass.
 */
export const settingsSchema = z
  .strictObject({
    key: z.literal('settings'),
    /** The region for pickPrice, and where sales tax is decided (BLUEPRINT §4.8). */
    country: countrySchema,
    /** The ISO 3166-2 province or state, in a country where tax is added (CA-ON). */
    subdivision: subdivisionSchema.optional(),
    currency: currencySchema,
    /** The user's own rate, in place of the built-in one. */
    salesTaxPercent: z.number().min(0).max(100).optional(),
    monthlyBudget: z.number().positive('Must be more than 0').optional(),
    annualBudget: z.number().positive('Must be more than 0').optional(),
    theme: z.enum(['system', 'light', 'dark']),
    updatedAt: timestampSchema,
  })
  .superRefine(({ country, subdivision }, ctx) => {
    // A malformed country or subdivision has its own issue.
    if (
      subdivision !== undefined &&
      countrySchema.safeParse(country).success &&
      subdivisionSchema.safeParse(subdivision).success &&
      !subdivision.startsWith(`${country}-`)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Use a subdivision of the chosen country',
        path: ['subdivision'],
      });
    }
  });
export type Settings = z.infer<typeof settingsSchema>;

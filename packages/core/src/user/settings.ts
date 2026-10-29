import * as z from 'zod';
import { budgetWarningKeyPattern, maxDismissedBudgetWarnings } from '../budget/budget-dismissals';
import { currencySchema } from '../catalog/formats';
import { appLockSchema } from './app-lock';
import { countrySchema, recordIdSchema, timestampSchema } from './record';

const subdivisionSchema = z
  .string()
  .regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/, 'Use an ISO 3166-2 code (CA-ON)');

/**
 * The user's settings: one record, under the key `settings` (BLUEPRINT §4.6). Per-device preferences (PROJECT-PLAN
 * §3.5) arrive with their tasks as optional fields, which stored records without them still pass.
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
    /** Search starts with "Sold in <country>" on (PROJECT-PLAN P8, P13, M5.6). Left out, it starts off. */
    searchSoldOnly: z.literal(true).optional(),
    /**
     * Search lists every official reseller of a plan, cheaper or not (P8, P13, M5.13). Left out, only the ones that sell
     * it for less.
     */
    searchAllResellers: z.literal(true).optional(),
    /**
     * The lists the Calendar leaves out, as last chosen on this device (P10, §3.5, M7.4), so a list made since shows.
     * Left out, it shows them all.
     */
    calendarHiddenLists: z.array(recordIdSchema).min(1).optional(),
    /**
     * The budget warnings dismissed on Home and List view (P2, P4, M7.7), each hidden until its period or budget
     * changes: core's budgetWarningKey. Left out, none are.
     */
    dismissedBudgetWarnings: z
      .array(z.string().regex(budgetWarningKeyPattern, 'Use a budget warning’s key'))
      .min(1)
      .max(maxDismissedBudgetWarnings)
      .optional(),
    /**
     * The app lock (P13, M6.10; BLUEPRINT §11.5), when it's on: no secret, only the salt and a sealed check value. It
     * stays plain while the rest of the settings are sealed, and only the storage engine's lock methods change it.
     */
    appLock: appLockSchema.optional(),
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

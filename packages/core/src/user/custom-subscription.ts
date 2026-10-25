import { z } from 'zod';
import { addDuplicateIssues } from '../catalog/checks';
import { featureValueSchema } from '../catalog/feature';
import { currencySchema, dottedSlugSchema, httpsUrlSchema, textSchema } from '../catalog/formats';
import { intervalSchema } from '../catalog/price';
import { recordIdSchema, recordMetaShape } from './record';

// A service that isn't in the catalog (BLUEPRINT §4.6, P12). Its plans behave like catalog plans in lists, the
// calendar, ranks and exports. Feature ids aren't checked against the registry here: a feature the registry later
// drops mustn't hide the user's record.

/** What a custom plan costs. Typed by the user, so it includes sales tax unless `plusTax` (BLUEPRINT §4.8). */
const customPriceSchema = z.strictObject({
  amount: z.number().nonnegative('Must be 0 or more'),
  currency: currencySchema,
  interval: intervalSchema,
  intervalCount: z.int().positive('Must be a whole number of at least 1'),
  plusTax: z.boolean().optional(),
});

const customPlanSchema = z.strictObject({
  id: recordIdSchema,
  name: textSchema,
  features: z.record(dottedSlugSchema, featureValueSchema),
  price: customPriceSchema,
  autoRenewAvailable: z.boolean(),
});
export type CustomPlan = z.infer<typeof customPlanSchema>;

export const customSubscriptionSchema = z
  .strictObject({
    ...recordMetaShape,
    name: textSchema,
    link: httpsUrlSchema.optional(),
    cancelUrl: httpsUrlSchema.optional(),
    plans: z.array(customPlanSchema).min(1, 'List at least one plan'),
  })
  .superRefine((sub, ctx) => {
    const ids = sub.plans.map((plan) => plan.id);
    addDuplicateIssues(ctx, ids, (index) => ['plans', index, 'id']);
  });
export type CustomSubscription = z.infer<typeof customSubscriptionSchema>;

import { z } from 'zod';
import { addDuplicateIssues } from './checks';
import { featureValueSchema } from './feature';
import {
  aliasesSchema,
  currencySchema,
  dottedSlugSchema,
  httpsUrlSchema,
  planIdSchema,
  rankKeySchema,
  regionSchema,
  slugSchema,
  textSchema,
} from './formats';
import { pricesSchema } from './price';

// One provider file, data/providers/<id>.yaml (BLUEPRINT §4.3). The schema checks each file on its own. Feature
// ids and values against the registry, category ids, and add-on and plan references are checked by
// validateCatalog (validate-catalog.ts).

/** BLUEPRINT §9.2. A provider lists the networks it accepts; leaving the list out means unknown. */
export const cardNetworkSchema = z.enum([
  'visa',
  'mastercard',
  'amex',
  'discover',
  'interac',
  'unionpay',
  'jcb',
  'other',
]);
export type CardNetwork = z.infer<typeof cardNetworkSchema>;

export const planSchema = z
  .strictObject({
    id: planIdSchema.describe('<provider id>.<slug> (netflix.standard)'),
    name: textSchema.describe('The plan name, without the provider name (Standard)'),
    link: httpsUrlSchema.describe('Where to sign up for this plan').optional(),
    features: z
      .record(dottedSlugSchema, featureValueSchema)
      .describe(
        'Feature id → value, using ids from features.yaml. Unlisted booleans count as false and unlisted sets as empty',
      ),
    featureLabels: z
      .record(rankKeySchema, textSchema)
      .describe(
        "Feature id or rank key → the provider's own wording, shown instead of the registry name",
      )
      .optional(),
    perks: z
      .array(textSchema)
      .min(1, 'Leave perks out instead of listing none')
      .describe('Provider-specific extras, shown but never compared')
      .optional(),
    notes: textSchema.describe('Shown on the plan').optional(),
    prices: pricesSchema,
    addOnIds: z
      .array(planIdSchema)
      .min(1, 'Leave addOnIds out instead of listing none')
      .describe("Ids of this provider's add-ons that can be bought with this plan")
      .optional(),
    addOnLimit: z
      .int()
      .positive('Must be a whole number of at least 1')
      .describe('The most add-ons this plan allows in total (extra members)')
      .optional(),
  })
  .superRefine((plan, ctx) => {
    addDuplicateIssues(ctx, plan.addOnIds ?? [], (index) => ['addOnIds', index]);
    if (plan.addOnLimit !== undefined && plan.addOnIds === undefined) {
      ctx.addIssue({ code: 'custom', message: 'addOnLimit needs addOnIds', path: ['addOnLimit'] });
    }
  });
export type Plan = z.infer<typeof planSchema>;

export const addOnSchema = z.strictObject({
  id: planIdSchema.describe('<provider id>.<slug> (netflix.extra-member)'),
  name: textSchema.describe('Display name'),
  grantsPlan: planIdSchema
    .describe("The plan whose features the add-on gives (an extra member's plan)")
    .optional(),
  prices: pricesSchema,
});
export type AddOn = z.infer<typeof addOnSchema>;

export const providerSchema = z
  .strictObject({
    id: slugSchema.describe('Stable provider id, the same as the file name (netflix)'),
    name: textSchema.describe('Display name'),
    aliases: aliasesSchema.optional(),
    website: httpsUrlSchema.describe('The home page'),
    category: slugSchema.describe('A service category id from categories.yaml'),
    spendCategory: slugSchema.describe(
      'A spend category id from categories.yaml, for card rewards',
    ),
    acceptedNetworks: z
      .array(cardNetworkSchema)
      .min(1, 'Leave acceptedNetworks out when they are unknown')
      .describe(
        'Card networks the provider accepts. Leave it out when unknown, and every card is allowed',
      )
      .optional(),
    billingCurrency: z
      .record(regionSchema, currencySchema)
      .describe('Region → the currency actually charged there, for FX-fee maths')
      .optional(),
    cancelUrl: httpsUrlSchema.describe('Where to cancel').optional(),
    cancelFee: textSchema
      .describe('Any cancellation fee. Leave it out when there is none')
      .optional(),
    sources: z
      .strictObject({
        pricing: httpsUrlSchema.describe('The pricing page the prices were read from').optional(),
      })
      .describe('Pages the catalog data was taken from')
      .optional(),
    notes: textSchema.describe('Shown on the provider').optional(),
    plans: z.array(planSchema).min(1, 'List at least one plan'),
    addOns: z
      .array(addOnSchema)
      .min(1, 'Leave addOns out instead of listing none')
      .describe('Extras bought on top of a plan; plans list the ones they allow in addOnIds')
      .optional(),
  })
  .superRefine((provider, ctx) => {
    // Plan and add-on ids live under the provider's id, so they're unique across the catalog. A badly formed
    // provider id already has its own issue, so the prefix check skips it.
    const prefix = `${provider.id}.`;
    const ids = [
      ...provider.plans.map((plan, index) => ({ id: plan.id, path: ['plans', index, 'id'] })),
      ...(provider.addOns ?? []).map((addOn, index) => ({
        id: addOn.id,
        path: ['addOns', index, 'id'],
      })),
    ];
    if (slugSchema.safeParse(provider.id).success) {
      for (const { id, path } of ids) {
        if (!id.startsWith(prefix)) {
          ctx.addIssue({ code: 'custom', message: `Must start with "${prefix}"`, path });
        }
      }
    }
    addDuplicateIssues(
      ctx,
      ids.map(({ id }) => id),
      (index) => ids[index].path,
    );
  })
  .meta({
    title: 'Simply Sub provider',
    description:
      'data/providers/<id>.yaml: one provider with its plans and add-ons (BLUEPRINT §4.3)',
  });
export type Provider = z.infer<typeof providerSchema>;

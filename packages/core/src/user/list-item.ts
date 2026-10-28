import * as z from 'zod';
import { addDuplicateIssues } from '../catalog/checks';
import {
  bundleIdSchema,
  currencySchema,
  isoDateSchema,
  planIdSchema,
  rankKeySchema,
  textSchema,
} from '../catalog/formats';
import { intervalSchema } from '../catalog/price';
import { addDays } from '../dates/iso-date';
import { rankSchema } from './rank';
import { countrySchema, recordIdSchema, recordMetaShape } from './record';

// One subscription in a list (BLUEPRINT §4.6). The rules the schedule engine relies on are checked here, so a stored
// record that breaks them is rejected; the item dialog's own rules (windows that overlap, an add-on the plan doesn't
// offer) are form checks (P6), since they depend on the catalog.

const positiveCount = z.int().positive('Must be a whole number of at least 1');

const addOnChoiceSchema = z.strictObject({
  id: planIdSchema,
  quantity: positiveCount,
});

/** What the item is: a catalog plan with its add-ons, a bundle (whose plans come from the catalog), or a custom plan. */
export const itemSourceSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('catalog'),
      planId: planIdSchema,
      addOns: z
        .array(addOnChoiceSchema)
        .min(1, 'Leave addOns out instead of listing none')
        .optional(),
    })
    .superRefine((source, ctx) => {
      const ids = (source.addOns ?? []).map((addOn) => addOn.id);
      addDuplicateIssues(ctx, ids, (index) => ['addOns', index, 'id']);
    }),
  z.strictObject({ kind: z.literal('bundle'), bundleId: bundleIdSchema }),
  z.strictObject({
    kind: z.literal('custom'),
    customSubId: recordIdSchema,
    customPlanId: recordIdSchema,
  }),
]);
export type ItemSource = z.infer<typeof itemSourceSchema>;

/** Ongoing billing: charges fall on `anchorDate` plus or minus whole intervals (PROJECT-PLAN §3.1). */
const recurringBillingSchema = z
  .strictObject({
    mode: z.literal('recurring'),
    interval: intervalSchema,
    intervalCount: positiveCount,
    /** A known charge date; every other date is counted from it. */
    anchorDate: isoDateSchema,
    /** Month and year intervals: the day it's billed on, when anchorDate is a shorter month's last day. */
    billingDay: z.union([z.literal(29), z.literal(30), z.literal(31)]).optional(),
    /** Subscribed since: no charges before it. */
    startDate: isoDateSchema.optional(),
    /** Planned cancellation: no charges from this date on. */
    endDate: isoDateSchema.optional(),
    /** false: charges are still projected, marked "renew manually". */
    autoRenew: z.boolean(),
  })
  .superRefine((billing, ctx) => {
    if (billing.billingDay !== undefined) {
      if (billing.interval !== 'month' && billing.interval !== 'year') {
        ctx.addIssue({
          code: 'custom',
          message: 'billingDay is only for month and year intervals',
          path: ['billingDay'],
        });
      } else if (
        // A malformed anchor date has its own issue.
        isoDateSchema.safeParse(billing.anchorDate).success &&
        !isShortMonthEnd(billing.anchorDate, billing.billingDay)
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'billingDay needs anchorDate to be the last day of a month shorter than it',
          path: ['billingDay'],
        });
      }
    }
    if (billing.startDate && billing.endDate && billing.endDate <= billing.startDate) {
      ctx.addIssue({ code: 'custom', message: 'Must be after startDate', path: ['endDate'] });
    }
  });

/** One paid period of a limited item. Active from `start` through `end`, both included. */
const billingWindowSchema = z
  .strictObject({
    start: isoDateSchema,
    end: isoDateSchema,
    repeatYearly: z.boolean(),
  })
  .refine((window) => window.end > window.start, { message: 'Must be after start', path: ['end'] });

/** Specific dates: a charge at each window's start, then one every interval before the window's end. */
const limitedBillingSchema = z.strictObject({
  mode: z.literal('limited'),
  windows: z.array(billingWindowSchema).min(1, 'List at least one window'),
  interval: intervalSchema,
  intervalCount: positiveCount,
});

export const billingSchema = z.discriminatedUnion('mode', [
  recurringBillingSchema,
  limitedBillingSchema,
]);
export type Billing = z.infer<typeof billingSchema>;

/** The longest nickname and note an item can have (P6). */
export const maxNicknameLength = 60;
export const maxNoteLength = 1000;

/** What the user pays instead of the catalog price: a promo, a first-term offer or a grandfathered price. */
export const priceOverrideSchema = z.strictObject({
  amount: z.number().positive('Must be more than 0'),
  currency: currencySchema,
  /** The date the catalog price applies again: charges dated before it use the override. */
  until: isoDateSchema.optional(),
  /** The amount is before sales tax; without it, the amount includes tax (BLUEPRINT §4.8). */
  plusTax: z.boolean().optional(),
});
export type PriceOverride = z.infer<typeof priceOverrideSchema>;

export const listItemSchema = z
  .strictObject({
    ...recordMetaShape,
    listId: recordIdSchema,
    source: itemSourceSchema,
    /** Bought in another country than Settings' (pickPrice's and availability's region). */
    region: countrySchema.optional(),
    billing: billingSchema,
    priceOverride: priceOverrideSchema.optional(),
    cardId: recordIdSchema.optional(),
    tagIds: z.array(recordIdSchema),
    /** Subscription-level ranks; a key that isn't here takes the profile rank (PROJECT-PLAN §3.2). */
    rankOverrides: z.record(rankKeySchema, rankSchema),
    pinned: z.boolean(),
    /** The user's own name for it, which tells two of the same plan apart: "Mom's". */
    nickname: textSchema
      .max(maxNicknameLength, `Use at most ${maxNicknameLength} characters`)
      .optional(),
    /** A note of the user's own. */
    note: textSchema.max(maxNoteLength, `Use at most ${maxNoteLength} characters`).optional(),
  })
  .superRefine((item, ctx) => {
    addDuplicateIssues(ctx, item.tagIds, (index) => ['tagIds', index]);
  });
export type ListItem = z.infer<typeof listItemSchema>;

/**
 * True when `date` is the last day of its month and that month has fewer than `billingDay` days: Feb 28 for a plan
 * billed on the 31st.
 */
function isShortMonthEnd(date: string, billingDay: number): boolean {
  return addDays(date, 1).endsWith('-01') && Number(date.slice(8)) < billingDay;
}

import * as z from 'zod';
import { currencySchema, httpsUrlSchema, isoDateSchema, textSchema } from './formats';

// A finance account's terms (BLUEPRINT §4.11, M11.10): what a plan's price can't say. An account is a plan, its
// monthly fee the plan's price ($0 for a free account), so totals and the schedule work unchanged; this block holds the
// kind of account, what waives its fee, its posted rates, its limits, what protects the money, and who may open it.
// The pages it quotes are checked against the catalog by validateCatalog.

/** The kinds of account a plan can be: banking, the registered accounts, a GIC, or an investing account. */
export const accountKinds = [
  'chequing',
  'savings',
  'usd',
  'tfsa',
  'rrsp',
  'fhsa',
  'resp',
  'rdsp',
  'rrif',
  'lira',
  'gic',
  'investing',
] as const;
export const accountKindSchema = z.enum(accountKinds);
export type AccountKind = z.infer<typeof accountKindSchema>;

const amountSchema = z
  .number()
  .positive('Must be more than 0')
  .describe("In the account's currency's major unit: 3000 means $3,000");
const percentSchema = z
  .number()
  .nonnegative('Must be 0 or more')
  .max(100, 'Must be a percentage, 100 at most')
  .describe('A year, in percent: 2.25 means 2.25%');

/**
 * Something the user does or is that waives the fee, or earns a bonus rate (M11.11 asks which they meet). Each field is
 * one condition, and a waiver may need several together: a balance, direct deposits, deposits a month, the assets
 * held with the provider, an age, being a student or a newcomer.
 */
export const accountConditionSchema = z
  .strictObject({
    minBalance: amountSchema
      .describe(
        'Keep at least this much in the account, as the page counts it (a daily or a monthly minimum)',
      )
      .optional(),
    directDeposit: z
      .union([z.literal(true), amountSchema])
      .describe(
        'A recurring direct deposit, such as a pay cheque: true for any, or at least this much a month',
      )
      .optional(),
    monthlyDeposits: amountSchema
      .describe(
        'Deposits of at least this much a month, from anywhere (KOHO’s "add $1,000 each month")',
      )
      .optional(),
    minAssets: amountSchema
      .describe('At least this much held with the provider, in all accounts')
      .optional(),
    maxAge: z
      .int()
      .positive('Must be a whole number of years')
      .describe('This age or under')
      .optional(),
    minAge: z
      .int()
      .positive('Must be a whole number of years')
      .describe('This age or over')
      .optional(),
    student: z.literal(true).describe('A full-time student, as the page defines it').optional(),
    newcomer: z.literal(true).describe('New to Canada, as the page defines it').optional(),
  })
  .refine((condition) => Object.keys(condition).length > 0, {
    message: 'Say what it takes: a balance, a direct deposit, an age… (one or more of its fields)',
  });
export type AccountCondition = z.infer<typeof accountConditionSchema>;

export const rateTierSchema = z.strictObject({
  from: z
    .number()
    .nonnegative('Must be 0 or more')
    .describe('The balance this rate starts at; the first tier starts at 0'),
  rate: percentSchema,
});
export type RateTier = z.infer<typeof rateTierSchema>;

/** A rate in place of the tiers when the user meets a condition (EQ Bank: $2,000 of direct deposits a month). */
const rateBonusSchema = z
  .strictObject({
    rate: percentSchema,
    when: accountConditionSchema.describe(
      'What earns it (EQ Bank: $2,000 of direct deposits a month)',
    ),
  })
  .describe(
    'A rate in place of the tiers when the user meets a condition (the owner’s choice of 2026-11-03, M11.10)',
  );

const rateTiersSchema = z
  .array(rateTierSchema)
  .min(1, 'Give at least one rate')
  .describe('% a year by balance, from the lowest up: the first from 0');

/** Rates an account paid before: until the day the next took over, and since when, when the catalog knows (M11.14). */
export const rateHistoryEntrySchema = z.strictObject({
  since: isoDateSchema.describe('The day these rates took over, when the catalog knows').optional(),
  until: isoDateSchema.describe('The day the next rates took over'),
  tiers: rateTiersSchema,
  bonus: rateBonusSchema.optional(),
});
export type RateHistoryEntry = z.infer<typeof rateHistoryEntrySchema>;

/** How soon an account's rates followed one of the Bank of Canada's changes (M11.14). */
export const followedChangeSchema = z.strictObject({
  change: isoDateSchema.describe(
    'The day a change of the Bank of Canada’s target for the overnight rate took effect',
  ),
  rate: percentSchema.describe('The Bank’s rate from then'),
  on: isoDateSchema
    .describe(
      "The day the account's rates next changed, before the Bank's next change. Left out when they didn't, or haven't yet",
    )
    .optional(),
});
export type FollowedChange = z.infer<typeof followedChangeSchema>;

/** Each tier's order rules: the first from 0, then each from a higher balance. */
function checkTiers(
  tiers: readonly RateTier[],
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
): void {
  if (tiers[0] && tiers[0].from !== 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'Start the first tier at a balance of 0',
      path: [...path, 0, 'from'],
    });
  }
  tiers.forEach((tier, index) => {
    const lower = tiers[index - 1];
    if (lower && tier.from <= lower.from) {
      ctx.addIssue({
        code: 'custom',
        message:
          'List the tiers from the lowest balance up, each from a higher balance than the one before',
        path: [...path, index, 'from'],
      });
    }
  });
}

/** Posted rates only, never a promotional one (as prices are regular prices): the bot reads them as it reads prices. */
export const accountRatesSchema = z
  .strictObject({
    follows: z
      .enum(['prime', 'boc-overnight', 'none'])
      .describe(
        "What it moves with: the banks' prime rate, the Bank of Canada's overnight rate, or none (the provider sets it)",
      ),
    applies: z
      .enum(['whole', 'portion'])
      .describe(
        "How the tiers apply: whole pays the whole balance its tier's rate; portion pays each part of the balance its own tier's",
      ),
    tiers: rateTiersSchema,
    bonus: rateBonusSchema.optional(),
    since: isoDateSchema
      .describe(
        'The day these rates took over, when known: the page’s effective date, or the night the bot read a change (M11.14)',
      )
      .optional(),
    sourceUrl: httpsUrlSchema.describe("The provider's own page that posts the rates"),
    lastVerified: isoDateSchema.describe('When the rates were read'),
    history: z
      .array(rateHistoryEntrySchema)
      .min(1, 'Leave history out instead of listing none')
      .describe(
        'The rates it paid before, newest first, each until the day the next took over: the bot adds one when it reads a change (M11.14, the owner’s choice: kept in the provider file)',
      )
      .optional(),
    followed: z
      .array(followedChangeSchema)
      .describe(
        "Written by data:build, never in data/: how soon a rate that follows the Bank of Canada's followed its last changes, newest first, from history and data/bank-of-canada.yaml (M11.14)",
      )
      .optional(),
  })
  .superRefine((rates, ctx) => {
    checkTiers(rates.tiers, ctx, ['tiers']);
    const history = rates.history ?? [];
    history.forEach((entry, index) => {
      checkTiers(entry.tiers, ctx, ['history', index, 'tiers']);
      const newer = history[index - 1];
      const until = newer?.since ?? (index === 0 ? rates.since : undefined);
      if (newer && entry.until >= newer.until) {
        ctx.addIssue({
          code: 'custom',
          message: 'List the history newest first, each ending before the one above it',
          path: ['history', index, 'until'],
        });
      } else if (until !== undefined && entry.until > until) {
        ctx.addIssue({
          code: 'custom',
          message: 'Must be no later than the day the rates after it took over',
          path: ['history', index, 'until'],
        });
      }
      if (entry.since !== undefined && entry.since >= entry.until) {
        ctx.addIssue({
          code: 'custom',
          message: 'Must be before its until',
          path: ['history', index, 'since'],
        });
      }
    });
    if (rates.since !== undefined && rates.since > rates.lastVerified) {
      ctx.addIssue({
        code: 'custom',
        message: 'Must be no later than lastVerified',
        path: ['since'],
      });
    }
  });
export type AccountRates = z.infer<typeof accountRatesSchema>;

const periodLimitsSchema = z
  .strictObject({
    transaction: amountSchema.describe('At most this much at once').optional(),
    day: amountSchema.optional(),
    week: amountSchema.optional(),
    month: amountSchema.optional(),
  })
  .refine((limits) => Object.keys(limits).length > 0, {
    message: 'Give at least one limit (transaction, day, week or month)',
  });

/** Shown on the card, not ranked. */
export const accountLimitsSchema = z
  .strictObject({
    eTransfer: periodLimitsSchema.describe('Interac e-Transfers sent').optional(),
    atmWithdrawal: periodLimitsSchema.describe('Cash from ATMs').optional(),
    debits: z
      .int()
      .positive('Must be a whole number of at least 1')
      .describe(
        'Transactions a month the fee includes, when they aren’t unlimited (TD Every Day: 25)',
      )
      .optional(),
  })
  .refine((limits) => Object.keys(limits).length > 0, {
    message: 'Leave limits out instead of listing none',
  });
export type AccountLimits = z.infer<typeof accountLimitsSchema>;

/** What protects the money if the company or its bank fails, quoted like a policy (the finance.money-protection topic grades it). */
export const accountProtectionSchema = z.strictObject({
  insurer: z
    .enum(['cdic', 'provincial', 'cipf', 'none'])
    .describe(
      'CDIC, a provincial deposit insurer (credit unions), CIPF (investments, if the dealer fails), or none',
    ),
  held: z
    .enum(['own-name', 'trust', 'company'])
    .describe(
      "In your name at a member, in trust for you (you're the beneficiary), or in the company's own name",
    ),
  limit: amountSchema
    .describe('The cover, when the page states it (spread over several members: their total)')
    .optional(),
  url: httpsUrlSchema.describe("The provider's own page that says it"),
  quotes: z
    .array(textSchema)
    .min(1, 'Quote its words about who protects the money')
    .describe("The provider's own words, word for word"),
  lastVerified: isoDateSchema.describe('When the page was read'),
});
export type AccountProtection = z.infer<typeof accountProtectionSchema>;

export const accountSchema = z
  .strictObject({
    kind: accountKindSchema.describe('What the account is'),
    currency: currencySchema.describe('The currency it holds, which its amounts are in'),
    waivers: z
      .array(accountConditionSchema)
      .min(1, 'Leave waivers out instead of listing none')
      .describe('Any one of these waives the fee: the user says which they meet (M11.11)')
      .optional(),
    rates: accountRatesSchema.describe('Its interest, when it pays any').optional(),
    limits: accountLimitsSchema.optional(),
    protection: accountProtectionSchema,
    eligibility: accountConditionSchema
      .describe(
        'Who may open it, when a tier is decided by assets rather than a fee (Wealthsimple’s Premium)',
      )
      .optional(),
  })
  .describe(
    "A finance account's terms (BLUEPRINT §4.11, M11.10): its plan's price is the monthly fee",
  );
export type Account = z.infer<typeof accountSchema>;

/** A regulator that lists the provider, with the register's page for it: "is it a bank, and who protects my money". */
export const regulatorSchema = z.strictObject({
  name: textSchema.describe('As the regulator calls itself (CIRO, OSFI, FCAC, the AMF)'),
  url: httpsUrlSchema.describe(
    "The register's page for this provider, on the regulator's own site",
  ),
  lastVerified: isoDateSchema.describe('When the page was read'),
});
export type Regulator = z.infer<typeof regulatorSchema>;

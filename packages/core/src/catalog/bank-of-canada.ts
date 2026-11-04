import * as z from 'zod';
import { httpsUrlSchema, isoDateSchema } from './formats';

// data/bank-of-canada.yaml (M11.14): the Bank of Canada's target for the overnight rate, each change and the day it took
// effect, from the Bank's own Valet series (V39079, business daily). The bot reads the series each night and proposes
// a new change by pull request, as it does prices; data:build works out how soon each account whose rates follow the
// Bank's (or the prime rate, which banks set from it) followed its last changes (rate-follow.ts).

/** The Bank's Valet series of the target for the overnight rate, business daily: what the bot reads. */
export const bankOfCanadaSeriesUrl = 'https://www.bankofcanada.ca/valet/observations/V39079/json';

export const bankOfCanadaChangeSchema = z.strictObject({
  on: isoDateSchema.describe(
    'The day the new rate took effect: its first observation in the series',
  ),
  rate: z
    .number()
    .nonnegative('Must be 0 or more')
    .max(100, 'Must be a percentage, 100 at most')
    .describe('The target for the overnight rate from then, in percent: 2.25 means 2.25%'),
});
export type BankOfCanadaChange = z.infer<typeof bankOfCanadaChangeSchema>;

export const bankOfCanadaFileSchema = z
  .strictObject({
    source: httpsUrlSchema.describe(
      "The Bank's own series of the target for the overnight rate: Valet's V39079",
    ),
    lastVerified: isoDateSchema.describe('When the series was last read'),
    changes: z
      .array(bankOfCanadaChangeSchema)
      .min(1, 'List at least the last change')
      .describe('Each change, newest first'),
  })
  .superRefine((file, ctx) => {
    file.changes.forEach((change, index) => {
      const newer = file.changes[index - 1];
      if (newer && change.on >= newer.on) {
        ctx.addIssue({
          code: 'custom',
          message: 'List the changes newest first, each before the one above it',
          path: ['changes', index, 'on'],
        });
      } else if (newer && change.rate === newer.rate) {
        ctx.addIssue({
          code: 'custom',
          message: 'A change is to another rate than the one before it',
          path: ['changes', index - 1, 'rate'],
        });
      }
    });
    if (file.changes[0] && file.changes[0].on > file.lastVerified) {
      ctx.addIssue({
        code: 'custom',
        message: 'Must be no earlier than the newest change',
        path: ['lastVerified'],
      });
    }
  })
  .meta({
    title: 'Simply Sub Bank of Canada rate',
    description:
      "data/bank-of-canada.yaml: the Bank of Canada's target for the overnight rate, each change from the Bank's own Valet series (M11.14)",
  });
export type BankOfCanadaFile = z.infer<typeof bankOfCanadaFileSchema>;

import { z } from 'zod';
import { currencySchema, textSchema } from '../catalog/formats';
import { cardNetworkSchema } from '../catalog/provider';
import { recordMetaShape } from './record';

// A payment card's metadata, for cash back and FX fees (BLUEPRINT §9.2). Never a card number, expiry date or CVV.

/** Card text: 12 or more digits in a row, even with spaces or dashes between them, could be a card number. */
const cardTextSchema = textSchema.refine(
  (text) => !/\d(?:[ -]?\d){11,}/.test(text),
  'Never enter a card number',
);

export const paymentCardSchema = z.strictObject({
  ...recordMetaShape,
  /** "Simplii Cashback Mastercard" */
  name: cardTextSchema,
  /** Shown instead of the name when set. */
  nickname: cardTextSchema.optional(),
  type: z.enum(['credit', 'debit']),
  network: cardNetworkSchema,
  /** The card's home currency. */
  currency: currencySchema,
  /** Flat, e.g. 1.5. Points users enter their own effective %. */
  cashbackPercent: z.number().min(0).max(20),
  /** The issuer's foreign transaction fee, e.g. 2.5; 0 for no-FX cards. */
  fxFeePercent: z.number().min(0).max(10),
  /** A debit limit, or a credit limit paid in full monthly. None means no limit. */
  monthlyLimit: z.number().positive('Must be more than 0').optional(),
});
export type PaymentCard = z.infer<typeof paymentCardSchema>;

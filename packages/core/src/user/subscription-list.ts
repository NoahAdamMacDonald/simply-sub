import * as z from 'zod';
import { textSchema } from '../catalog/formats';
import { recordMetaShape } from './record';

/** A list of subscriptions: one per person or purpose (BLUEPRINT §4.6). Its items point at it with `listId`. */
export const subscriptionListSchema = z.strictObject({
  ...recordMetaShape,
  name: textSchema.max(60, 'Use at most 60 characters'),
});
export type SubscriptionList = z.infer<typeof subscriptionListSchema>;

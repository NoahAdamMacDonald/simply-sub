import * as z from 'zod';
import { fxRatesSchema } from '../catalog/convert';
import { timestampSchema } from './record';

/**
 * The last exchange rates the app fetched (GET /fx, BLUEPRINT §4.7), kept so converted prices show at once on start
 * and with no network. One record, under the key `fx`. Rates in any base convert between any two currencies they
 * list (exchangeRate), so they serve after a change of currency until the new currency's arrive. It's a cache, not
 * the user's data, like catalogCache.
 */
export const fxCacheSchema = z.strictObject({
  key: z.literal('fx'),
  rates: fxRatesSchema,
  fetchedAt: timestampSchema,
});
export type FxCache = z.infer<typeof fxCacheSchema>;

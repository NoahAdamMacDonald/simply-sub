import * as z from 'zod';
import { rankKeySchema } from '../catalog/formats';
import { profileRankSchema } from './rank';
import { timestampSchema } from './record';

/**
 * A global rank (PROJECT-PLAN §3.2). It's keyed by its rank key rather than a UUID, so the same key ranked on two
 * devices is one record when they sync. Clearing a rank soft-deletes it; not-ranked is never stored.
 */
export const profileRankingSchema = z.strictObject({
  rankKey: rankKeySchema,
  rank: profileRankSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: timestampSchema.optional(),
});
export type ProfileRanking = z.infer<typeof profileRankingSchema>;

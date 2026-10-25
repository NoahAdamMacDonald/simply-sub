import * as z from 'zod';

/**
 * How much a user cares about a rank key (PROJECT-PLAN §3.2), from most to least wanted. Essential and critical are
 * subscription-level only (BLUEPRINT §10.2): essential keeps this exact plan, critical keeps this provider.
 */
export const rankSchema = z.enum([
  'essential',
  'critical',
  'needed',
  'wanted',
  'uses',
  'sometimes',
  'not-ranked',
  'unused',
  'unwanted',
]);
export type Rank = z.infer<typeof rankSchema>;

/** The ranks a profile ranking can store: no subscription-level ranks, and not-ranked is never stored. */
export const profileRankSchema = rankSchema.exclude(['essential', 'critical', 'not-ranked']);
export type ProfileRank = z.infer<typeof profileRankSchema>;

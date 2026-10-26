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

/**
 * The choices a rank dropdown offers, in order (BLUEPRINT §8.3). The Features page ranks a profile: Not ranked (the
 * default) first, then Needed to Unwanted. An item's override adds Essential and Critical, in the order of `Rank`; its
 * "Profile default" choice, which clears the override, isn't a rank, so the dropdown adds it.
 */
export function rankChoices(level: 'profile' | 'subscription'): readonly Rank[] {
  return level === 'profile' ? profileChoices : rankSchema.options;
}

const profileChoices: readonly Rank[] = ['not-ranked', ...profileRankSchema.options];

/** The ranks that rank counts show, from Essential to Unwanted (PROJECT-PLAN §3.2): every rank but not-ranked. */
export const countedRanks = rankSchema.exclude(['not-ranked']).options;
export type CountedRank = (typeof countedRanks)[number];

/** How many of a list's provided keys have each rank (the list cards on P3): zero counts included. */
export type RankCounts = Record<CountedRank, number>;

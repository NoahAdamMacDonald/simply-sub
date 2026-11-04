import type { PlanPolicies } from './plan-policies';
import type { PolicyTier } from './policy-topic';

// A card's Terms and policies at a glance (Search's card, its Overview and Terms tabs). A module of its own, since only
// the card's lazy details use it: one the initial bundle holds would carry it there.

/** The grades from best to worst, as policy-topic.ts's policyTiers, without loading its schemas. */
const tiers: readonly PolicyTier[] = ['great', 'good', 'neutral', 'poor', 'bad'];

/** How many of a card's ratings have a grade, by grade, and how many a status instead ("none"). */
export interface PolicyGradeCount {
  tier: PolicyTier | 'none';
  count: number;
}

/**
 * The card's Terms and policies at a glance (its Overview and Terms tabs, the owner's design of 2026-11-03): how many
 * ratings have each grade, Great to Bad, then how many have none (Not stated, Not applicable), leaving out a count of
 * none.
 */
export function policyGradeCounts(policies: PlanPolicies): PolicyGradeCount[] {
  const shown = policies.groups.flatMap(({ policies: rated }) => rated);
  return [...tiers, 'none' as const]
    .map((tier) => ({
      tier,
      count: shown.filter((policy) => (policy.tier ?? 'none') === tier).length,
    }))
    .filter(({ count }) => count > 0);
}

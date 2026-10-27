import type { PolicyLink, PolicyRating, PolicySource } from './policy';
import { policyGroups, type PolicyGroup, type PolicyTier, type PolicyTopic } from './policy-topic';
import type { Provider } from './provider';
import { globalRegion, groupsOf } from './regions';

// What a card's Terms and policies shows for one plan and buyer (BLUEPRINT §4.10, M1.13).

/** One topic's rating, as the card shows it. */
export interface PlanPolicy {
  topic: PolicyTopic;
  tier: PolicyTier;
  reason: string;
  sources: PolicySource[];
}

export interface PlanPolicies {
  /** The ratings by group (Privacy, Billing, Legal, Service), each in policy-topics.yaml's order. */
  groups: { group: PolicyGroup; policies: PlanPolicy[] }[];
  /** The pages those ratings quote, in the provider's order: what the card links. */
  links: PolicyLink[];
}

/**
 * The provider's ratings that apply to `planId` for a buyer in `region`, on the registry's topics: for each topic,
 * a rating for the plan wins over one for every plan, then one for the region (or a group it's in, EU) over one for
 * everywhere. Undefined when none applies.
 */
export function planPolicies(
  provider: Pick<Provider, 'policies'>,
  planId: string,
  region: string,
  topics: readonly PolicyTopic[],
): PlanPolicies | undefined {
  const policies = provider.policies;
  if (!policies) return undefined;
  const where = new Set([region, ...groupsOf(region), globalRegion]);
  const applies = (rating: PolicyRating) =>
    (!rating.plans || rating.plans.includes(planId)) &&
    (!rating.regions || rating.regions.some((code) => where.has(code)));
  const specificity = (rating: PolicyRating) => (rating.plans ? 2 : 0) + (rating.regions ? 1 : 0);

  const byTopic = new Map<string, PolicyRating>();
  for (const rating of policies.ratings.filter(applies)) {
    const current = byTopic.get(rating.topic);
    if (!current || specificity(rating) > specificity(current)) {
      byTopic.set(rating.topic, rating);
    }
  }
  const shown = topics.flatMap((topic): PlanPolicy[] => {
    const rating = byTopic.get(topic.id);
    return rating
      ? [{ topic, tier: rating.tier, reason: rating.reason, sources: rating.sources }]
      : [];
  });
  if (shown.length === 0) return undefined;
  const quoted = new Set(shown.flatMap((policy) => policy.sources.map((source) => source.url)));
  return {
    groups: policyGroups.flatMap((group) => {
      const inGroup = shown.filter((policy) => policy.topic.group === group);
      return inGroup.length > 0 ? [{ group, policies: inGroup }] : [];
    }),
    links: policies.links.filter((link) => quoted.has(link.url)),
  };
}

import type { PolicyLink, PolicyRating, PolicySource } from './policy';
import { policyGroups, type PolicyGroup, type PolicyTier, type PolicyTopic } from './policy-topic';
import type { Provider } from './provider';
import { globalRegion, groupsOf } from './regions';

// What a card's Terms and policies shows for one plan and buyer (BLUEPRINT §4.10, M1.13, M1.14).

/** A page a rating quotes, as an inline citation: its number in the links, and a link to the words. */
export interface PolicyCitation {
  /** 1 for the first of the card's links, as its list numbers them. */
  number: number;
  /** The page's name, as the links list it. */
  name: string;
  /** What the rating quotes from it, in the rating's order. */
  quotes: string[];
  /** The page, scrolled to the first quote with each one highlighted, where the browser supports it (quoteLink). */
  href: string;
}

/** One topic's rating, as the card shows it. */
export interface PlanPolicy {
  topic: PolicyTopic;
  tier: PolicyTier;
  reason: string;
  citations: PolicyCitation[];
}

export interface PlanPolicies {
  /** The ratings by group (Privacy, Billing, Legal, Service), each in policy-topics.yaml's order. */
  groups: { group: PolicyGroup; policies: PlanPolicy[] }[];
  /** The pages those ratings quote, in the provider's order, numbered from 1 as the citations number them. */
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
  const shown = topics.flatMap((topic) => {
    const rating = byTopic.get(topic.id);
    return rating ? [{ topic, rating }] : [];
  });
  if (shown.length === 0) return undefined;
  const quoted = new Set(shown.flatMap(({ rating }) => rating.sources.map((source) => source.url)));
  const links = policies.links.filter((link) => quoted.has(link.url));
  // One citation per page, however many times the rating quotes it, in the links' order.
  const cite = (sources: readonly PolicySource[]): PolicyCitation[] =>
    links.flatMap((link, index) => {
      const quotes = sources
        .filter((source) => source.url === link.url)
        .map((source) => source.quote);
      return quotes.length > 0
        ? [{ number: index + 1, name: link.name, quotes, href: quoteLink(link.url, quotes) }]
        : [];
    });
  return {
    groups: policyGroups.flatMap((group) => {
      const inGroup = shown
        .filter(({ topic }) => topic.group === group)
        .map(({ topic, rating }) => ({
          topic,
          tier: rating.tier,
          reason: rating.reason,
          citations: cite(rating.sources),
        }));
      return inGroup.length > 0 ? [{ group, policies: inGroup }] : [];
    }),
    links,
  };
}

/** Words at each end of a long quote that a link's text fragment matches it by. */
const fragmentWords = 4;

/**
 * `url` with a text fragment that scrolls to the first of `quotes` and highlights each (#:~:text=, in Chrome, Edge,
 * Safari and Firefox; other browsers open the page at the top). A long quote is matched by its first and last words.
 * The characters that mean something in a text directive (- , &) are percent-encoded.
 */
export function quoteLink(url: string, quotes: readonly string[]): string {
  const encode = (text: string) => encodeURIComponent(text).replace(/-/g, '%2D');
  const directive = (quote: string) => {
    const words = quote.trim().split(/\s+/);
    return words.length > fragmentWords * 2
      ? `text=${encode(words.slice(0, fragmentWords).join(' '))},${encode(words.slice(-fragmentWords).join(' '))}`
      : `text=${encode(words.join(' '))}`;
  };
  return `${url}${url.includes('#') ? '' : '#'}:~:${quotes.map(directive).join('&')}`;
}

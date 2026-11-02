import type { PolicyAction, PolicyLink, PolicyRating, PolicySource } from './policy';
import {
  policyGroups,
  silentMeaning,
  type PolicyGroup,
  type PolicyStatus,
  type PolicyTier,
  type PolicyTopic,
} from './policy-topic';
import { providerCategories } from './plan-categories';
import type { Provider } from './provider';
import { globalRegion, groupsOf } from './regions';

// What a card's Terms and policies shows for one plan and buyer (BLUEPRINT §4.10, M1.13, M1.14, M11.1).

/** A page a rating quotes or read, as an inline citation: its number in the links, and a link to the words. */
export interface PolicyCitation {
  /** 1 for the first of the card's links, as its list numbers them. */
  number: number;
  /** The page's name, as the links list it. */
  name: string;
  /** What the rating quotes from it, in the rating's order: none for a page read that doesn't address the topic. */
  quotes: string[];
  /** The page, scrolled to the first quote with each one highlighted, where the browser supports it (quoteLink). */
  href: string;
}

/** One topic's rating, as the card shows it. */
export interface PlanPolicy {
  topic: PolicyTopic;
  /**
   * Its grade: the rating's, or for a topic the pages don't address, the one the topic's silence gets (no notice of
   * a price change promised is Poor). None for a Not stated or Not applicable line.
   */
  tier?: PolicyTier;
  /** Not stated or not applicable, when the rating gives a status rather than a grade (M11.1). */
  status?: PolicyStatus;
  /** A notable rating's title (other.notable). */
  title?: string;
  reason: string;
  citations: PolicyCitation[];
  /** Where to change it, when the user has to (M5.12). */
  action?: PolicyAction;
}

export interface PlanPolicies {
  /** The ratings by group (Privacy, Billing, Legal…), each in policy-topics.yaml's order. */
  groups: { group: PolicyGroup; policies: PlanPolicy[] }[];
  /** The pages those ratings quote or read, in the provider's order, numbered from 1 as the citations number them. */
  links: PolicyLink[];
}

/**
 * The provider's ratings that apply to `planId` for a buyer in `region`, on the registry's topics: for each topic,
 * a rating for the plan wins over one for every plan, then one for the region (or a group it's in, EU) over one for
 * everywhere. A titled topic (other.notable) shows each of its ratings. Undefined when none applies.
 */
export function planPolicies(
  provider: Pick<Provider, 'policies' | 'category' | 'plans'>,
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

  // By topic, and by title for a titled topic's ratings, which are each about something else.
  const chosen = new Map<string, PolicyRating>();
  for (const rating of policies.ratings.filter(applies)) {
    const key = `${rating.topic}\n${rating.title ?? ''}`;
    const current = chosen.get(key);
    if (!current || specificity(rating) > specificity(current)) {
      chosen.set(key, rating);
    }
  }
  const shown = topics.flatMap((topic) =>
    [...chosen.values()]
      .filter((rating) => rating.topic === topic.id)
      .map((rating) => ({ topic, rating })),
  );
  if (shown.length === 0) return undefined;
  const quoted = new Set(shown.flatMap(({ rating }) => pagesOf(rating)));
  const links = policies.links.filter((link) => quoted.has(link.url));
  // One citation per page, however many times the rating quotes it, in the links' order.
  const cite = (sources: readonly PolicySource[], read: readonly string[]): PolicyCitation[] =>
    links.flatMap((link, index) => {
      const quotes = sources
        .filter((source) => source.url === link.url)
        .map((source) => source.quote);
      if (quotes.length === 0 && !read.includes(link.url)) return [];
      return [
        {
          number: index + 1,
          name: link.name,
          quotes,
          href: quotes.length > 0 ? quoteLink(link.url, quotes) : link.url,
        },
      ];
    });
  const categories = providerCategories(provider);
  return {
    groups: policyGroups.flatMap((group) => {
      const inGroup = shown
        .filter(({ topic }) => topic.group === group)
        .map(({ topic, rating }): PlanPolicy => {
          const silent =
            rating.status === 'not-stated' ? silentMeaning(topic, categories) : undefined;
          const tier = rating.tier ?? (silent !== 'not-stated' ? silent : undefined);
          return {
            topic,
            ...(tier && { tier }),
            ...(rating.status && { status: rating.status }),
            ...(rating.title !== undefined && { title: rating.title }),
            reason: rating.reason,
            citations: cite(rating.sources ?? [], rating.pages ?? []),
            ...(rating.action && { action: rating.action }),
          };
        });
      return inGroup.length > 0 ? [{ group, policies: inGroup }] : [];
    }),
    links,
  };
}

/** The pages a rating quotes or read. */
function pagesOf(rating: PolicyRating): string[] {
  return [...(rating.sources ?? []).map((source) => source.url), ...(rating.pages ?? [])];
}

/** How many of a provider's plans cost something somewhere: the billing topics apply only when there's one. */
export function paidPlanCount(provider: Pick<Provider, 'plans'>): number {
  return provider.plans.filter((plan) => plan.prices.some((price) => price.amount > 0)).length;
}

/**
 * Whether a provider has to rate `topic` (M11.1): a topic for some categories needs a plan in one, one with
 * paidPlans that many paid plans, and a titled topic (other.notable) is never required.
 */
export function topicApplies(
  topic: PolicyTopic,
  provider: Pick<Provider, 'category' | 'plans'>,
): boolean {
  if (topic.titled) return false;
  const categories = providerCategories(provider);
  return (
    (!topic.categories || topic.categories.some((id) => categories.includes(id))) &&
    (topic.paidPlans === undefined || paidPlanCount(provider) >= topic.paidPlans)
  );
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

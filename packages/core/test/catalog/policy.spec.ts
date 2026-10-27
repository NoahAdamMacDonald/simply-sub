import { describe, expect, it } from 'vitest';
import {
  formatCatalogIssue,
  planPolicies,
  policiesSchema,
  quoteLink,
  policyTopicsFileSchema,
  validateCatalog,
  type CatalogSourceFile,
  type Policies,
  type PolicyTopic,
} from '../../src';
import { catalog, edited, today } from './catalog-files';

// Terms and policies (BLUEPRINT §4.10, M1.13, M1.14): the topics registry, a provider's ratings, the checks across
// files, and what a card shows for a plan, with its citations.

const tiers = {
  great: 'Collects only what the service needs to work.',
  good: 'Asks before collecting anything more.',
  neutral: 'Collects more by default, and you can opt out.',
  poor: 'Opting out is partial.',
  bad: 'No way to opt out.',
};

const topics: PolicyTopic[] = [
  {
    id: 'privacy.data-collection',
    name: 'Data collection',
    group: 'privacy',
    question: 'What it collects.',
    tiers,
  },
  {
    id: 'privacy.ads-tracking',
    name: 'Ads and tracking',
    group: 'privacy',
    question: 'Ads.',
    tiers,
  },
  {
    id: 'billing.cancel-refunds',
    name: 'Cancelling and refunds',
    group: 'billing',
    question: 'Cancel.',
    tiers,
  },
  {
    id: 'service.vpn-logging',
    name: 'VPN logging',
    group: 'service',
    question: 'Logs.',
    tiers,
    categories: ['vpn'],
  },
];

const terms = 'https://mullvad.net/en/help/terms-service';
const privacy = 'https://mullvad.net/en/help/privacy-policy';

function rating(topic: string, extra: Record<string, unknown> = {}) {
  return {
    topic,
    tier: 'great',
    reason: 'Keeps almost nothing.',
    sources: [{ url: privacy, quote: 'to have as minimal data retention as possible' }],
    lastVerified: '2026-10-22',
    ...extra,
  };
}

/** Only the privacy policy, for ratings that quote only it. */
const privacyOnly = [{ name: 'Privacy policy', url: privacy }];

const mullvadPolicies = {
  links: [
    { name: 'Terms of service', url: terms },
    { name: 'Privacy policy', url: privacy },
  ],
  ratings: [
    rating('privacy.data-collection'),
    rating('billing.cancel-refunds', {
      tier: 'good',
      reason: 'Prepaid, with a 14-day money-back guarantee.',
      sources: [{ url: terms, quote: 'We offer users a 14-day money-back guarantee.' }],
    }),
    rating('service.vpn-logging', { reason: 'No connection logs.' }),
  ],
};

/** The test catalog with the topics registry and Mullvad's ratings. */
function withPolicies(policies: unknown = mullvadPolicies): CatalogSourceFile[] {
  return [
    ...edited(catalog(), 'data/providers/mullvad.yaml', ['policies'], policies),
    { file: 'data/policy-topics.yaml', data: topics },
  ];
}

function messages(files: readonly CatalogSourceFile[], on = today): string[] {
  return validateCatalog(files, on).map(
    (issue) => `${issue.severity === 'warning' ? 'warning: ' : ''}${formatCatalogIssue(issue)}`,
  );
}

describe('the policy topics registry', () => {
  it('accepts topics with a rubric for each tier', () => {
    expect(policyTopicsFileSchema.safeParse(topics).success).toBe(true);
  });

  it('rejects a topic listed twice, and one missing a tier', () => {
    const { bad, ...fourTiers } = tiers;
    expect(policyTopicsFileSchema.safeParse([...topics, topics[0]]).success).toBe(false);
    expect(policyTopicsFileSchema.safeParse([{ ...topics[0], tiers: fourTiers }]).success).toBe(
      false,
    );
    expect(bad).toBeTruthy();
  });
});

describe('a provider’s policies', () => {
  const issues = (policies: unknown) =>
    policiesSchema.safeParse(policies).error?.issues.map((issue) => issue.message) ?? [];

  it('accepts ratings that quote the pages it links', () => {
    expect(issues(mullvadPolicies)).toEqual([]);
  });

  it('needs every quoted page linked, and every linked page quoted', () => {
    expect(
      issues({ ...mullvadPolicies, links: [{ name: 'Terms of service', url: terms }] }),
    ).toEqual([
      'List this page in links, so the card links it',
      'List this page in links, so the card links it',
    ]);
    expect(
      issues({
        ...mullvadPolicies,
        links: [
          ...mullvadPolicies.links,
          { name: 'Cookies', url: 'https://mullvad.net/en/help/cookies' },
        ],
      }),
    ).toEqual(['No rating quotes this page: leave it out']);
  });

  it('keeps the reason to a sentence or two', () => {
    expect(
      issues({
        links: privacyOnly,
        ratings: [rating('privacy.data-collection', { reason: 'x'.repeat(241) })],
      }),
    ).toEqual(['Keep it to a sentence or two (240 characters at most)']);
  });

  it('lets a rating for some plans or regions sit over one for all, but not two of the same scope', () => {
    const general = rating('privacy.ads-tracking');
    const forPlan = rating('privacy.ads-tracking', { plans: ['mullvad.vpn'], tier: 'neutral' });
    const forRegion = rating('privacy.ads-tracking', { regions: ['US'], tier: 'bad' });
    const policies = (ratings: unknown[]): Policies =>
      ({ links: privacyOnly, ratings }) as Policies;

    expect(issues(policies([general, forPlan, forRegion]))).toEqual([]);
    expect(issues(policies([general, general]))).toEqual([
      'privacy.ads-tracking is rated already for these plans and regions',
    ]);
    expect(
      issues(policies([forRegion, rating('privacy.ads-tracking', { regions: ['US', 'CA'] })])),
    ).toEqual(['privacy.ads-tracking is rated already for these plans and regions']);
  });
});

describe('validateCatalog, for policies', () => {
  it('accepts ratings on the registry’s topics', () => {
    expect(messages(withPolicies())).toEqual([]);
  });

  const netflixPrivacy = 'https://help.netflix.com/legal/privacy';
  const netflixRating = (topic: string, extra: Record<string, unknown> = {}) =>
    rating(topic, { sources: [{ url: netflixPrivacy, quote: 'We collect' }], ...extra });
  const withNetflix = (ratings: unknown[]) =>
    edited(withPolicies(), 'data/providers/netflix.yaml', ['policies'], {
      links: [{ name: 'Privacy statement', url: netflixPrivacy }],
      ratings,
    });

  it('reports an unknown topic, and a VPN topic on a streaming provider', () => {
    expect(
      messages(
        withNetflix([
          netflixRating('privacy.data-colection'),
          netflixRating('service.vpn-logging'),
        ]),
      ),
    ).toEqual([
      'data/providers/netflix.yaml policies.ratings.0.topic: "privacy.data-colection" isn\'t a topic in data/policy-topics.yaml (privacy.data-collection, privacy.ads-tracking, billing.cancel-refunds, service.vpn-logging)',
      'data/providers/netflix.yaml policies.ratings.1.topic: VPN logging is only for providers with a plan in vpn',
    ]);
  });

  it('reports a plan that isn’t the provider’s', () => {
    expect(
      messages(withNetflix([netflixRating('privacy.ads-tracking', { plans: ['mullvad.vpn'] })])),
    ).toEqual([
      expect.stringMatching(
        /^data\/providers\/netflix\.yaml policies\.ratings\.0\.plans\.0: "mullvad\.vpn" isn't a plan in this file/,
      ),
    ]);
  });

  it('reports a rating read after today, and warns about one read over a year ago', () => {
    expect(
      messages(
        edited(
          withPolicies(),
          'data/providers/mullvad.yaml',
          ['policies', 'ratings', 0, 'lastVerified'],
          '2026-10-24',
        ),
      ),
    ).toEqual([
      `data/providers/mullvad.yaml policies.ratings.0.lastVerified: 2026-10-24 is after today (${today})`,
    ]);
    expect(messages(withPolicies(), '2027-11-01')).toContain(
      'warning: data/providers/mullvad.yaml policies: Some ratings were read on 2026-10-22, over a year ago: read the pages again',
    );
  });

  it('needs the topics file once a provider rates its policies', () => {
    const files = withPolicies().filter(({ file }) => file !== 'data/policy-topics.yaml');
    expect(messages(files)).toEqual([
      'data/policy-topics.yaml: Missing: the topics that providers rate their policies on go here (BLUEPRINT §4.10)',
    ]);
  });
});

describe('planPolicies', () => {
  const provider = (ratings: unknown[]) => ({
    policies: { ...mullvadPolicies, ratings } as Policies,
  });

  it('groups the ratings that apply, in the registry’s order, and links only the pages they quote', () => {
    const shown = planPolicies(provider(mullvadPolicies.ratings), 'mullvad.vpn', 'CA', topics);

    expect(
      shown?.groups.map(({ group, policies }) => [
        group,
        policies.map((policy) => policy.topic.id),
      ]),
    ).toEqual([
      ['privacy', ['privacy.data-collection']],
      ['billing', ['billing.cancel-refunds']],
      ['service', ['service.vpn-logging']],
    ]);
    expect(shown?.links.map((link) => link.name)).toEqual(['Terms of service', 'Privacy policy']);
    expect(
      planPolicies(provider([mullvadPolicies.ratings[0]]), 'mullvad.vpn', 'CA', topics)?.links.map(
        (link) => link.name,
      ),
    ).toEqual(['Privacy policy']);
  });

  it('cites each page a rating quotes once, by its number in the links, linked to its words', () => {
    const ratings = [
      ...mullvadPolicies.ratings,
      rating('privacy.ads-tracking', {
        sources: [
          { url: privacy, quote: 'Deleted after 70 days.' },
          { url: terms, quote: 'Refunds - within 14 days' },
          { url: privacy, quote: 'Payment IDs, after 20.' },
        ],
      }),
    ];
    const shown = planPolicies(provider(ratings), 'mullvad.vpn', 'CA', topics);

    expect(
      shown?.groups.flatMap(({ policies }) =>
        policies.map(({ topic, citations }) => [
          topic.id,
          citations.map(({ number, name }) => `${number} ${name}`),
        ]),
      ),
    ).toEqual([
      ['privacy.data-collection', ['2 Privacy policy']],
      ['privacy.ads-tracking', ['1 Terms of service', '2 Privacy policy']],
      ['billing.cancel-refunds', ['1 Terms of service']],
      ['service.vpn-logging', ['2 Privacy policy']],
    ]);
    expect(shown?.groups[0].policies[1].citations[1]).toEqual({
      number: 2,
      name: 'Privacy policy',
      quotes: ['Deleted after 70 days.', 'Payment IDs, after 20.'],
      href: `${privacy}#:~:text=Deleted%20after%2070%20days.&text=Payment%20IDs%2C%20after%2020.`,
    });
  });

  it('prefers a rating for the plan, then for the region (or its group), over one for everything', () => {
    const ratings = [
      rating('privacy.ads-tracking', { reason: 'Everywhere.' }),
      rating('privacy.ads-tracking', { regions: ['EU'], reason: 'In the EU.' }),
      rating('privacy.ads-tracking', {
        plans: ['mullvad.vpn'],
        regions: ['US'],
        reason: 'The plan in the US.',
      }),
    ];
    const reason = (region: string, plan = 'mullvad.vpn') =>
      planPolicies(provider(ratings), plan, region, topics)?.groups[0].policies[0].reason;

    expect(reason('CA')).toBe('Everywhere.');
    expect(reason('SE')).toBe('In the EU.');
    expect(reason('US')).toBe('The plan in the US.');
  });

  it('shows nothing for a provider with no ratings, or none that applies', () => {
    expect(planPolicies({}, 'mullvad.vpn', 'CA', topics)).toBeUndefined();
    expect(
      planPolicies(
        provider([rating('privacy.ads-tracking', { regions: ['US'] })]),
        'mullvad.vpn',
        'CA',
        topics,
      ),
    ).toBeUndefined();
  });
});

describe('quoteLink', () => {
  it('links a short quote word for word, encoding what a text fragment reserves', () => {
    expect(quoteLink(privacy, ['No logs, ever - at all & never'])).toBe(
      `${privacy}#:~:text=No%20logs%2C%20ever%20%2D%20at%20all%20%26%20never`,
    );
  });

  it('matches a long quote by its first and last words, whatever spaces it has', () => {
    expect(
      quoteLink(terms, [
        'shall be handled by the National Board for Consumer\u00a0Disputes (ARN) or the  Swedish courts',
      ]),
    ).toBe(`${terms}#:~:text=shall%20be%20handled%20by,or%20the%20Swedish%20courts`);
  });

  it('adds the directive after a fragment the page already has', () => {
    expect(quoteLink(`${terms}#refunds`, ['Refunds'])).toBe(`${terms}#refunds:~:text=Refunds`);
  });

  it('highlights several quotes on one page, each a directive of its own', () => {
    expect(quoteLink(terms, ['Refunds', 'Within 14 days.'])).toBe(
      `${terms}#:~:text=Refunds&text=Within%2014%20days.`,
    );
  });
});

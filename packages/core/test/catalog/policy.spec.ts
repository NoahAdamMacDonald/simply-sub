import { describe, expect, it } from 'vitest';
import {
  buildPolicyIndex,
  policyFilePath,
  policyIndexPart,
  policyFiles,
  sharedPolicyFilePath,
  formatCatalogIssue,
  buildCatalogData,
  planPolicies,
  policiesSchema,
  policySetSchema,
  readCatalogSource,
  quoteLink,
  policyTopicsFileSchema,
  silentMeaning,
  validateCatalog,
  type CatalogSourceFile,
  type Policies,
  type PolicySet,
  type PolicyTopic,
  type Provider,
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
    silent: 'not-stated',
  },
  {
    id: 'privacy.ads-tracking',
    name: 'Ads and tracking',
    group: 'privacy',
    question: 'Ads.',
    tiers,
    silent: 'not-stated',
  },
  {
    id: 'billing.refunds',
    name: 'Refunds',
    group: 'billing',
    question: 'Refunds.',
    tiers,
    silent: 'not-stated',
    paidPlans: 1,
  },
  {
    id: 'service.activity-logging',
    name: 'Activity logging',
    group: 'service',
    question: 'Logs.',
    tiers,
    silent: 'poor',
    categories: ['vpn'],
  },
  {
    id: 'other.notable',
    name: 'Notable',
    group: 'other',
    question: 'What stands out.',
    tiers,
    titled: true,
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
    rating('billing.refunds', {
      tier: 'good',
      reason: 'Prepaid, with a 14-day money-back guarantee.',
      sources: [{ url: terms, quote: 'We offer users a 14-day money-back guarantee.' }],
    }),
    rating('service.activity-logging', { reason: 'No connection logs.' }),
  ],
};

/** The test catalog with the topics registry and Mullvad's ratings. */
function withPolicies(policies: unknown = mullvadPolicies): CatalogSourceFile[] {
  return [
    ...edited(catalog(), 'data/providers/mullvad.yaml', ['policies'], policies),
    { file: 'data/policy-topics.yaml', data: topics },
  ];
}

/** The test catalog's providers, which rate only a few topics: their missing ones are warnings here. */
const partlyRated: ReadonlySet<string> = new Set(['crave', 'mullvad', 'netflix', 'proton']);

/**
 * Every issue, as data:validate prints it, but the missing topics of the test catalog's providers, which rate only a
 * few (`coverage` checks those).
 */
function messages(files: readonly CatalogSourceFile[], on = today): string[] {
  return validateCatalog(files, on, { awaitingRegrade: partlyRated })
    .filter((issue) => !issue.message.startsWith('Waiting for M11.9’s regrade'))
    .map(
      (issue) => `${issue.severity === 'warning' ? 'warning: ' : ''}${formatCatalogIssue(issue)}`,
    );
}

/** The missing topics, for a provider not waiting for M11.9 unless `awaitingRegrade` says. */
function coverage(files: readonly CatalogSourceFile[], awaitingRegrade = new Set<string>()) {
  return validateCatalog(files, today, { awaitingRegrade })
    .filter((issue) => issue.message.includes('rating or status for'))
    .map(
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

  it('needs every topic to say what silence means, except a titled one, which never may', () => {
    const issues = (topic: unknown) =>
      policyTopicsFileSchema.safeParse([topic]).error?.issues.map((issue) => issue.message) ?? [];
    const { silent, ...unsaid } = topics[0];
    expect(silent).toBe('not-stated');
    expect(issues(unsaid)).toEqual(['Say what silence means: not-stated, or the tier it gets']);
    expect(issues({ ...unsaid, silent: 'poor' })).toEqual([]);
    expect(issues({ ...unsaid, silent: 'maybe' }).length).toBeGreaterThan(0);
    const notable = { ...unsaid, id: 'other.notable', group: 'other', titled: true };
    expect(issues(notable)).toEqual([]);
    expect(issues({ ...notable, silent: 'not-stated' })).toEqual([
      'A titled topic is never required, so silence means nothing: leave silent out',
    ]);
  });

  it('reads silence by the provider’s categories where a topic says so', () => {
    const training: PolicyTopic = { ...topics[0], silentIn: { ai: 'poor' } };
    expect(silentMeaning(training, ['streaming'])).toBe('not-stated');
    expect(silentMeaning(training, ['storage', 'ai'])).toBe('poor');
    expect(silentMeaning(topics[3], ['vpn'])).toBe('poor');
  });

  it('reports a category in silentIn that isn’t a service category', () => {
    const files = edited(withPolicies(), 'data/policy-topics.yaml', [0, 'silentIn'], {
      chatbots: 'poor',
    });
    expect(messages(files)).toEqual([
      'data/policy-topics.yaml 0.silentIn.chatbots: "chatbots" isn\'t a service category in data/categories.yaml (streaming, vpn, privacy-suite)',
    ]);
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
    ).toEqual(['No rating quotes this page or lists it in pages: leave it out']);
  });

  it('keeps a way to change it to a few words and a page (M5.12)', () => {
    const withAction = (action: unknown) => ({
      ...mullvadPolicies,
      ratings: [rating('privacy.data-collection', { action }), ...mullvadPolicies.ratings.slice(1)],
    });
    expect(issues(withAction({ name: 'How to ask for your data', url: privacy }))).toEqual([]);
    expect(issues(withAction({ name: 'x'.repeat(61), url: privacy }))).toEqual([
      'Keep it to a few words (60 characters at most)',
    ]);
    expect(issues(withAction({ name: 'Ask', url: 'http://mullvad.net/' })).length).toBeGreaterThan(
      0,
    );
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

  /** A status rating, without the graded one's tier and quotes. */
  function status(topic: string, extra: Record<string, unknown> = {}) {
    const { tier, sources, ...rest } = rating(topic, {
      status: 'not-stated',
      reason: 'Its terms and privacy policy don’t say.',
      pages: [privacy],
      ...extra,
    });
    expect([tier, sources]).toHaveLength(2);
    return rest;
  }

  it('takes a status instead of a tier: not stated with the pages read, or not applicable (M11.1)', () => {
    const policies = (...ratings: unknown[]) => ({ links: privacyOnly, ratings });
    expect(issues(policies(status('privacy.ads-tracking')))).toEqual([]);
    expect(
      issues(
        policies(
          rating('privacy.data-collection'),
          status('billing.free-trials', {
            status: 'not-applicable',
            reason: 'It has no free trial.',
            pages: undefined,
          }),
        ),
      ),
    ).toEqual([]);
    expect(issues(policies(status('privacy.ads-tracking', { pages: undefined })))).toEqual([
      "Say which pages don't address it: list them in pages",
      'No rating quotes this page or lists it in pages: leave it out',
    ]);
  });

  it('refuses a rating with neither a tier nor a status, both, or a status with quotes or an action', () => {
    const policies = (...ratings: unknown[]) => ({ links: privacyOnly, ratings });
    const { tier, ...ungraded } = rating('privacy.ads-tracking');
    expect(tier).toBe('great');
    expect(issues(policies(ungraded))).toEqual([
      'Give a tier, or a status when the pages give no grade',
    ]);
    expect(issues(policies(rating('privacy.ads-tracking', { status: 'not-stated' })))).toEqual([
      'Give a tier or a status, not both',
    ]);
    expect(
      issues(
        policies({
          ...status('privacy.ads-tracking', { action: { name: 'Ask', url: privacy } }),
          sources: [{ url: privacy, quote: 'We never sell' }],
        }),
      ),
    ).toEqual([
      'A status quotes nothing: list the pages read in pages instead',
      'There is nothing to change without a grade: leave action out',
    ]);
    expect(
      issues(policies(rating('privacy.ads-tracking', { sources: undefined, pages: [privacy] }))),
    ).toEqual([
      'Quote where it says so',
      'A graded rating quotes its pages in sources: leave pages out',
    ]);
  });

  it('lets a titled topic have ratings with different titles', () => {
    const notable = (title: string) => rating('other.notable', { title });
    const policies = (...ratings: unknown[]) => ({ links: privacyOnly, ratings });
    expect(issues(policies(notable('Takes cash'), notable('Sells data on closing')))).toEqual([]);
    expect(issues(policies(notable('Takes cash'), notable('Takes cash')))).toEqual([
      'other.notable is rated already for these plans and regions',
    ]);
    expect(issues(policies(notable('x'.repeat(61))))).toEqual([
      'Keep it to a few words (60 characters at most)',
    ]);
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
          netflixRating('service.activity-logging'),
        ]),
      ),
    ).toEqual([
      'data/providers/netflix.yaml policies.ratings.0.topic: "privacy.data-colection" isn\'t a topic in data/policy-topics.yaml (privacy.data-collection, privacy.ads-tracking, billing.refunds, service.activity-logging, other.notable)',
      'data/providers/netflix.yaml policies.ratings.1.topic: Activity logging is only for providers with a plan in vpn',
    ]);
  });

  it('reports a billing topic for a provider without enough paid plans', () => {
    const twoPaid = edited(withPolicies(), 'data/policy-topics.yaml', [2, 'paidPlans'], 2);
    expect(messages(twoPaid)).toEqual([
      'data/providers/mullvad.yaml policies.ratings.1.topic: Refunds is only for providers with 2 paid plans or more',
    ]);
  });

  it('takes a way to change it on the provider’s own sites or its policies’, and no other (M5.12)', () => {
    // The test catalog's Netflix is on example.com; its privacy statement is on help.netflix.com.
    const action = (url: string) =>
      netflixRating('privacy.ads-tracking', {
        action: { name: 'How to turn off Behavioral Advertising', url },
      });
    expect(messages(withNetflix([action('https://help.netflix.com/node/100637')]))).toEqual([]);
    expect(messages(withNetflix([action('https://www.example.com/account/privacy')]))).toEqual([]);
    expect(messages(withNetflix([action('https://optout.example.org/netflix')]))).toEqual([
      "data/providers/netflix.yaml policies.ratings.0.action.url: Must be a page of Netflix's own sites or its policies' (example.com, help.netflix.com): its own way to change it",
    ]);
  });

  it('needs a way to act on a grade that means the user has to (M11.1)', () => {
    const optOut = edited(
      withPolicies(),
      'data/policy-topics.yaml',
      [0, 'actionFor'],
      ['neutral', 'poor'],
    );
    const graded = (extra: Record<string, unknown>) =>
      edited(optOut, 'data/providers/mullvad.yaml', ['policies', 'ratings', 0], {
        ...rating('privacy.data-collection'),
        ...extra,
      });
    const missing =
      "data/providers/mullvad.yaml policies.ratings.0.action: Data collection rated Neutral means the user has to act: link Mullvad VPN's own page for it in action";
    const all = (files: CatalogSourceFile[], awaitingRegrade = new Set<string>()) =>
      validateCatalog(files, today, { awaitingRegrade })
        .filter((issue) => issue.path.at(-1) === 'action')
        .map(
          (issue) =>
            `${issue.severity === 'warning' ? 'warning: ' : ''}${formatCatalogIssue(issue)}`,
        );
    expect(all(graded({ tier: 'neutral' }))).toEqual([missing]);
    expect(all(graded({ tier: 'neutral' }), new Set(['mullvad']))).toEqual([`warning: ${missing}`]);
    expect(
      all(graded({ tier: 'neutral', action: { name: 'How to opt out', url: privacy } })),
    ).toEqual([]);
    expect(all(graded({ tier: 'great' }))).toEqual([]);
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

  it('needs a title on each notable rating, up to three, with a grade, and no title elsewhere', () => {
    const notable = (title?: string, extra: Record<string, unknown> = {}) =>
      rating('other.notable', { ...(title && { title }), ...extra });
    const withRatings = (...ratings: unknown[]) =>
      withPolicies({ ...mullvadPolicies, ratings: [...mullvadPolicies.ratings, ...ratings] });
    expect(messages(withRatings(notable('Takes cash'), notable('No email needed')))).toEqual([]);
    expect(
      messages(
        withRatings(
          notable(),
          rating('privacy.ads-tracking', { title: 'Ads' }),
          notable('Takes cash', {
            tier: undefined,
            status: 'not-stated',
            sources: undefined,
            pages: [privacy],
          }),
        ),
      ),
    ).toEqual([
      'data/providers/mullvad.yaml policies.ratings.3.title: Give each Notable rating a title: what stands out, in a few words',
      'data/providers/mullvad.yaml policies.ratings.4.title: Only a titled topic’s ratings (other.notable) have a title: leave it out',
      'data/providers/mullvad.yaml policies.ratings.5.status: Notable is never required: grade it, or leave it out',
    ]);
    expect(
      messages(withRatings(notable('One'), notable('Two'), notable('Three'), notable('Four'))),
    ).toEqual([
      'data/providers/mullvad.yaml policies.ratings.6.topic: Notable takes up to 3 ratings: keep the ones that stand out most',
    ]);
  });

  it('names every topic that applies and has no rating or status for everywhere (M11.1)', () => {
    const mullvad = (files: readonly CatalogSourceFile[]) =>
      coverage(files).filter((message) => message.includes('mullvad.yaml'));
    expect(mullvad(withPolicies())).toEqual([
      'data/providers/mullvad.yaml policies: No rating or status for a topic that applies: privacy.ads-tracking. Rate each, or give it a status (not-stated or not-applicable)',
    ]);
    // The test catalog's Netflix has no policies at all; notable is never required, activity logging is for VPNs.
    expect(coverage(withPolicies()).filter((message) => message.includes('netflix.yaml'))).toEqual([
      'data/providers/netflix.yaml: No rating or status for 3 topics that apply: privacy.data-collection, privacy.ads-tracking, billing.refunds. Rate each, or give it a status (not-stated or not-applicable)',
    ]);
    const onlyInUs = withPolicies({
      ...mullvadPolicies,
      ratings: [...mullvadPolicies.ratings, rating('privacy.ads-tracking', { regions: ['US'] })],
    });
    expect(mullvad(onlyInUs)).toEqual([
      'data/providers/mullvad.yaml policies: No rating or status for a topic that applies: privacy.ads-tracking (only for some plans or regions). Rate each, or give it a status (not-stated or not-applicable)',
    ]);
    const stated = withPolicies({
      ...mullvadPolicies,
      ratings: [
        ...mullvadPolicies.ratings,
        {
          topic: 'privacy.ads-tracking',
          status: 'not-stated',
          reason: 'Its privacy policy doesn’t say.',
          pages: [privacy],
          lastVerified: '2026-10-22',
        },
      ],
    });
    expect(mullvad(stated)).toEqual([]);
  });

  it('only warns about the missing topics of a provider waiting for M11.9’s regrade', () => {
    expect(
      coverage(withPolicies(), new Set(['mullvad'])).filter((message) =>
        message.includes('mullvad.yaml'),
      ),
    ).toEqual([
      'warning: data/providers/mullvad.yaml policies: Waiting for M11.9’s regrade: no rating or status for a topic that applies: privacy.ads-tracking. Rate each, or give it a status (not-stated or not-applicable)',
    ]);
  });

  it('needs the topics file once a provider rates its policies', () => {
    const files = withPolicies().filter(({ file }) => file !== 'data/policy-topics.yaml');
    expect(messages(files)).toEqual([
      'data/policy-topics.yaml: Missing: the topics that providers rate their policies on go here (BLUEPRINT §4.10)',
    ]);
  });
});

describe('planPolicies', () => {
  const mullvad = catalog().find(({ file }) => file === 'data/providers/mullvad.yaml');
  const { category, plans } = (mullvad && 'data' in mullvad ? mullvad.data : {}) as Provider;
  const provider = (ratings: unknown[], links: unknown = mullvadPolicies.links) => ({
    category,
    plans,
    policies: { links, ratings } as Policies,
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
      ['billing', ['billing.refunds']],
      ['service', ['service.activity-logging']],
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
      ['billing.refunds', ['1 Terms of service']],
      ['service.activity-logging', ['2 Privacy policy']],
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

  it('gives a rating’s way to change it (M5.12)', () => {
    const action = { name: 'How to ask for your data', url: privacy };
    const shown = planPolicies(
      provider([rating('privacy.data-collection', { action })]),
      'mullvad.vpn',
      'CA',
      topics,
    );
    expect(shown?.groups[0].policies[0].action).toEqual(action);
    expect(
      planPolicies(provider(mullvadPolicies.ratings), 'mullvad.vpn', 'CA', topics)?.groups[0]
        .policies[0],
    ).not.toHaveProperty('action');
  });

  it('shows nothing for a provider with no ratings, or none that applies', () => {
    expect(planPolicies({ category, plans }, 'mullvad.vpn', 'CA', topics)).toBeUndefined();
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

describe('planPolicies, for statuses and titles (M11.1)', () => {
  const mullvad = catalog().find(({ file }) => file === 'data/providers/mullvad.yaml');
  const { category, plans } = (mullvad && 'data' in mullvad ? mullvad.data : {}) as Provider;
  const notStated = (topic: string) => ({
    topic,
    status: 'not-stated',
    reason: 'Its privacy policy doesn’t say.',
    pages: [privacy],
    lastVerified: '2026-10-22',
  });
  const shown = (ratings: unknown[], links = privacyOnly) =>
    planPolicies(
      { category, plans, policies: { links, ratings } as Policies },
      'mullvad.vpn',
      'CA',
      topics,
    )?.groups.flatMap(({ policies }) => policies);

  it('shows Not stated without a grade where silence proves nothing, citing the pages read', () => {
    expect(shown([notStated('privacy.ads-tracking')])).toEqual([
      {
        topic: topics[1],
        status: 'not-stated',
        reason: 'Its privacy policy doesn’t say.',
        citations: [{ number: 1, name: 'Privacy policy', quotes: [], href: privacy }],
      },
    ]);
  });

  it('grades silence where the topic says it means a missing protection', () => {
    expect(shown([notStated('service.activity-logging')])?.[0]).toMatchObject({
      tier: 'poor',
      status: 'not-stated',
    });
  });

  it('shows not applicable without a grade, and each notable rating with its title', () => {
    const policies = shown([
      {
        topic: 'billing.refunds',
        status: 'not-applicable',
        reason: 'It never charges.',
        lastVerified: '2026-10-22',
      },
      rating('other.notable', { title: 'Takes cash' }),
      rating('other.notable', { title: 'No email needed', tier: 'good' }),
    ]);
    expect(
      policies?.map(({ topic, tier, status, title }) => [topic.id, tier, status, title]),
    ).toEqual([
      ['billing.refunds', undefined, 'not-applicable', undefined],
      ['other.notable', 'great', undefined, 'Takes cash'],
      ['other.notable', 'good', undefined, 'No email needed'],
    ]);
    expect(policies?.[0].citations).toEqual([]);
  });
});

describe('a topic and a feature on the same fact (M11.1)', () => {
  const audits = {
    id: 'vpn.independent-audits',
    parent: 'vpn.included',
    name: 'Independent audits',
    category: 'vpn',
    type: 'set',
    values: [
      { id: 'no-logs', name: 'No-logs policy' },
      { id: 'servers', name: 'Server infrastructure' },
    ],
  };
  /** The test catalog with the audits feature in the registry, Mullvad's plan auditing `values`. */
  const withAudits = (values?: string[], files = withPolicies()) =>
    edited(
      files.map((source) =>
        source.file === 'data/features.yaml' && 'data' in source
          ? { ...source, data: [...(source.data as unknown[]), audits] }
          : source,
      ),
      'data/providers/mullvad.yaml',
      ['plans', 0, 'features', 'vpn.independent-audits'],
      values,
    );
  const unaudited =
    'data/providers/mullvad.yaml policies.ratings.2.tier: Great needs an independent audit of the no-logs claim, but mullvad.vpn has no no-logs in vpn.independent-audits: grade it lower, or add the audit to the feature with its source';

  it('is inactive until the registry has the feature', () => {
    expect(messages(withPolicies())).toEqual([]);
  });

  it('lets activity logging be Great only when the VPN plans’ audits include no-logs', () => {
    expect(messages(withAudits())).toEqual([unaudited]);
    expect(messages(withAudits(['servers']))).toEqual([unaudited]);
    expect(messages(withAudits(['no-logs', 'servers']))).toEqual([]);
  });

  it('leaves a lower grade, and a plan without the VPN, alone', () => {
    const good = withPolicies({
      ...mullvadPolicies,
      ratings: [
        ...mullvadPolicies.ratings.slice(0, 2),
        rating('service.activity-logging', { tier: 'good', reason: 'No logs, unaudited.' }),
      ],
    });
    expect(messages(withAudits(undefined, good))).toEqual([]);
    expect(
      messages(
        edited(
          withAudits(),
          'data/providers/mullvad.yaml',
          ['plans', 0, 'features', 'vpn.included'],
          false,
        ),
      ).filter((message) => message.includes('independent audit')),
    ).toEqual([]);
  });

  it('checks a shared document’s rating against the plans of each provider naming it', () => {
    const privacy = 'https://privacy.example.com/policy';
    const files = withAudits(undefined, [
      ...withPolicies({
        ...mullvadPolicies,
        ratings: mullvadPolicies.ratings.slice(0, 2),
        shared: ['vpn-group'],
      }),
      {
        file: 'data/policies/vpn-group.yaml',
        data: {
          id: 'vpn-group',
          name: 'The VPN Group’s policy',
          links: [{ name: 'Policy', url: privacy }],
          ratings: [
            rating('service.activity-logging', { sources: [{ url: privacy, quote: 'No logs' }] }),
          ],
        },
      },
    ]);
    expect(messages(files)).toEqual([
      'data/providers/mullvad.yaml policies.shared.0: Great needs an independent audit of the no-logs claim, but mullvad.vpn has no no-logs in vpn.independent-audits: grade it lower, or add the audit to the feature with its source',
    ]);
  });
});

describe('shared policy documents (M11.1)', () => {
  const groupPrivacy = 'https://privacy.example.com/policy';
  const groupLinks = [{ name: 'Group privacy policy', url: groupPrivacy }];
  const groupRating = (topic: string, extra: Record<string, unknown> = {}) =>
    rating(topic, {
      tier: 'poor',
      reason: 'The group’s policy.',
      sources: [{ url: groupPrivacy, quote: 'We share with partners' }],
      ...extra,
    });
  const set = {
    id: 'group-privacy',
    name: 'The Group’s privacy policy',
    links: groupLinks,
    ratings: [groupRating('privacy.data-collection'), groupRating('privacy.ads-tracking')],
  };
  const setFile = { file: 'data/policies/group-privacy.yaml', data: set };
  /** The test catalog with the set, and Mullvad naming it beside `own` ratings of its own. */
  const withSet = (
    own: Record<string, unknown> = mullvadPolicies,
    extra: CatalogSourceFile[] = [],
  ) => [...withPolicies({ shared: ['group-privacy'], ...own }), setFile, ...extra];
  const issues = (schema: typeof policySetSchema | typeof policiesSchema, value: unknown) =>
    schema.safeParse(value).error?.issues.map((issue) => issue.message) ?? [];

  it('rates a company’s document once, for every plan of each provider naming it', () => {
    expect(issues(policySetSchema, set)).toEqual([]);
    expect(
      issues(policySetSchema, {
        ...set,
        ratings: [
          groupRating('privacy.data-sharing', { plans: ['mullvad.vpn'], replacesShared: true }),
        ],
      }),
    ).toEqual([
      "A shared document's ratings are for every provider it covers: rate a plan in its provider's file",
      'Only a provider’s own rating replaces a shared one: leave replacesShared out',
    ]);
  });

  it('lets a provider name shared documents with or without ratings of its own', () => {
    expect(issues(policiesSchema, { shared: ['group-privacy'] })).toEqual([]);
    expect(issues(policiesSchema, {})).toEqual([
      'Rate its policies, or name the shared documents that cover them (shared)',
    ]);
    expect(issues(policiesSchema, { ratings: mullvadPolicies.ratings })).toEqual([
      'List the pages the ratings quote',
    ]);
    expect(
      issues(policiesSchema, {
        ...mullvadPolicies,
        ratings: [rating('privacy.data-collection', { replacesShared: true })],
      }),
    ).toEqual([
      'There is no shared document to replace: leave replacesShared out',
      'No rating quotes this page or lists it in pages: leave it out',
    ]);
  });

  it('accepts a provider naming a shared document, and counts its ratings as the provider’s', () => {
    expect(messages(withSet())).toEqual([]);
    // Mullvad's own ratings leave out ads and tracking, which the shared document rates.
    expect(coverage(withSet()).filter((message) => message.includes('mullvad.yaml'))).toEqual([]);
  });

  it('lets a renewal day quote a shared document the provider names (ESPN’s agreement, on hulu.com, M11.9)', () => {
    const anchor = {
      kind: 'same-date',
      page: 'Subscriber agreement',
      url: groupPrivacy,
      quotes: [
        'if your subscription began on a day not contained in a given month (e.g. if you have a monthly subscription and became a paying subscriber on January 31, your payment method would be billed next on February 28)',
      ],
      lastVerified: today,
    };
    const withAnchor = (files: CatalogSourceFile[]) =>
      edited(files, 'data/providers/mullvad.yaml', ['renewalAnchor'], anchor);
    expect(messages(withAnchor(withSet()))).toEqual([]);
    expect(messages(withAnchor(withPolicies()))).toContainEqual(
      expect.stringMatching(
        /^data\/providers\/mullvad\.yaml renewalAnchor\.url: Must be a page of Mullvad VPN's own sites, its policies' or its owner's/,
      ),
    );
  });

  it('reports a document no file holds, a replacement for a topic it doesn’t rate, and a document no one names', () => {
    expect(
      messages(
        withSet({
          ...mullvadPolicies,
          shared: ['group-privacy', 'group-privcy'],
          ratings: [
            ...mullvadPolicies.ratings.slice(1),
            rating('privacy.data-collection', { replacesShared: true }),
          ],
        }),
      ),
    ).toEqual([
      'data/providers/mullvad.yaml policies.shared.1: "group-privcy" isn\'t a shared document in data/policies/ (did you mean group-privacy?)',
    ]);
    expect(
      messages(
        withSet({
          ...mullvadPolicies,
          ratings: [
            mullvadPolicies.ratings[0],
            { ...mullvadPolicies.ratings[1], replacesShared: true },
            mullvadPolicies.ratings[2],
          ],
        }),
      ),
    ).toEqual([
      'data/providers/mullvad.yaml policies.ratings.1.replacesShared: No shared document it names rates billing.refunds: leave replacesShared out',
    ]);
    expect(messages([...withPolicies(), setFile])).toEqual([
      "warning: data/policies/group-privacy.yaml id: No provider names this document in its policies' shared: add it to the providers it covers, or remove it",
    ]);
  });

  it('checks a document’s ratings as a provider’s: topics, dates, and a way to change it on its own sites', () => {
    const files = withSet(mullvadPolicies, []).map((source) =>
      source.file === setFile.file
        ? {
            ...source,
            data: {
              ...set,
              ratings: [
                groupRating('privacy.data-colection', { lastVerified: '2026-10-24' }),
                groupRating('privacy.ads-tracking', {
                  action: { name: 'Opt out', url: 'https://optout.example.org/' },
                }),
              ],
            },
          }
        : source,
    );
    expect(messages(files)).toEqual([
      expect.stringMatching(
        /^data\/policies\/group-privacy\.yaml ratings\.0\.topic: "privacy\.data-colection" isn't a topic/,
      ),
      `data/policies/group-privacy.yaml ratings.0.lastVerified: 2026-10-24 is after today (${today})`,
      "data/policies/group-privacy.yaml ratings.1.action.url: Must be a page of The Group’s privacy policy's own sites or its policies' (privacy.example.com): its own way to change it",
    ]);
  });

  it('needs the file named after its id', () => {
    expect(
      messages(
        withSet(mullvadPolicies).map((source) =>
          source.file === setFile.file ? { ...source, data: { ...set, id: 'group' } } : source,
        ),
      ),
    ).toEqual([
      'data/policies/group-privacy.yaml id: Must be group-privacy to match the file name, or rename the file',
    ]);
  });

  it('publishes each document and each provider’s policies in a file of its own, out of the catalog (M11.8)', () => {
    const source = readCatalogSource(withSet());
    const data = buildCatalogData(source, 'https://sub.simplely.ca/icons/');
    expect(data.policySets).toBeUndefined();
    const mullvad = data.providers.find((provider) => provider.id === 'mullvad');
    expect(mullvad?.policies).toBeUndefined();
    expect(mullvad?.policiesUrl).toBe('https://sub.simplely.ca/data/policies/mullvad.json');
    const files = policyFiles(source);
    expect(files.sets).toEqual([set]);
    expect(files.providers.map((file) => file.id)).toContain('mullvad');
    const index = buildPolicyIndex(files);
    expect(index.sets['group-privacy']).toEqual({ links: set.links.map((link) => link.url) });
    expect(index.providers['mullvad']?.shared).toEqual(['group-privacy']);
    expect(policyFilePath('mullvad')).toBe('data/policies/mullvad.json');
    expect(sharedPolicyFilePath('group-privacy')).toBe('data/policies/shared/group-privacy.json');
    // The nightly check's slice of it (M11.8): only the providers asked for, and the documents they name.
    const json = JSON.parse(JSON.stringify(index)) as unknown;
    expect(policyIndexPart(json, ['mullvad', 'gone'])).toEqual({
      providers: { mullvad: index.providers['mullvad'] },
      sets: { 'group-privacy': index.sets['group-privacy'] },
    });
    const others = Object.keys(index.providers).filter((id) => id !== 'mullvad');
    expect(policyIndexPart(json, others).sets).toEqual({});
    expect(() =>
      policyIndexPart({ ...index, providers: { mullvad: { links: ['not a url'] } } }, ['mullvad']),
    ).toThrow();
  });

  describe('planPolicies, with a shared document', () => {
    const mullvad = catalog().find(({ file }) => file === 'data/providers/mullvad.yaml');
    const { category, plans } = (mullvad && 'data' in mullvad ? mullvad.data : {}) as Provider;
    const shown = (own: unknown[], sets = [set as PolicySet]) =>
      planPolicies(
        {
          category,
          plans,
          policies: {
            shared: ['group-privacy'],
            links: mullvadPolicies.links,
            ratings: own,
          } as Policies,
        },
        'mullvad.vpn',
        'CA',
        topics,
        sets,
      );
    const line = (own: unknown[], topic: string) =>
      shown(own)
        ?.groups.flatMap(({ policies }) => policies)
        .find((policy) => policy.topic.id === topic);

    it('shows the document’s rating where the provider has none, citing its page after the provider’s', () => {
      const policies = shown([mullvadPolicies.ratings[1]]);
      expect(
        policies?.groups.flatMap(({ policies }) => policies.map(({ topic }) => topic.id)),
      ).toEqual(['privacy.data-collection', 'privacy.ads-tracking', 'billing.refunds']);
      expect(policies?.links.map(({ name }) => name)).toEqual([
        'Terms of service',
        'Group privacy policy',
      ]);
      expect(
        line([], 'privacy.ads-tracking')?.citations.map(({ number, name }) => `${number} ${name}`),
      ).toEqual(['1 Group privacy policy']);
    });

    it('takes the worse of the provider’s rating and the document’s, the provider’s on a tie', () => {
      expect(line([rating('privacy.data-collection')], 'privacy.data-collection')?.reason).toBe(
        'The group’s policy.',
      );
      expect(
        line(
          [rating('privacy.data-collection', { tier: 'bad', reason: 'Its own.' })],
          'privacy.data-collection',
        )?.reason,
      ).toBe('Its own.');
      expect(
        line(
          [rating('privacy.data-collection', { tier: 'poor', reason: 'Its own.' })],
          'privacy.data-collection',
        )?.reason,
      ).toBe('Its own.');
    });

    it('takes the provider’s rating when its document says it applies instead', () => {
      expect(
        line(
          [rating('privacy.data-collection', { reason: 'Its own.', replacesShared: true })],
          'privacy.data-collection',
        )?.tier,
      ).toBe('great');
    });

    it('prefers a graded rating to a status from either side', () => {
      const unsaid = {
        topic: 'privacy.data-collection',
        status: 'not-stated',
        reason: 'Its terms don’t say.',
        pages: [terms],
        lastVerified: '2026-10-22',
      };
      expect(line([unsaid], 'privacy.data-collection')?.tier).toBe('poor');
    });

    it('leaves out a document’s rating on a topic that doesn’t apply to the provider', () => {
      const withLogging = {
        ...set,
        ratings: [...set.ratings, groupRating('service.activity-logging')],
      } as PolicySet;
      const streaming = planPolicies(
        { category: 'streaming', plans, policies: { shared: ['group-privacy'] } },
        'mullvad.vpn',
        'CA',
        topics,
        [withLogging],
      );
      expect(streaming?.groups.map(({ group }) => group)).toEqual(['privacy']);
    });
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

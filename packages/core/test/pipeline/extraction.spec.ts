import { describe, expect, it } from 'vitest';
import {
  draftFromAnswer,
  extractionAnswerSchema,
  extractionParts,
  extractionPrompt,
  findQuote,
  mergeAnswers,
  providerSchema,
  resolveFeature,
  spendCategoryOf,
  type ExtractionContext,
  type Feature,
  type PolicyTopic,
} from '../../src';

const features: Feature[] = [
  {
    id: 'video.quality',
    name: 'Video quality',
    category: 'streaming',
    type: 'enum',
    values: [
      { id: '1080p', name: '1080p (Full HD)' },
      { id: '4k', name: '4K (Ultra HD)', aliases: ['uhd', '2160p'] },
    ],
  },
  {
    id: 'streaming.ad-free',
    name: 'Ad free',
    category: 'streaming',
    type: 'boolean',
    aliases: ['no ads'],
  },
  { id: 'vpn.included', name: 'VPN', category: 'vpn', type: 'boolean' },
  {
    id: 'vpn.devices',
    parent: 'vpn.included',
    name: 'VPN devices',
    category: 'vpn',
    type: 'number',
    unit: 'devices',
  },
];

const topics: PolicyTopic[] = [
  {
    id: 'billing.cancel-refunds',
    name: 'Cancelling and refunds',
    group: 'billing',
    question: 'What happens when you cancel.',
    tiers: { great: 'a', good: 'b', neutral: 'c', poor: 'd', bad: 'e' },
  },
];

const pricingText =
  'Choose your plan. Standard: $18.99 / month. Premium: $23.99 / month. Premium streams in 4K (Ultra HD) with no ads. ' +
  'Premium yearly: $239.90 billed every 12 months. Watch on up to 4 devices with Family Watch. ' +
  'Introductory offer: Premium for $9.99 your first month. We accept Visa, Mastercard and American Express.';
const termsText =
  'Terms of Use. You can cancel anytime; you’ll keep access until the end of your billing period. We don’t give refunds for partial months.';

function context(): ExtractionContext {
  return {
    provider: {
      id: 'streamco',
      name: 'StreamCo',
      website: 'https://www.streamco.example',
      category: 'streaming',
    },
    pages: [
      {
        name: 'pricing',
        kind: 'pricing',
        url: 'https://www.streamco.example/plans',
        text: pricingText,
      },
      {
        name: 'cancel',
        kind: 'cancel',
        url: 'https://help.streamco.example/cancel',
        text: 'How to cancel. Cancel anytime.',
      },
      { name: 'terms', kind: 'terms', url: 'https://www.streamco.example/terms', text: termsText },
    ],
    features,
    topics,
    today: '2026-10-28',
  };
}

const price = (amount: number, quote: string, more: object = {}) => ({
  region: 'CA',
  currency: 'CAD',
  amount,
  interval: 'month',
  page: 'pricing',
  quote,
  ...more,
});

function answer(more: object = {}) {
  return extractionAnswerSchema.parse({
    plans: [
      { name: 'Standard', prices: [price(18.99, 'Standard: $18.99 / month')] },
      {
        name: 'Premium',
        prices: [
          price(23.99, 'Premium: $23.99 / month'),
          price(239.9, 'Premium yearly: $239.90 billed every 12 months', { interval: 'year' }),
        ],
        features: [
          {
            feature: 'Video quality',
            value: 'UHD',
            page: 'pricing',
            quote: 'Premium streams in 4K (Ultra HD)',
          },
          { feature: 'no ads', value: 'yes', page: 'pricing', quote: 'with no ads' },
        ],
        perks: [{ text: 'Family Watch', page: 'pricing', quote: 'with Family Watch' }],
      },
    ],
    acceptedNetworks: [
      {
        region: 'CA',
        networks: ['visa', 'mastercard', 'amex', 'discover'],
        page: 'pricing',
        quotes: ['We accept Visa, Mastercard and American Express.'],
      },
    ],
    policies: [
      {
        topic: 'billing.cancel-refunds',
        tier: 'neutral',
        reason:
          'You can cancel anytime and keep watching until the period ends, but you get no money back.',
        sources: [
          { page: 'terms', quote: "you'll keep access until the end of your billing period" },
        ],
      },
    ],
    ...more,
  });
}

describe('findQuote', () => {
  it("finds a quote word for word, and returns the page's own words when only quotes, dashes or capitals differ", () => {
    expect(findQuote('Premium:   $23.99 / month', pricingText)).toBe('Premium: $23.99 / month');
    expect(findQuote("YOU'LL keep access", termsText)).toBe('you’ll keep access');
    expect(findQuote('Premium: $24.99 / month', pricingText)).toBeUndefined();
    expect(findQuote('a', pricingText)).toBeUndefined();
  });
});

describe('draftFromAnswer', () => {
  it('drafts a provider file that passes its schema', () => {
    const draft = draftFromAnswer(answer(), context());
    expect(draft.issues).toEqual([]);
    expect(providerSchema.safeParse(draft.provider).success).toBe(true);
    expect(draft.provider).toMatchObject({
      id: 'streamco',
      category: 'streaming',
      spendCategory: 'streaming',
      billingCurrency: { CA: 'CAD' },
      cancelUrl: 'https://help.streamco.example/cancel',
      sources: { pricing: 'https://www.streamco.example/plans' },
      acceptedNetworks: {
        CA: {
          networks: ['visa', 'mastercard', 'amex'],
          url: 'https://www.streamco.example/plans',
          quotes: ['We accept Visa, Mastercard and American Express.'],
        },
      },
    });
    const premium = draft.provider?.plans[1];
    expect(premium).toMatchObject({
      id: 'streamco.premium',
      link: 'https://www.streamco.example/plans',
      features: { 'video.quality': '4k', 'streaming.ad-free': true },
      perks: ['Family Watch'],
    });
    expect(premium?.prices[1]).toEqual({
      region: 'CA',
      currency: 'CAD',
      amount: 239.9,
      interval: 'year',
      intervalCount: 1,
      autoRenew: true,
      lastVerified: '2026-10-28',
      sourceUrl: 'https://www.streamco.example/plans',
    });
    // The page's own curly apostrophe, not the answer's straight one.
    expect(draft.provider?.policies?.ratings[0].sources[0].quote).toBe(
      'you’ll keep access until the end of your billing period',
    );
    expect(draft.provider?.policies?.links).toEqual([
      { name: 'Terms of service', url: 'https://www.streamco.example/terms' },
    ]);
  });

  it('drops a price whose quote is not on its page, or does not show its amount', () => {
    const draft = draftFromAnswer(
      answer({
        plans: [
          { name: 'Basic', prices: [price(12.99, 'Basic: $12.99 / month')] },
          { name: 'Standard', prices: [price(19.99, 'Standard: $18.99 / month')] },
        ],
      }),
      context(),
    );
    expect(draft.issues.map(({ subject, reason }) => `${subject}: ${reason}`)).toEqual([
      'Basic, CA 12.99 CAD every 1 month: Its quote isn’t on the page',
      'Basic: No price that holds: the plan is left out',
      'Standard, CA 19.99 CAD every 1 month: Its quote doesn’t show that amount',
      'Standard: No price that holds: the plan is left out',
      'StreamCo: No plan with a checked price: no draft',
    ]);
    expect(draft.provider).toBeUndefined();
  });

  it('never keeps a first-term price, a business plan or an implausible amount', () => {
    const draft = draftFromAnswer(
      answer({
        plans: [
          {
            name: 'Premium',
            prices: [price(9.99, 'Premium for $9.99 your first month', { regular: false })],
          },
          { name: 'Teams', business: true, prices: [price(23.99, 'Premium: $23.99 / month')] },
          {
            name: 'Standard',
            prices: [price(18.99, 'Standard: $18.99 / month', { region: 'Canada' })],
          },
        ],
      }),
      context(),
    );
    expect(draft.issues.map(({ reason }) => reason)).toEqual([
      'A sale or first-term price: only the price it renews at is stored',
      'No price that holds: the plan is left out',
      'A business or per-seat plan: left out',
      '"Canada" isn\'t a region code',
      'No price that holds: the plan is left out',
      'No plan with a checked price: no draft',
    ]);
  });

  it('takes card networks only when their quotes name them', () => {
    const draft = draftFromAnswer(answer(), context());
    expect(draft.provider?.acceptedNetworks?.['CA']?.networks).not.toContain('discover');
  });

  it('makes an unknown feature a proposal, and checks a known one’s value', () => {
    const draft = draftFromAnswer(
      answer({
        plans: [
          {
            name: 'Premium',
            prices: [price(23.99, 'Premium: $23.99 / month')],
            features: [
              { feature: 'Family Watch', value: true, page: 'pricing', quote: 'with Family Watch' },
              {
                feature: 'video.quality',
                value: '8k',
                page: 'pricing',
                quote: 'Premium streams in 4K',
              },
            ],
          },
        ],
      }),
      context(),
    );
    expect(draft.proposedFeatures).toEqual([
      {
        name: 'Family Watch',
        description: 'true on Premium',
        plans: ['Premium'],
        url: 'https://www.streamco.example/plans',
        quote: 'with Family Watch',
      },
    ]);
    expect(draft.issues.map(({ reason }) => reason)).toContain('video.quality is one of 1080p, 4k');
  });

  it('says when there is no cancel page, and stops at an answer out of scope', () => {
    const noCancel = {
      ...context(),
      pages: context().pages.filter((page) => page.kind !== 'cancel'),
    };
    const draft = draftFromAnswer(answer(), noCancel);
    expect(draft.provider?.cancelUrl).toBeUndefined();
    expect(draft.issues.at(-1)?.reason).toMatch(/No cancel page was found/);
    const out = draftFromAnswer(answer({ outOfScope: 'Business plans only' }), context());
    expect(out.outOfScope).toBe('Business plans only');
    expect(out.provider).toBeUndefined();
  });

  it('writes what each page was in the header, and each check that found nothing', () => {
    const draft = draftFromAnswer(answer({ notOnPages: ['No yearly Standard price'] }), context());
    expect(draft.comments).toEqual([
      "Drafted by the discovery pipeline on 2026-10-28 (BLUEPRINT §6.5) from these pages, each quoted where it's used.",
      'Pricing: https://www.streamco.example/plans.',
      'Payment methods: none found.',
      'Cancelling: https://help.streamco.example/cancel.',
      'Terms: https://www.streamco.example/terms.',
      'Privacy: none found.',
      'Bundles: none found.',
      'Official resellers: none found.',
      'Not on the pages: No yearly Standard price.',
    ]);
  });
});

describe('resolveFeature', () => {
  it('finds a feature by id, name or alias, and sets its group', () => {
    expect(resolveFeature('VPN devices', '10', features)).toEqual({
      id: 'vpn.devices',
      value: 10,
      parent: 'vpn.included',
    });
    expect(resolveFeature('vpn.devices', 'Unlimited', features)).toMatchObject({
      value: 'unlimited',
    });
    expect(resolveFeature('Teleportation', true, features)).toBeUndefined();
  });

  it('gives the group with its child in a draft', () => {
    const draft = draftFromAnswer(
      answer({
        plans: [
          {
            name: 'Premium',
            prices: [price(23.99, 'Premium: $23.99 / month')],
            features: [
              {
                feature: 'VPN devices',
                value: 4,
                page: 'pricing',
                quote: 'Watch on up to 4 devices',
              },
            ],
          },
        ],
      }),
      context(),
    );
    expect(draft.provider?.plans[0].features).toEqual({ 'vpn.included': true, 'vpn.devices': 4 });
  });
});

describe('spendCategoryOf', () => {
  it('maps service categories to card-reward categories', () => {
    expect(spendCategoryOf('music')).toBe('streaming');
    expect(spendCategoryOf('vpn')).toBe('software');
    expect(spendCategoryOf('fitness')).toBe('health');
  });
});

describe('the request', () => {
  it('gives a session the rules, the registry, the topics, the schema and the pages', () => {
    const prompt = extractionPrompt(context());
    expect(prompt).toContain('# Extraction: StreamCo (streamco)');
    expect(prompt).toContain('The regular price: what the plan renews at.');
    expect(prompt).toContain('- video.quality: one of 1080p, 4k. Video quality');
    expect(prompt).toContain(
      '- vpn.devices: a number of devices, or "unlimited". VPN devices (with vpn.included: true)',
    );
    expect(prompt).toContain('- billing.cancel-refunds (Cancelling and refunds)');
    expect(prompt).toContain(
      '=== page "pricing" (pricing): https://www.streamco.example/plans ===',
    );
  });

  it('splits it into the plans and the policies for a small model, and merges the answers', () => {
    const parts = extractionParts(context(), 1_000);
    expect(parts.map((part) => part.part)).toEqual(['plans', 'policies']);
    expect(parts[0].user).toContain('Standard: $18.99');
    expect(parts[0].user).not.toContain('Terms of Use');
    expect(parts[1].user).toContain('cancel anytime');
    const merged = mergeAnswers([answer({ policies: [] }), answer({ plans: [] })]);
    expect(merged.plans).toHaveLength(2);
    expect(merged.policies).toHaveLength(1);
  });
});

describe('draftFromAnswer: official resellers', () => {
  const resellerContext = (): ExtractionContext => ({
    ...context(),
    pages: [
      ...context().pages,
      {
        name: 'resellers',
        kind: 'resellers',
        url: 'https://www.streamco.example/where-to-buy',
        text: 'Our official resellers: Shopmart - CA. Gift cards also at Bargains.',
      },
      {
        name: 'resellers-2',
        kind: 'resellers',
        url: 'https://www.shopmart.example/streamco-card',
        text: 'StreamCo Standard 12-month card: $199.99. Regular price. Sale ends soon.',
      },
    ],
    resellers: [{ id: 'bargains', name: 'Bargains', website: 'https://www.bargains.example' }],
  });
  const offer = (page: string, quote: string) => ({
    plan: 'Standard',
    prices: [
      price(199.99, quote, { page, interval: 'month', intervalCount: 12, autoRenew: false }),
    ],
  });

  it('lists a shop the provider’s own page names, priced on its own page, and adds it to the resellers', () => {
    const draft = draftFromAnswer(
      answer({
        resellers: [
          {
            shop: 'Shopmart',
            website: 'https://www.shopmart.example',
            approval: { page: 'resellers', quotes: ['Shopmart - CA'] },
            offers: [offer('resellers-2', 'StreamCo Standard 12-month card: $199.99')],
          },
        ],
      }),
      resellerContext(),
    );
    expect(draft.issues).toEqual([]);
    expect(draft.newResellers).toEqual([
      { id: 'shopmart', name: 'Shopmart', website: 'https://www.shopmart.example' },
    ]);
    expect(draft.provider?.resellers).toEqual([
      {
        reseller: 'shopmart',
        approvedBy: { url: 'https://www.streamco.example/where-to-buy', quotes: ['Shopmart - CA'] },
        offers: [
          {
            plan: 'streamco.standard',
            prices: [
              {
                region: 'CA',
                currency: 'CAD',
                amount: 199.99,
                interval: 'month',
                intervalCount: 12,
                autoRenew: false,
                lastVerified: '2026-10-28',
                sourceUrl: 'https://www.shopmart.example/streamco-card',
              },
            ],
          },
        ],
      },
    ]);
    expect(providerSchema.safeParse(draft.provider).success).toBe(true);
  });

  it('keeps a known shop’s id, and drops a price that isn’t on the shop’s own page', () => {
    const draft = draftFromAnswer(
      answer({
        resellers: [
          {
            shop: 'Bargains',
            website: 'https://bargains.example',
            approval: { page: 'resellers', quotes: ['Gift cards also at Bargains.'] },
            offers: [offer('resellers-2', 'StreamCo Standard 12-month card: $199.99')],
          },
        ],
      }),
      resellerContext(),
    );
    expect(draft.newResellers).toEqual([]);
    expect(draft.issues.map(({ reason }) => reason)).toEqual([
      'Its price isn’t on the shop’s own page',
      'No offer with a checked price on the shop’s own page',
    ]);
  });

  it('never takes a shop named anywhere but on the provider’s own site', () => {
    const draft = draftFromAnswer(
      answer({
        resellers: [
          {
            shop: 'Shopmart',
            website: 'https://www.shopmart.example',
            approval: { page: 'resellers-2', quotes: ['Regular price.'] },
            offers: [offer('resellers-2', 'StreamCo Standard 12-month card: $199.99')],
          },
        ],
      }),
      resellerContext(),
    );
    expect(draft.provider?.resellers).toBeUndefined();
    expect(draft.issues.map(({ reason }) => reason)).toEqual([
      'Its approval isn’t on the provider’s own site',
    ]);
  });
});

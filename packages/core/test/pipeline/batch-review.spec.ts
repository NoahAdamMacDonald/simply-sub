import { describe, expect, it } from 'vitest';
import { batchIdsIn, batchReview, type BatchProvider } from '../../src';

const claude: BatchProvider = {
  id: 'claude',
  name: 'Claude',
  website: 'https://claude.com',
  status: 'drafted',
  provider: {
    id: 'claude',
    name: 'Claude',
    website: 'https://claude.com',
    category: 'ai',
    spendCategory: 'software',
    cancelUrl: 'https://support.claude.com/cancel',
    plans: [
      {
        id: 'claude.pro',
        name: 'Pro',
        link: 'https://claude.com/pricing',
        features: { 'ai.assistant': true },
        prices: [
          {
            region: 'US',
            currency: 'USD',
            amount: 20,
            interval: 'month',
            intervalCount: 1,
            autoRenew: true,
            lastVerified: '2026-10-28',
            sourceUrl: 'https://claude.com/pricing',
          },
        ],
      },
    ],
  },
  pages: [{ kind: 'pricing', url: 'https://claude.com/pricing' }],
  issues: [
    {
      kind: 'dropped',
      subject: 'Pro, US 17 USD every 1 month',
      reason: 'A sale or first-term price: only the price it renews at is stored',
    },
    { kind: 'warning', subject: 'Claude', reason: 'No cancel page was found' },
  ],
  proposedFeatures: [
    {
      name: 'Projects',
      description: 'true on Pro',
      plans: ['Pro'],
      url: 'https://claude.com/pricing',
      quote: 'Projects to organize chats',
    },
  ],
  evidence: [
    {
      subject: 'Pro, US 20 USD every 1 month',
      url: 'https://claude.com/pricing',
      quote: '$20 if billed monthly',
    },
  ],
  logo: '180×180 PNG (data/logos/claude.png)',
};

describe('batchReview', () => {
  const body = batchReview(
    [
      claude,
      {
        id: 'vk',
        name: 'VK',
        website: 'https://vk.ru',
        status: 'out-of-scope',
        note: 'A social network | not a subscription',
        pages: [],
        issues: [],
        proposedFeatures: [],
        evidence: [],
      },
    ],
    { date: '2026-10-28', extractor: 'Workers AI' },
  );

  it('opens with what the batch is, and a row per drafted provider', () => {
    expect(body).toMatch(
      /^A batch of the discovery pipeline \(BLUEPRINT §6\.5\), read on 2026-10-28 and extracted by Workers AI\./,
    );
    expect(body).toContain('| **Claude** | 1 | Pro 20 USD a month (US) | 1 | 1 | 1 |');
  });

  it('links each price to its page at its quote', () => {
    expect(body).toContain(
      '- **Pro:** [20 USD a month (US)](https://claude.com/pricing#:~:text=%2420%20if%20billed%20monthly). ai.assistant: true',
    );
  });

  it('lists the proposed features, what was dropped and what to check', () => {
    expect(body).toContain('  - Projects: true on Pro, “Projects to organize chats”');
    expect(body).toContain(
      '- **Dropped:**\n  - Pro, US 17 USD every 1 month: A sale or first-term price',
    );
    expect(body).toContain('- **To check:**\n  - Claude: No cancel page was found');
  });

  it('lists the services left out, with why, and hides the batch’s ids for the next one', () => {
    expect(body).toContain(
      '- **VK** (https://vk.ru): not a personal or family subscription: A social network \\| not a subscription',
    );
    expect(batchIdsIn(body)).toEqual(['claude', 'vk']);
  });
});

describe('batchIdsIn', () => {
  it('reads nothing from a body without the line', () => {
    expect(batchIdsIn('A pull request.')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { reviewOutcome, reviewRequest, type PolicyTopic, type ReviewItem } from '../../src';

// The free model's review (M3.10): it proposes only what the page's own words show, checked word for word.

const page = [
  'Choose the plan that’s right for you.',
  'Standard: $19.99 / month',
  'Premium: $26.99 / month',
  'Prices may include taxes depending on your province.',
].join('\n');

const price: ReviewItem = {
  kind: 'price',
  label: 'Netflix Standard (CA in CAD, monthly)',
  amount: 18.99,
  currency: 'CAD',
  text: page,
};

const refunds: PolicyTopic = {
  id: 'billing.refunds',
  name: 'Refunds',
  group: 'billing',
  question: 'Whether you get money back for time you paid for and didn’t use.',
  tiers: {
    great: 'A prorated or full refund on request.',
    good: 'A refund within a stated window.',
    neutral: 'Refunds only where the law requires them.',
    poor: 'Refunds only in narrow cases.',
    bad: 'No refunds.',
  },
};

const policy: ReviewItem = {
  kind: 'policy',
  label: 'netflix’s policies',
  topic: refunds,
  tier: 'neutral',
  quotes: ['Payments are nonrefundable.'],
  text: 'Payments are nonrefundable and there are no refunds or credits for partially used periods.',
};

describe('reviewRequest', () => {
  it('asks about the one fact, with its rubric and the page’s text', () => {
    const { system, user } = reviewRequest(policy);
    expect(system).toContain('copied exactly in "quotes"');
    expect(user).toContain('"neutral" on "Refunds"');
    expect(user).toContain('bad: No refunds.');
    expect(user).toContain('“Payments are nonrefundable.”');
    expect(user).toContain(`Page text:\n${policy.text}`);
  });

  it('keeps the page’s text within the limit', () => {
    expect(reviewRequest({ ...price, text: 'x'.repeat(50) }, 10).user).toMatch(/\nx{10}$/);
  });
});

describe('reviewOutcome', () => {
  const answer = (value: object) => ({ response: value });

  it('takes a price its quote shows, from an object or JSON text', () => {
    const update = {
      decision: 'update',
      amount: 19.99,
      currency: 'CAD',
      quotes: ['Standard: $19.99 / month'],
    };
    expect(reviewOutcome(price, answer(update))).toEqual({
      kind: 'price',
      amount: 19.99,
      quotes: ['Standard: $19.99 / month'],
    });
    expect(reviewOutcome(price, `Here it is: ${JSON.stringify(update)}`)).toMatchObject({
      kind: 'price',
      amount: 19.99,
    });
  });

  it('uses the page’s own words for a quote that differs only in spacing or quote marks', () => {
    const outcome = reviewOutcome(
      price,
      answer({ decision: 'update', amount: 19.99, quotes: ['Standard:  $19.99 / month'] }),
    );
    expect(outcome).toMatchObject({ kind: 'price', quotes: ['Standard: $19.99 / month'] });
  });

  it('labels anything its quotes don’t show as unsure', () => {
    // A quote that isn't on the page.
    expect(
      reviewOutcome(
        price,
        answer({ decision: 'update', amount: 21.99, quotes: ['Standard: $21.99 / month'] }),
      ),
    ).toEqual({ kind: 'unsure', why: 'None of its quotes is on the page word for word' });
    // A quote on the page, but not of the price it read.
    expect(
      reviewOutcome(
        price,
        answer({ decision: 'update', amount: 21.99, quotes: ['Premium: $26.99 / month'] }),
      ),
    ).toEqual({ kind: 'unsure', why: 'Its quotes don’t show the price it read' });
    // Another currency.
    expect(
      reviewOutcome(
        price,
        answer({
          decision: 'update',
          amount: 19.99,
          currency: 'USD',
          quotes: ['Standard: $19.99 / month'],
        }),
      ),
    ).toEqual({ kind: 'unsure', why: 'It read USD, not CAD' });
    // A price kept that its quotes don't show.
    expect(
      reviewOutcome(price, answer({ decision: 'keep', quotes: ['Standard: $19.99 / month'] })),
    ).toEqual({
      kind: 'unsure',
      why: 'Its quotes don’t show the catalog’s price',
    });
  });

  it('passes on the model’s own doubt, and an answer it can’t read', () => {
    expect(
      reviewOutcome(price, answer({ decision: 'unsure', reason: 'Two prices for Standard' })),
    ).toEqual({
      kind: 'unsure',
      why: 'Two prices for Standard',
    });
    expect(reviewOutcome(price, 'no JSON here')).toMatchObject({ kind: 'unsure' });
    expect(reviewOutcome(price, answer({ decision: 'maybe' }))).toEqual({
      kind: 'unsure',
      why: 'The model’s answer didn’t match its shape',
    });
  });

  it('keeps a price its quote still shows', () => {
    const kept = reviewOutcome(
      { ...price, amount: 19.99 },
      answer({ decision: 'keep', quotes: ['Standard: $19.99 / month'] }),
    );
    expect(kept).toEqual({ kind: 'kept', quotes: ['Standard: $19.99 / month'] });
  });

  it('suggests a grade with a short plain reason and quotes on the page', () => {
    const grade = {
      decision: 'update',
      tier: 'bad',
      reason: 'No refunds, even for unused time.',
      quotes: ['there are no refunds or credits for partially used periods'],
    };
    expect(reviewOutcome(policy, answer(grade))).toEqual({
      kind: 'grade',
      tier: 'bad',
      reason: 'No refunds, even for unused time.',
      quotes: ['there are no refunds or credits for partially used periods'],
    });
    expect(reviewOutcome(policy, answer({ ...grade, reason: 'x'.repeat(241) }))).toMatchObject({
      kind: 'unsure',
    });
    expect(reviewOutcome(policy, answer({ ...grade, tier: null }))).toMatchObject({
      kind: 'unsure',
    });
    expect(
      reviewOutcome(policy, answer({ decision: 'keep', quotes: ['Payments are nonrefundable'] })),
    ).toEqual({
      kind: 'kept',
      quotes: ['Payments are nonrefundable'],
    });
  });
});

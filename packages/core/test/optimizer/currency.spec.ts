import { describe, expect, it } from 'vitest';
import {
  optimize,
  resolveItem,
  suggestionEdits,
  type CatalogData,
  type ListItem,
  type OptimizerResult,
  type PaymentCard,
  type Price,
  type ResolvedItem,
} from '../../src';
import { catalog, cards, item, today } from './fixtures';

// The optimizer's 8th change (BLUEPRINT §10.3, M9.6): paying in another currency the seller prices the plan in for the
// buyer, on the card it's paid with. Vault sells its plan in CAD, USD and EUR wherever it sells (GLOBAL), like Proton;
// Stream prices by country (CAD in Canada, USD in the US), so its US price is out of a Canadian's reach. Alberta's 5% GST.

const stamps = { createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-20T09:15:00.000Z' };
const noFxFee: PaymentCard = {
  id: '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d3e',
  name: 'No FX Mastercard',
  type: 'credit',
  network: 'mastercard',
  currency: 'CAD',
  cashbackPercent: 1,
  fxFeePercent: 0,
  ...stamps,
};
const withFxFee: PaymentCard = {
  ...noFxFee,
  id: '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d43',
  name: 'Everyday Visa',
  network: 'visa',
  fxFeePercent: 2.5,
};

/** 1 USD is 1.3889 CAD and 1 EUR 1.5625 CAD. */
const fx = { base: 'CAD', date: '2026-10-27', source: 'ECB', rates: { EUR: 0.64, USD: 0.72 } };

function price(amount: number, currency: string, extra: Partial<Price> = {}): Price {
  return {
    region: 'GLOBAL',
    currency,
    amount,
    interval: 'month',
    intervalCount: 1,
    autoRenew: true,
    lastVerified: '2026-10-01',
    ...extra,
  };
}

const priced: CatalogData = {
  ...catalog,
  providers: [
    ...catalog.providers,
    {
      id: 'vault',
      name: 'Vault',
      website: 'https://vault.example.com',
      category: 'vpn',
      spendCategory: 'software',
      cancelUrl: 'https://vault.example.com/cancel',
      billingCurrency: { GLOBAL: 'USD' },
      plans: [
        {
          id: 'vault.plus',
          name: 'Plus',
          link: 'https://vault.example.com/plus',
          features: { 'vpn.included': true },
          prices: [price(13.99, 'CAD'), price(9.99, 'USD'), price(9.99, 'EUR')],
        },
        {
          id: 'vault.max',
          name: 'Max',
          link: 'https://vault.example.com/max',
          features: { 'vpn.included': true, 'vpn.multi-hop': true },
          prices: [
            price(19.99, 'CAD'),
            price(14.99, 'USD'),
            price(199.99, 'CAD', { interval: 'year' }),
            price(119.99, 'USD', { interval: 'year' }),
          ],
        },
      ],
    },
    {
      id: 'stream',
      name: 'Stream',
      website: 'https://stream.example.com',
      category: 'streaming',
      spendCategory: 'streaming',
      cancelUrl: 'https://stream.example.com/cancel',
      billingCurrency: { CA: 'CAD', US: 'USD' },
      plans: [
        {
          id: 'stream.basic',
          name: 'Basic',
          link: 'https://stream.example.com/basic',
          features: { 'streaming.ad-free': true },
          prices: [price(13.99, 'CAD', { region: 'CA' }), price(7.99, 'USD', { region: 'US' })],
        },
      ],
    },
  ],
};

const context = {
  today,
  country: 'CA',
  currency: 'CAD',
  fx,
  place: { country: 'CA', subdivision: 'CA-AB' },
  profileRanks: new Map(),
};

function resolveAll(items: readonly ListItem[]): ResolvedItem[] {
  return items.map((listItem) => {
    const resolution = resolveItem(listItem, {
      catalog: priced,
      customSubs: new Map(),
      ...context,
      taxPlace: context.place,
    });
    if (!resolution.ok) throw new Error(`${listItem.id}: ${resolution.unresolved.reason}`);
    return resolution.resolved;
  });
}

function run(items: readonly ListItem[], paymentCards = [noFxFee, withFxFee]): OptimizerResult {
  return optimize({
    items: resolveAll(items),
    catalogs: new Map([['CA', priced]]),
    context,
    cards: paymentCards,
  });
}

function byCurrency(result: OptimizerResult) {
  return result.suggestions.filter((suggestion) => suggestion.actions[0].kind === 'currency');
}

/** Vault Plus's next 12 months in Alberta, on a card with 1% cash back: 12 charges with 5% GST. */
const inCad = 12 * 13.99 * 1.05 * 0.99;
const inUsd = 12 * (9.99 / 0.72) * 1.05 * 0.99;

describe('optimize: another currency', () => {
  it('is a free saving on a card with no FX fee, paid in the cheapest currency from the next charge', () => {
    const plus = item('vault.plus', {}, { cardId: noFxFee.id });
    const result = run([plus]);
    expect(cards(result)).toEqual(['free | Pay for Vault Plus in USD | save 1.43 | estimated']);
    const [suggestion] = result.suggestions;
    expect(suggestion.savings).toBeCloseTo(inCad - inUsd);
    expect(suggestion.actions).toEqual([
      {
        kind: 'currency',
        item: expect.objectContaining({ itemId: plus.id, title: 'Vault Plus' }),
        to: expect.objectContaining({
          amount: 9.99 / 0.72,
          currency: 'CAD',
          source: { region: 'CA', amount: 9.99, currency: 'USD' },
        }),
        on: '2026-11-10',
        cardTitle: 'No FX Mastercard',
      },
    ]);
    // "Save up to" counts it: the best plan keeps the item.
    expect(result.bestSavings).toBeCloseTo(inCad - inUsd);
  });

  it('isn’t one when the card’s FX fee costs more than the price list saves', () => {
    expect(byCurrency(run([item('vault.plus', {}, { cardId: withFxFee.id })]))).toEqual([]);
  });

  it('needs the card the item is paid with', () => {
    expect(byCurrency(run([item('vault.plus')], []))).toEqual([]);
    // With cards but none on the item, a better card comes first.
    expect(byCurrency(run([item('vault.plus')]))).toEqual([]);
  });

  it('never takes another country’s price, which is set by where the buyer is', () => {
    expect(byCurrency(run([item('stream.basic', {}, { cardId: noFxFee.id })]))).toEqual([]);
  });

  it('leaves an own price alone, but not one that has ended', () => {
    const own = { amount: 12.99, currency: 'CAD' };
    expect(
      byCurrency(run([item('vault.plus', {}, { cardId: noFxFee.id, priceOverride: own })])),
    ).toEqual([]);
    const ended = item(
      'vault.plus',
      {},
      { cardId: noFxFee.id, priceOverride: { ...own, until: '2026-10-01' } },
    );
    expect(byCurrency(run([ended]))).toHaveLength(1);
  });

  it('waits for another free change to the item: annual billing first', () => {
    const max = item('vault.max', {}, { cardId: noFxFee.id });
    expect(cards(run([max])).filter((line) => line.startsWith('free'))).toEqual([
      'free | Switch Vault Max to annual billing | save 41.88',
    ]);
  });

  it('applies as the user’s own price in that currency from the next charge, plus tax', () => {
    const plus = item('vault.plus', {}, { cardId: noFxFee.id });
    const [suggestion] = byCurrency(run([plus]));
    expect(suggestionEdits(suggestion, new Map([[plus.id, plus]]))).toEqual([
      {
        kind: 'change',
        itemId: plus.id,
        changes: {
          source: plus.source,
          billing: plus.billing,
          priceOverride: { amount: 9.99, currency: 'USD', since: '2026-11-10', plusTax: true },
        },
      },
    ]);
    // Once applied, the item is paid as suggested, and nothing more is suggested for it.
    const applied: ListItem = {
      ...plus,
      priceOverride: { amount: 9.99, currency: 'USD', since: '2026-11-10', plusTax: true },
    };
    const [resolved] = resolveAll([applied]);
    expect(resolved.override).toBeUndefined();
    expect(resolved.nextCharge).toMatchObject({ date: '2026-11-10', charged: { currency: 'USD' } });
    expect(resolved.nextCharge?.charged.amount).toBeCloseTo(9.99 * 1.05);
    expect(byCurrency(run([applied]))).toEqual([]);
  });

  it('gives a new fingerprint once the item’s card changes', () => {
    const plus = item('vault.plus', {}, { cardId: noFxFee.id });
    const usd = { ...noFxFee, id: '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d50', currency: 'USD' };
    const [first] = byCurrency(run([plus]));
    const [again] = byCurrency(run([plus]));
    const [onUsd] = byCurrency(run([{ ...plus, cardId: usd.id }], [noFxFee, usd]));
    expect(again.fingerprint).toBe(first.fingerprint);
    expect(onUsd.fingerprint).not.toBe(first.fingerprint);
  });
});

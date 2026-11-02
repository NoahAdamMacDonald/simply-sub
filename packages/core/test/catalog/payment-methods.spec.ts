import { describe, expect, it } from 'vitest';
import {
  formatCatalogIssue,
  namesPaymentMethod,
  paymentMethodsIn,
  paymentMethodsSchema,
  validateCatalog,
  type CatalogSourceFile,
  type PaymentMethods,
} from '../../src';
import { catalogWith, today } from './catalog-files';
import { issues } from './helpers';

// How a provider can be paid (M11.5, pulled forward at the owner's request on 2026-11-02): every provider says, quoted
// from its own pages, so cash, crypto and gift cards aren't missed.

const mullvad = 'data/providers/mullvad.yaml';

const everywhere = {
  methods: ['card', 'paypal', 'cash', 'crypto'],
  page: 'Payment methods',
  url: 'https://mullvad.net/en/help/payment-methods',
  quotes: ['Credit card', 'PayPal', 'Cash', 'Bitcoin'],
} satisfies PaymentMethods[number];

function messages(files: readonly CatalogSourceFile[]): string[] {
  return validateCatalog(files, today).map(
    (issue) => `${issue.severity === 'warning' ? 'warning: ' : ''}${formatCatalogIssue(issue)}`,
  );
}

describe('paymentMethodsSchema', () => {
  it('accepts a page whose quotes name each method', () => {
    expect(issues(paymentMethodsSchema, [everywhere])).toEqual([]);
  });

  it('needs a quote naming each method, and a gift card is no card', () => {
    const giftOnly = { ...everywhere, methods: ['card', 'gift-card'], quotes: ['Gift cards'] };
    expect(issues(paymentMethodsSchema, [giftOnly])).toEqual([
      "0.methods.0: No quote names Card: quote the page's words for it",
    ]);
  });

  it('has one entry for everywhere, and each region in one entry', () => {
    const ca = { ...everywhere, regions: ['CA'] };
    expect(issues(paymentMethodsSchema, [everywhere, everywhere])).toEqual([
      '1.regions: Only one entry is for everywhere: give this one its regions',
    ]);
    expect(issues(paymentMethodsSchema, [everywhere, ca, ca])).toEqual([
      '2.regions.0: "CA" is listed more than once',
    ]);
  });
});

describe('namesPaymentMethod', () => {
  it.each([
    ['Credit or debit card', 'card', true],
    ['Carte de crédit', 'card', true],
    ['Netflix gift cards', 'card', false],
    ['Netflix gift cards', 'gift-card', true],
    ['Cartes-cadeaux Netflix', 'gift-card', true],
    ['Pay with Monero', 'crypto', true],
    ['Cash in an envelope', 'cash', true],
    ['Billed by your TV provider', 'provider-billing', true],
    ['Apple App Store', 'app-store', true],
    ['Bank wire', 'bank-transfer', true],
  ] as const)('reads "%s" as %s: %s', (text, method, named) => {
    expect(namesPaymentMethod(text, method)).toBe(named);
  });
});

describe('validateCatalog, for payment methods', () => {
  it('needs every provider to say how it can be paid', () => {
    expect(messages(catalogWith(mullvad, ['paymentMethods'], undefined))).toEqual([
      `${mullvad}: Say how it can be paid: its own page on payment methods, quoted (paymentMethods), cash and crypto included`,
    ]);
  });

  it('takes the page from its own sites, its policies’ or its owner’s', () => {
    const elsewhere = { ...everywhere, url: 'https://www.reddit.com/r/mullvadvpn/payment' };
    expect(messages(catalogWith(mullvad, ['paymentMethods'], [elsewhere]))).toEqual([
      `${mullvad} paymentMethods.0.url: Must be a page of Mullvad VPN's own sites, its policies' or its owner's (mullvad.net)`,
    ]);
  });

  it('needs real regions', () => {
    const uk = { ...everywhere, regions: ['UK'] };
    expect(messages(catalogWith(mullvad, ['paymentMethods'], [everywhere, uk]))).toEqual([
      `${mullvad} paymentMethods.1.regions.0: "UK" isn't an ISO 3166-1 region code: use GB for the United Kingdom`,
    ]);
  });
});

describe('paymentMethodsIn', () => {
  const ca = {
    ...everywhere,
    methods: ['card', 'gift-card'],
    quotes: ['card', 'gift card'],
    regions: ['CA'],
  };
  const eu = { ...everywhere, methods: ['bank-transfer'], quotes: ['SEPA'], regions: ['EU'] };
  const provider = { paymentMethods: [everywhere, ca, eu] satisfies PaymentMethods };

  it('picks the region’s own entry, then its group’s, then the one for everywhere', () => {
    expect(paymentMethodsIn(provider, 'CA')?.methods).toEqual(['card', 'gift-card']);
    expect(paymentMethodsIn(provider, 'FR')?.methods).toEqual(['bank-transfer']);
    expect(paymentMethodsIn(provider, 'US')?.methods).toEqual(['card', 'paypal', 'cash', 'crypto']);
    expect(paymentMethodsIn({}, 'US')).toBeUndefined();
  });
});

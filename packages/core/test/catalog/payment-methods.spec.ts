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

  it('takes several pages for the same place, which add up (the owner’s tasks, 2026-11-03)', () => {
    const gifts = { ...everywhere, methods: ['gift-card'], quotes: ['Gift cards'] };
    const ca = { ...everywhere, regions: ['CA'] };
    expect(issues(paymentMethodsSchema, [everywhere, gifts, ca, ca])).toEqual([]);
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
    // The ways the 13's own pages wrote on 2026-11-03 (the owner's tasks).
    ['Klarna', 'klarna', true],
    ['Mobile Wallets: Satispay', 'satispay', true],
    ['Apple Pay, Cash App, PayPal', 'cash-app', true],
    ['Apple Pay, Cash App, PayPal', 'cash', false],
    ['Swish, Eps transfer, Bancontact, iDEAL | Wero, and Przelewy24', 'bank-transfer', true],
    ['GoCardless (Direct Debit)', 'bank-transfer', true],
    [
      'credit card, debit card, bank account, PayPal account, or mobile phone',
      'bank-transfer',
      true,
    ],
    [
      'credit card, debit card, bank account, PayPal account, or mobile phone',
      'provider-billing',
      true,
    ],
    ['mobile operator billing as a payment method', 'provider-billing', true],
    ['You will be billed by your mobility provider.', 'provider-billing', true],
    ['Where do I get support for a Bell-billed TSN subscription?', 'provider-billing', true],
    ['Où obtenir du soutien pour un abonnement facturé par Bell ?', 'provider-billing', true],
    ['through Amazon Prime Video as an add-on channel', 'app-store', true],
    ['Apple App Store, Google Play Store and Roku Channel Store', 'app-store', true],
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
  } satisfies PaymentMethods[number];
  const eu = {
    ...everywhere,
    methods: ['bank-transfer'],
    quotes: ['SEPA'],
    regions: ['EU'],
  } satisfies PaymentMethods[number];
  const provider = { paymentMethods: [everywhere, ca, eu] satisfies PaymentMethods };

  const methodsIn = (where: Parameters<typeof paymentMethodsIn>[0], region: string) =>
    paymentMethodsIn(where, region).map((entry) => entry.methods);

  it('picks the region’s own entries, then its group’s, then the ones for everywhere', () => {
    expect(methodsIn(provider, 'CA')).toEqual([['card', 'gift-card']]);
    expect(methodsIn(provider, 'FR')).toEqual([['bank-transfer']]);
    expect(methodsIn(provider, 'US')).toEqual([['card', 'paypal', 'cash', 'crypto']]);
    expect(paymentMethodsIn({}, 'US')).toEqual([]);
  });

  it('adds up the pages for the same place, in the file’s order (the owner’s tasks, 2026-11-03)', () => {
    const gifts = {
      ...everywhere,
      methods: ['gift-card'],
      quotes: ['Gift cards'],
    } satisfies PaymentMethods[number];
    const mobile = {
      ...ca,
      methods: ['provider-billing'],
      quotes: ['mobile operator billing'],
    } satisfies PaymentMethods[number];
    const added = { paymentMethods: [everywhere, ca, gifts, eu, mobile] satisfies PaymentMethods };
    expect(methodsIn(added, 'US')).toEqual([['card', 'paypal', 'cash', 'crypto'], ['gift-card']]);
    expect(methodsIn(added, 'CA')).toEqual([['card', 'gift-card'], ['provider-billing']]);
  });
});

import type { PaymentMethod, PaymentMethods, Provider } from './provider';
import { globalRegion, groupsOf } from './regions';

// The ways a provider can be paid (M11.5, pulled forward on 2026-11-02 at the owner's request): their names, how a
// provider's page writes them, so validation can check that an entry's quotes name each method, and the ones a buyer
// in a region can use. This file imports no Zod, so the card can use it without loading the schemas.

/** Each method's name, as the card lists it. */
export const paymentMethodNames: Readonly<Record<PaymentMethod, string>> = {
  card: 'Card',
  paypal: 'PayPal',
  'apple-pay': 'Apple Pay',
  'google-pay': 'Google Pay',
  'app-store': 'App store billing',
  'gift-card': 'Gift card',
  'bank-transfer': 'Bank transfer',
  cash: 'Cash',
  crypto: 'Cryptocurrency',
  'provider-billing': 'Your TV, internet or phone bill',
  other: 'Other',
};

/** The methods in the card's order: paymentMethodNames', with no schema to load. */
export const paymentMethods = Object.keys(paymentMethodNames) as PaymentMethod[];

/**
 * How a page writes each method, in English and French. A gift card isn't a card payment, so "card" alone must not
 * follow "gift". `other` stands for any method not listed, so no page names it.
 */
const writtenAs: Readonly<Record<Exclude<PaymentMethod, 'other'>, RegExp>> = {
  card: /(?<!gift\s)\bcards?\b|\bcartes?\s+(?:de\s+)?(?:cr[ée]dit|d[ée]bit)|\bvisa\b|\bmaster\s?card\b|\bamerican\s+express\b|\bamex\b/i,
  paypal: /\bpay\s?pal\b/i,
  'apple-pay': /\bapple\s+pay\b/i,
  'google-pay': /\bgoogle\s+pay\b/i,
  'app-store':
    /\bapp\s?store\b|\bgoogle\s+play\b|\bin-app\b|\bitunes\b|\bplay\s+store\b|\bamazon\s+appstore\b/i,
  'gift-card': /\bgift\s?cards?\b|\bcartes?[- ]cadeaux?\b|\bvouchers?\b|\bprepaid\s+cards?\b/i,
  'bank-transfer':
    /\bbank\s+(?:transfer|wire)s?\b|\bwire\s+transfers?\b|\bdirect\s+debit\b|\bsepa\b|\bideal\b|\bvirement\b|\bswish\b/i,
  cash: /\bcash\b|\besp[eè]ces\b/i,
  crypto: /\bcrypto|\bbitcoin\b|\bmonero\b|\bbtc\b|\bxmr\b/i,
  'provider-billing':
    /\b(?:tv|television|internet|mobile|wireless|phone|cable)\s+(?:service\s+)?(?:provider|carrier|bill)s?\b|\bcarrier\s+billing\b|\bfournisseur\b/i,
};

/** Whether `text` names `method`. `other` is never named. */
export function namesPaymentMethod(text: string, method: PaymentMethod): boolean {
  return method !== 'other' && writtenAs[method].test(text);
}

/**
 * How a buyer in `region` can pay `provider`: the entry for the region, else for a group it belongs to (EU), else the
 * entry for everywhere (no `regions`, or GLOBAL). Undefined when its file doesn't say.
 */
export function paymentMethodsIn(
  provider: Pick<Provider, 'paymentMethods'>,
  region: string,
): PaymentMethods[number] | undefined {
  const entries = provider.paymentMethods ?? [];
  for (const where of [region, ...groupsOf(region)]) {
    const found = entries.find((entry) => entry.regions?.includes(where));
    if (found) return found;
  }
  return entries.find((entry) => !entry.regions || entry.regions.includes(globalRegion));
}

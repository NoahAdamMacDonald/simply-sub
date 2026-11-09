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
  klarna: 'Klarna',
  satispay: 'Satispay',
  'cash-app': 'Cash App',
  alipay: 'Alipay',
  'app-store': 'App store or platform billing',
  'gift-card': 'Gift card',
  'bank-transfer': 'Bank transfer or direct debit',
  cash: 'Cash',
  crypto: 'Cryptocurrency',
  'provider-billing': 'Your TV, internet or phone bill',
  other: 'Other',
};

/** The methods in the card's order: paymentMethodNames', with no schema to load. */
export const paymentMethods = Object.keys(paymentMethodNames) as PaymentMethod[];

/**
 * How a page writes each method, in English and French. A gift card isn't a card payment, so "card" alone must not
 * follow "gift", and Cash App isn't cash. `other` stands for any method not listed, so no page names it. A bank's own
 * payments (iDEAL | Wero, Swish, Eps, Bancontact, Przelewy24) and a direct debit (GoCardless) are bank transfers, and
 * an app store includes a platform that bills for the provider (Roku's Channel Store, Amazon's Prime Video channels).
 * A bank debit (ChatGPT's "Bank debit via Link") is a bank transfer too.
 */
const writtenAs: Readonly<Record<Exclude<PaymentMethod, 'other'>, RegExp>> = {
  card: /(?<!gift\s)\bcards?\b|\bcartes?\s+(?:de\s+)?(?:cr[ée]dit|d[ée]bit)|\bvisa\b|\bmaster\s?card\b|\bamerican\s+express\b|\bamex\b/i,
  paypal: /\bpay\s?pal\b/i,
  'apple-pay': /\bapple\s+pay\b/i,
  'google-pay': /\bgoogle\s+pay\b/i,
  klarna: /\bklarna\b/i,
  satispay: /\bsatispay\b/i,
  'cash-app': /\bcash\s?app\b/i,
  alipay: /\bali\s?pay\b/i,
  'app-store':
    /\bapp\s?store\b|\bgoogle\s+play\b|\bin-app\b|\bitunes\b|\bplay\s+store\b|\bamazon\s+appstore\b|\bthird[- ]party\s+billing\b|\bachats?\s+intégrés?|\bchannel\s+store\b|\bamazon\s+prime\b|\bprime\s+video\b/i,
  'gift-card': /\bgift\s?cards?\b|\bcartes?[- ]cadeaux?\b|\bvouchers?\b|\bprepaid\s+cards?\b/i,
  'bank-transfer':
    /\bbank\s+(?:transfer|wire|account)s?\b|\bbank\s+debit\b(?!\s+cards?\b)|\bwire\s+transfers?\b|\bdirect\s+debit\b|\bsepa\b|\bideal\b|\bwero\b|\bvirement\b|\bswish\b|\beps\s+(?:transfer|überweisung)\b|\bbancontact\b|\bprzelewy24\b|\bgocardless\b/i,
  cash: /\bcash\b(?!\s?app\b)|\besp[eè]ces\b/i,
  crypto: /\bcrypto|\bbitcoin\b|\bmonero\b|\bbtc\b|\bxmr\b/i,
  'provider-billing':
    /\b(?:tv|television|internet|mobile|mobility|wireless|phone|cable)\s+(?:service\s+)?(?:provider|carrier|bill)s?\b|\bcarrier\s+billing\b|\bmobile\s+(?:phone|operator)\b|\boperator\s+billing\b|\bfournisseur\b|\badd\s+\w+\s+to\s+(?:their|your)\s+bill\b|\bfactur[ée]e?s?\s+par\s+bell\b|\bbell[- ]billed\b|\bbilled\s+(?:through|by)\s+bell\b/i,
};

/** Whether `text` names `method`. `other` is never named. */
export function namesPaymentMethod(text: string, method: PaymentMethod): boolean {
  return method !== 'other' && writtenAs[method].test(text);
}

/**
 * How a buyer in `region` can pay `provider`: the entries for the region, else for a group it belongs to (EU), else
 * the entries for everywhere (no `regions`, or GLOBAL), in the file's order. Entries for the same place add up: each is
 * one page's list. None when its file doesn't say.
 */
export function paymentMethodsIn(
  provider: Pick<Provider, 'paymentMethods'>,
  region: string,
): PaymentMethods {
  const entries = provider.paymentMethods ?? [];
  for (const where of [region, ...groupsOf(region)]) {
    const found = entries.filter((entry) => entry.regions?.includes(where));
    if (found.length > 0) return found;
  }
  return entries.filter((entry) => !entry.regions || entry.regions.includes(globalRegion));
}

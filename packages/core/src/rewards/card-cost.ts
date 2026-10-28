import { exchangeRate, type FxRates } from '../catalog/convert';
import type { CardNetwork } from '../catalog/provider';
import type { Charged } from '../schedule/charges';
import type { PaymentCard } from '../user/payment-card';

// What a charge costs on a payment card (BLUEPRINT §9.3): the amount charged, tax included, in the card's currency at
// the network's rate; the issuer's FX fee when the charge isn't in the card's currency; and the cash back on the full
// posted amount, as most cards pay it.

/** What a card's maths needs of it. */
export type CardTerms = Pick<
  PaymentCard,
  'network' | 'currency' | 'cashbackPercent' | 'fxFeePercent'
>;

/**
 * How much of `to` the network gives for one `from`: the ECB's rate for every network (§9.3's decision: Visa's API
 * isn't worth its application, and Mastercard's and Amex's aren't public), which is within a fraction of a percent of
 * theirs. The one place to plug in a network's own rates. 1 for the same currency; undefined without a rate.
 */
export function networkRate(
  network: CardNetwork,
  from: string,
  to: string,
  fx: FxRates | undefined,
): number | undefined {
  if (from === to) return 1;
  return fx && exchangeRate(from, to, fx);
}

/** A charge on a card, in the card's currency. */
export interface CardCost {
  /** The charge at the network's rate. */
  inCardCurrency: number;
  /** The issuer's foreign transaction fee: only for a charge in another currency. */
  fxFee: number;
  /** What the statement shows, the charge and its fee: what counts against the card's monthly limit. */
  posted: number;
  /** On the full posted amount, as most cards pay it. */
  cashback: number;
  /** What it costs after cash back: posted − cashback. */
  net: number;
  /** The charge is in another currency, converted at the ECB's rate: an estimate (BLUEPRINT §4.7). */
  converted: boolean;
}

/**
 * `charged` (an amount in the currency the provider charges it in, tax included) on `card`, or undefined for want of a
 * rate. The currency is the item's own (the user's choice for M9): pickPrice's, which a buyer who picks the currency at
 * checkout (Proton) pays in, or a price override's; Mullvad's fixed euros stay euros.
 */
export function cardCost(
  charged: Charged,
  card: CardTerms,
  fx: FxRates | undefined,
): CardCost | undefined {
  const rate = networkRate(card.network, charged.currency, card.currency, fx);
  if (rate === undefined) return undefined;
  const inCardCurrency = charged.amount * rate;
  const converted = charged.currency !== card.currency;
  const fxFee = converted ? (inCardCurrency * card.fxFeePercent) / 100 : 0;
  const posted = inCardCurrency + fxFee;
  const cashback = (posted * card.cashbackPercent) / 100;
  return { inCardCurrency, fxFee, posted, cashback, net: posted - cashback, converted };
}

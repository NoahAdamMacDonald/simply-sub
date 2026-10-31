import { convert, type FxRates } from '../catalog/convert';
import type { IsoDate } from '../dates/iso-date';
import { addMonthsToMonth, monthOf, type IsoMonth } from '../dates/iso-month';
import { itemCharges, type Charge } from '../schedule/charges';
import { next12Range, type MoneyContext } from '../schedule/list-metrics';
import type { ResolvedItem } from '../user/resolved';
import { cardCost, type CardTerms } from './card-cost';

// An item's charges on a card (BLUEPRINT §9.3): its charges from the schedule engine (M7.1), sales tax included, worked
// out on a card. What they come to after its cash back and FX fees over the next 12 months is what a card saves, and
// what's posted to it in each of the 12 calendar months from this one is what its limit is checked against: an annual
// plan counts in the month it's charged.

/** What the card maths needs: today, the user's currency and tax place, and the rates. */
export interface RewardsContext extends MoneyContext {
  fx?: FxRates;
}

/** The 12 calendar months a card's limit is checked in: this one and the next 11. */
export function limitMonths(today: IsoDate): IsoMonth[] {
  const first = monthOf(today);
  return Array.from({ length: 12 }, (_, index) => addMonthsToMonth(first, index));
}

/** An item's charges as the card maths reads them, worked out once. */
export interface ItemLedger {
  resolved: ResolvedItem;
  /** Its charges over the next 12 months, from today (PROJECT-PLAN §3.1): what savings are counted over. */
  next12: Charge[];
  /** Its charges in each of limitMonths, by index. */
  months: Charge[][];
}

export function itemLedger(resolved: ResolvedItem, context: RewardsContext): ItemLedger {
  const months = limitMonths(context.today);
  const next12 = next12Range(context.today);
  // From this month's 1st to a year from today, which is past the 12th month's end.
  const charges = itemCharges(resolved, { from: `${months[0]}-01`, to: next12.to }, context.place);
  const byMonth = months.map((): Charge[] => []);
  for (const charge of charges) {
    const index = months.indexOf(monthOf(charge.date));
    if (index >= 0) byMonth[index].push(charge);
  }
  return {
    resolved,
    next12: charges.filter((charge) => charge.date >= next12.from),
    months: byMonth,
  };
}

/** An item's charges on a card, or with none. */
export interface ItemOnCard {
  /** Over the next 12 months as charged, in the user's currency: what it costs with no card. */
  gross: number;
  /** The same on the card, after its cash back and FX fees, back in the user's currency; the gross with no card. */
  net: number;
  /** What's posted to the card in each of limitMonths, in the card's currency; zeros with no card. */
  posted: number[];
  /** A converted amount is in it, so it's an estimate. */
  converted: boolean;
  /** Charges it couldn't work out, for want of a rate: an item with any can't be compared on cards. */
  leftOut: number;
}

export function itemOnCard(
  ledger: ItemLedger,
  card: CardTerms | undefined,
  context: RewardsContext,
): ItemOnCard {
  let gross = 0;
  let net = 0;
  let converted = false;
  let leftOut = 0;
  for (const charge of ledger.next12) {
    if (charge.currency !== context.currency) {
      leftOut++;
      continue;
    }
    // With no card: its own card's FX fee, which the charge includes (M10.29), is the card's, not the item's.
    const plain = charge.amount - (charge.fxFee ?? 0);
    if (!card) {
      gross += plain;
      net += plain;
      converted ||= charge.converted;
      continue;
    }
    const cost = cardCost(charge.charged, card, context.fx);
    const back = cost && inUserCurrency(cost.net, card.currency, context);
    if (cost === undefined || back === undefined) {
      leftOut++;
      continue;
    }
    gross += plain;
    net += back;
    converted ||= charge.converted || cost.converted || card.currency !== context.currency;
  }
  const posted = ledger.months.map((charges) => {
    if (!card) return 0;
    let sum = 0;
    for (const charge of charges) sum += cardCost(charge.charged, card, context.fx)?.posted ?? 0;
    return sum;
  });
  return { gross, net, posted, converted, leftOut };
}

/** `amount` of `currency` in the user's currency at the ECB's rate, or undefined without one. */
export function inUserCurrency(
  amount: number,
  currency: string,
  context: RewardsContext,
): number | undefined {
  if (currency === context.currency) return amount;
  return context.fx && convert(amount, currency, context.currency, context.fx);
}

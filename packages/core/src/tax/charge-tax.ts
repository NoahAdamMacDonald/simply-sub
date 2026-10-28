import { addedSalesTax, type TaxPlace } from './sales-tax-rate';

// The sales tax on a charge (BLUEPRINT §4.8, M7.1): charges, totals, budgets, the calendar and exports include it,
// since that's what leaves the account. Price tags show the listed price with "+ tax" instead.

/**
 * The sales tax on `amount` of `price` for a buyer at `place`, at full precision: none when the price includes it
 * (a catalog price's `taxIncluded`, Mullvad's; or a typed amount, which includes it unless marked "plus tax"), else
 * the buyer's rate, the built-in one for their province or their own. Use buyerTaxPlace for an item bought in another
 * region.
 */
export function salesTaxOn(
  amount: number,
  price: { taxIncluded?: unknown },
  place: TaxPlace,
): number {
  const rate = addedSalesTax(price, place);
  return rate === undefined ? 0 : (amount * rate.percent) / 100;
}

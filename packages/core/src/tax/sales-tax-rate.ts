// Which sales-tax rate applies to a buyer (BLUEPRINT §4.8). Canadian and US prices are listed before tax, so tax is
// added there; elsewhere prices include VAT or GST already. M7.1 adds the tax to charges and totals.

/** The countries where tax is added to listed prices, and where Settings asks for the province or state. */
export const taxAddedRegions: ReadonlySet<string> = new Set(['CA', 'US']);

/**
 * Each Canadian province's and territory's combined rate on digital subscriptions: GST or HST, plus the provincial
 * tax where it covers streaming and software (BC's PST, Manitoba's RST, Saskatchewan's PST and Quebec's QST, each
 * charged on the price before GST, so the rates add up).
 *
 * Checked on 2026-10-26 against the CRA's GST/HST rate table (modified 2025-04-01, when Nova Scotia's HST went from
 * 15% to 14%) and each province's own pages: BC's PST on telecommunication services (streaming audio and video),
 * Manitoba's RST bulletin 030 (streaming services), and Saskatchewan's PST bulletins (streaming and telecommunication
 * services). A service a province doesn't tax (BC's PST leaves out text-only subscriptions) is the user's own rate.
 * There's no US table: whether subscriptions are taxed varies by state and city.
 */
export const canadianSalesTax: Readonly<Record<string, number>> = {
  'CA-AB': 5,
  'CA-BC': 12,
  'CA-MB': 12,
  'CA-NB': 15,
  'CA-NL': 15,
  'CA-NS': 14,
  'CA-NT': 5,
  'CA-NU': 5,
  'CA-ON': 13,
  'CA-PE': 15,
  'CA-QC': 14.975,
  'CA-SK': 11,
  'CA-YT': 5,
};

/** When canadianSalesTax was last checked against official sources. */
export const canadianSalesTaxCheckedOn = '2026-10-26';

/** Where the buyer is, and the rate they gave: Settings' fields. */
export interface TaxPlace {
  country: string;
  subdivision?: string;
  salesTaxPercent?: number;
}

/** The rate added to listed prices: the user's own, or the built-in one for their province. */
export interface SalesTaxRate {
  percent: number;
  source: 'own' | 'built-in';
}

/**
 * The sales tax added to `place`'s listed prices. Undefined where nothing is added: outside the tax-added countries
 * (where prices include tax, so an own rate is ignored), and in one of them with no rate known (a US state without
 * the user's rate, or Canada without a province).
 */
export function salesTaxRate({
  country,
  subdivision,
  salesTaxPercent,
}: TaxPlace): SalesTaxRate | undefined {
  if (!taxAddedRegions.has(country)) return undefined;
  if (salesTaxPercent !== undefined) return { percent: salesTaxPercent, source: 'own' };
  const builtIn =
    country === 'CA' && subdivision !== undefined && Object.hasOwn(canadianSalesTax, subdivision)
      ? canadianSalesTax[subdivision]
      : undefined;
  return builtIn === undefined ? undefined : { percent: builtIn, source: 'built-in' };
}

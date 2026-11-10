import { comparable } from './page-text';

// A price's taxIncluded quote (BLUEPRINT §4.8, §6.4): the page's own words that say tax is included, which must still
// be there, near no wording that says the opposite. Either change is one for review.

/** Words that say tax is added to a price, which a price that includes tax mustn't have near it. */
const addedTax =
  /\+\s*(?:applicable\s+)?(?:sales\s+)?tax(?:es)?\b|\bplus\s+(?:applicable\s+)?(?:sales\s+)?tax(?:es)?\b|\bexcl(?:\.|uding|usive\s+of)?\s+(?:vat|tax(?:es)?|gst|hst)\b|\btax(?:es)?\s+(?:are\s+|will\s+be\s+)?(?:calculated|added)\s+at\s+checkout\b|\bbefore\s+tax(?:es)?\b|\b(?:vat|tax(?:es)?)\s+not\s+included\b/i;

/** A tax's name in the catalog's languages: sales tax, VAT and GST, TVA, MwSt., BTW, IVA, moms. */
const taxName = String.raw`(?:(?:sales|consumption)\s+)?tax(?:es)?|vat|gst|hst|pst|qst|tva|taxes?|mwst\.?|mehrwertsteuer|ust\.?|umsatzsteuer|btw|iva|impuestos|imposte|tasse|moms`;

/**
 * Words that say a price includes tax, before the tax's name ("Including VAT.", "Inklusive MwSt.", "Inclusief BTW.",
 * "y compris la TVA") or after it ("Sales tax included.", "TVA incluse.", "IVA incluido.", "IVA inclusa.", "moms
 * ingår"), or "TTC". A "not", "non" or "no" between them leaves no match, as in "VAT not included" and "TVA non
 * incluse".
 */
const includedTax = new RegExp(
  String.raw`(?<!\bnon[-\s]?)\b(?:includ(?:es|ing|e)|incl\.?|inclusive\s+of(?:\s+all)?|inklusive|inkl\.?|inclusief|incluant|y\s+compris)\s+(?:(?:all|any|applicable|the|local|de\s+la|la|le|les|die|der)\s+)*(?:${taxName})(?![\p{L}])|\b(?:${taxName})[\s-]*(?:included|incl\.?|inclusive|inclus(?:e|es)?|compris(?:e|es)?|inbegriffen|enthalten|inclusief|incluid[oa]s?|inclus[ao]|compres[ao]|inkluderad|ingår)(?![\p{L}])|\bttc\b|\btoutes\s+taxes\s+comprises\b`,
  'iu',
);

/**
 * Whether a price's `taxIncluded` quote says the price includes tax (BLUEPRINT §4.8): its words name a tax as included,
 * and none say tax is added. A sentence that only says the price is the same everywhere doesn't.
 */
export function saysTaxIncluded(quote: string): boolean {
  return includedTax.test(quote) && !addedTax.test(quote);
}

/**
 * Words that leave tax to be added, beyond `addedTax`'s English: "zzgl. MwSt.", "exkl. MwSt.", "hors taxes", "HT",
 * "exclusief btw", "IVA esclusa", "IVA no incluido", "sin IVA", "+ IVA".
 */
const excludedTax = new RegExp(
  String.raw`\b(?:zzgl\.?|zuzüglich|exkl\.?|exklusive|exclusief|excl\.?|excluding|hors|sin|senza|plus|più|más)\s+(?:${taxName})(?![\p{L}])|\b(?:${taxName})\s+(?:not\s+included|non\s+(?:incluse?|inclus[ao]|compris(?:e|es)?)|nicht\s+(?:enthalten|inbegriffen)|no\s+incluid[oa]s?|esclus[ao]|exclusief|excluded)(?![\p{L}])|\+\s*(?:${taxName})(?![\p{L}])|\bht\b|\bhors\s+taxes?\b`,
  'iu',
);

/** Whether a reseller's `taxExcluded` quote says tax is added to the price (BLUEPRINT §4.9): "Excl. VAT". */
export function saysTaxExcluded(quote: string): boolean {
  return addedTax.test(quote) || excludedTax.test(quote);
}

export type TaxWording =
  { status: 'kept' } | { status: 'quote-gone' } | { status: 'contradicted'; wording: string };

/**
 * Whether the page still says what the quote says (in any quotes and spacing), and near `around` (the price's
 * part of the page, Workers AI's excerpt) nothing says tax is added.
 */
export function taxWording(text: string, quote: string, around: string): TaxWording {
  if (!comparable(text).includes(comparable(quote))) return { status: 'quote-gone' };
  const contrary = addedTax.exec(around);
  return contrary ? { status: 'contradicted', wording: contrary[0] } : { status: 'kept' };
}

/** The quotes a page no longer has, in any quotes and spacing: a reseller's approval (BLUEPRINT §4.9). */
export function missingQuotes(text: string, quotes: readonly string[]): string[] {
  const page = comparable(text);
  return quotes.filter((quote) => !page.includes(comparable(quote)));
}

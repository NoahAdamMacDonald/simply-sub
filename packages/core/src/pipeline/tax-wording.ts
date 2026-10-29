import { comparable } from './page-text';

// A price's taxIncluded quote (BLUEPRINT §4.8, §6.4): the page's own words that say tax is included, which must still
// be there, near no wording that says the opposite. Either change is one for review.

/** Words that say tax is added to a price, which a price that includes tax mustn't have near it. */
const addedTax =
  /\+\s*(?:applicable\s+)?(?:sales\s+)?tax(?:es)?\b|\bplus\s+(?:applicable\s+)?(?:sales\s+)?tax(?:es)?\b|\bexcl(?:\.|uding|usive\s+of)?\s+(?:vat|tax(?:es)?|gst|hst)\b|\btax(?:es)?\s+(?:are\s+|will\s+be\s+)?(?:calculated|added)\s+at\s+checkout\b|\bbefore\s+tax(?:es)?\b|\b(?:vat|tax(?:es)?)\s+not\s+included\b/i;

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

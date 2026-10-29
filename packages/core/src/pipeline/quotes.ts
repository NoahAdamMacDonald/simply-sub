// Quotes the pipeline keeps (BLUEPRINT §6.5 ④, M3.4): every price, feature, card network, country list and policy
// rating it drafts rests on the provider's own words, which must be on the saved page. A quote is found when the page
// has it word for word, white space aside; or when only its quote marks, dashes or capitals differ, and then the page's
// own words are kept, so the nightly check and the card's text-fragment links find them. Anything else is dropped.

/** The page's own words for `quote`, white space collapsed, or undefined when the page doesn't have them. */
export function findQuote(quote: string, text: string): string | undefined {
  const wanted = collapse(quote);
  if (wanted.length < 2) return undefined;
  const page = collapse(text);
  if (page.includes(wanted)) return wanted;
  const loose = looseIndex(page);
  const at = loose.text.indexOf(looseIndex(wanted).text);
  if (at < 0) return undefined;
  const length = looseIndex(wanted).text.length;
  const start = loose.from[at];
  const end = loose.from[at + length - 1] + 1;
  return page.slice(start, end);
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The text in lower case with curly quotes and dashes made plain, as core's `comparable` reads it, and for each of its
 * characters the index it came from, so a match can be cut out of the original.
 */
function looseIndex(text: string): { text: string; from: number[] } {
  let out = '';
  const from: number[] = [];
  for (let index = 0; index < text.length; index++) {
    let character = text[index];
    if ('‘’‛′'.includes(character)) character = "'";
    else if ('“”„″'.includes(character)) character = '"';
    else if ('‐‑‒–—'.includes(character)) character = '-';
    // A capital can lower to two characters (İ): each points back to it.
    // By UTF-16 code unit, as `text` is indexed.
    for (const unit of character.toLowerCase().split('')) {
      out += unit;
      from.push(index);
    }
  }
  return { text: out, from };
}

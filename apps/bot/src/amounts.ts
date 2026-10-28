import { nameIndexes } from './page-text';

// Amounts on a page (BLUEPRINT §6.4): every price-like number, with the currency written beside it, so the check can
// tell that a stored price is still there without asking Workers AI.

/** A price-like number in the text. */
export interface MoneyMention {
  amount: number;
  /** An ISO 4217 code, `dollar` for a bare $, or undefined when no currency is written beside it. */
  currency?: string;
  index: number;
}

/** What's written before an amount, nearest last. */
const before: [RegExp, string][] = [
  [/(?:CA\$|C\$|CAD\s?\$?)$/i, 'CAD'],
  [/(?:US\$|USD\s?\$?)$/i, 'USD'],
  [/(?:A\$|AU\$|AUD)$/i, 'AUD'],
  [/(?:NZ\$|NZD)$/i, 'NZD'],
  [/\$$/, 'dollar'],
  [/(?:€|EUR)$/i, 'EUR'],
  [/(?:£|GBP)$/i, 'GBP'],
  [/(?:CHF|Fr\.)$/i, 'CHF'],
  [/(?:SEK|kr)$/i, 'SEK'],
  [/(?:¥|JPY)$/i, 'JPY'],
];

/** What's written after an amount. */
const after: [RegExp, string][] = [
  [/^(?:\$\s?CAD|CAD|\$ ?CA)\b/i, 'CAD'],
  [/^(?:\$\s?USD|USD)\b/i, 'USD'],
  [/^(?:€|EUR\b)/i, 'EUR'],
  [/^(?:£|GBP\b)/i, 'GBP'],
  [/^(?:CHF)\b/i, 'CHF'],
  [/^(?:kr|SEK)\b/i, 'SEK'],
  [/^\$/, 'dollar'],
];

/**
 * Every amount in the text that has decimals (18.99, 18,99) or a currency beside it (€5, 5 kr): a plain whole
 * number is a device count or a year as often as a price. Thousands may be grouped with commas, dots or spaces.
 */
export function moneyIn(text: string): MoneyMention[] {
  const mentions: MoneyMention[] = [];
  const number = /(?<![\d.,])(\d{1,3}(?:[,. ]\d{3})+|\d+)(?:[.,](\d{1,2}))?(?![\d])/g;
  for (const match of text.matchAll(number)) {
    const [whole, units, cents] = match;
    const index = match.index;
    const ahead = text.slice(Math.max(0, index - 6), index).trimEnd();
    const behind = text.slice(index + whole.length, index + whole.length + 6).trimStart();
    const currency =
      before.find(([pattern]) => pattern.test(ahead))?.[1] ??
      after.find(([pattern]) => pattern.test(behind))?.[1];
    if (cents === undefined && currency === undefined) continue;
    const amount =
      Number(units.replace(/[,. ]/g, '')) + (cents === undefined ? 0 : Number(`0.${cents}`));
    mentions.push({ amount, ...(currency !== undefined && { currency }), index });
  }
  return mentions;
}

/** Whether a currency written on a page can be `wanted`: the same code, a bare $ for a dollar, or none at all. */
export function sameCurrency(written: string | undefined, wanted: string): boolean {
  if (written === undefined || written === wanted) return true;
  return written === 'dollar' && /^(?:CAD|USD|AUD|NZD|SGD|HKD|MXN)$/.test(wanted);
}

/** Whether two amounts are the same to the cent. */
export function sameAmount(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

/**
 * Whether the page still shows `amount` in `currency` for something it names `names`: a mention within `radius`
 * characters of one of the names, or anywhere when the page names none of them (a shop's page for one product).
 */
export function pageShows(
  text: string,
  amount: number,
  currency: string,
  names: readonly string[],
  radius = 500,
): boolean {
  const mentions = moneyIn(text).filter(
    (mention) => sameAmount(mention.amount, amount) && sameCurrency(mention.currency, currency),
  );
  if (mentions.length === 0) return false;
  const named = nameIndexes(text, names);
  if (named.length === 0) return true;
  return mentions.some((mention) =>
    named.some((index) => Math.abs(index - mention.index) <= radius),
  );
}

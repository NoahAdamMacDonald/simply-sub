// A page's words, for finding prices and quotes in (BLUEPRINT §6.4). Regular expressions rather than a parser: a
// Workflow step on the free plan has 10 ms of CPU, and the words are all the check needs.

const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  times: '×',
  reg: '®',
  copy: '©',
  trade: '™',
  laquo: '«',
  raquo: '»',
  lsaquo: '‹',
  rsaquo: '›',
  middot: '·',
  bull: '•',
  deg: '°',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  shy: '',
  zwj: '',
  zwnj: '',
};

/** The most of a page read: pricing pages are well under this, and a bigger one is mostly scripts. */
export const maxPageChars = 1_500_000;

/**
 * The text a page shows: without scripts, styles and comments, tags turned into spaces (block tags into line breaks),
 * entities decoded and white space collapsed.
 */
export function pageText(html: string): string {
  return decode(
    html
      .slice(0, maxPageChars)
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/dt|\/dd)\b[^>]*>/gi, '\n')
      // Inline tags join what they wrap to its neighbours ("<b>Standard</b>: $18.99"); others part words.
      .replace(
        /<\/?(?:a|abbr|b|bdi|bdo|cite|code|data|em|i|kbd|mark|q|s|small|span|strong|sub|sup|time|u)\b[^>]*>/gi,
        '',
      )
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/[ \t\f\v\u00a0\u2009\u202f]+/g, ' ')
    .replace(/ ?\n[\s]*/g, '\n')
    .trim();
}

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : whole;
    }
    return entities[name.toLowerCase()] ?? whole;
  });
}

/**
 * Text for comparing words: lower case, curly quotes and dashes made plain, white space collapsed, none before
 * punctuation. A quote found in a page matches whatever quotes and spaces the page uses.
 */
export function comparable(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/ ([.,;:!?)\]])/g, '$1')
    .trim();
}

/** Where each name appears in the text, by character index, ignoring case. */
export function nameIndexes(text: string, names: readonly string[]): number[] {
  const lower = text.toLowerCase();
  const found: number[] = [];
  for (const name of names) {
    const wanted = name.toLowerCase().trim();
    if (wanted === '') continue;
    for (let at = lower.indexOf(wanted); at >= 0; at = lower.indexOf(wanted, at + wanted.length)) {
      found.push(at);
    }
  }
  return found.sort((a, b) => a - b);
}

/**
 * The parts of a page around `indexes`, `radius` characters each side, merged where they meet, at most `limit`
 * characters in all: what Workers AI reads instead of the whole page.
 */
export function excerpt(
  text: string,
  indexes: readonly number[],
  radius = 700,
  limit = 12_000,
): string {
  const ranges: [number, number][] = [];
  for (const index of indexes) {
    const from = Math.max(0, index - radius);
    const to = Math.min(text.length, index + radius);
    const last = ranges.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else ranges.push([from, to]);
  }
  let total = 0;
  const parts: string[] = [];
  for (const [from, to] of ranges) {
    const part = text.slice(from, Math.min(to, from + limit - total));
    parts.push(part);
    total += part.length;
    if (total >= limit) break;
  }
  return parts.join('\n…\n');
}

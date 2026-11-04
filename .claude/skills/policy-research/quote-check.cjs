// Checks every policy quote in data/providers/*.yaml and data/policies/*.yaml against the text saved from its page (SKILL.md, step 4),
// and the quotes of each provider's facts whose page is saved too: its owner, ways to pay, currencies, renewal day,
// source code and accepted cards (M11.5).
// Usage: node quote-check.cjs <repo root> <pages.json> [facts], where pages.json maps each quoted URL to its saved text
// file (paths relative to pages.json). Prints each quote that isn't on its page word for word, with the page's own
// wording when only quotes, dashes or spaces differ, and exits non-zero if any is wrong. A policy quote needs its page
// saved; a fact's page that isn't saved is skipped and counted. With `facts`, only the facts are checked.
const fs = require('fs');
const path = require('path');

const [repo, index, only] = process.argv.slice(2);
if (!repo || !index || (only !== undefined && only !== 'facts')) {
  console.error('Usage: node quote-check.cjs <repo root> <pages.json> [facts]');
  process.exit(2);
}
const YAML = require(path.join(path.resolve(repo), 'node_modules', 'yaml'));
const pages = JSON.parse(fs.readFileSync(index, 'utf8'));

const spaced = (text) => text.replace(/[\s\u00a0\u200b]+/g, ' ').trim();
const loose = (text) =>
  spaced(text)
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-');

/** The span of `text` that reads as `quote` once quotes, dashes and spaces are ignored, if there is one. */
function lookalike(text, quote) {
  const target = loose(quote);
  for (let start = 0; start < text.length; start++) {
    if (!loose(text.slice(start, start + target.length + 20)).startsWith(target.slice(0, 20)))
      continue;
    for (let end = start + Math.max(1, target.length - 10); end <= text.length; end++) {
      const candidate = loose(text.slice(start, end));
      if (candidate === target) return text.slice(start, end);
      if (candidate.length > target.length) break;
    }
  }
  return undefined;
}

let checked = 0;
let wrong = 0;
let skipped = 0;
const texts = new Map();

/** The saved text of `url`'s page, read once, or undefined when pages.json doesn't name it. */
function textOf(url) {
  const saved = pages[url];
  if (!saved) return undefined;
  if (!texts.has(saved)) {
    texts.set(saved, spaced(fs.readFileSync(path.resolve(path.dirname(index), saved), 'utf8')));
  }
  return texts.get(saved);
}

/** Checks one quote on its page's saved text, and says where it isn't word for word. */
function check(label, url, quote) {
  checked++;
  const text = textOf(url);
  if (text.includes(spaced(quote))) return;
  wrong++;
  console.log(`${label}: not on ${url} word for word: "${quote}"`);
  const near = lookalike(text, quote);
  if (near) console.log(`  the page has: "${near}"`);
}

/** A provider's facts, each with its page and the quotes from it (M11.5). */
function facts(data) {
  const anchor = data.renewalAnchor;
  return [
    data.owner && ['owner', data.owner.page.url, data.owner.quotes],
    data.owner?.country?.page && [
      'owner.country',
      data.owner.country.page.url,
      data.owner.country.quotes ?? [],
    ],
    ...(data.paymentMethods ?? []).map((entry) => ['paymentMethods', entry.url, entry.quotes]),
    ...(data.currencies ?? []).map((entry) => ['currencies', entry.url, entry.quotes]),
    anchor && anchor.kind !== 'not-stated' && ['renewalAnchor', anchor.url, anchor.quotes],
    data.sourceRepo && ['sourceRepo', data.sourceRepo.page.url, data.sourceRepo.quotes],
    ...Object.entries(data.acceptedNetworks ?? {}).map(([region, entry]) => [
      `acceptedNetworks.${region}`,
      entry.url,
      entry.quotes,
    ]),
  ].filter(Boolean);
}

// Providers' ratings, and the shared policy documents' (data/policies/, M11.1). A status quotes nothing.
const files = ['providers', 'policies'].flatMap((folder) => {
  const dir = path.join(repo, 'data', folder);
  return fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .sort()
        .map((file) => ({ file, full: path.join(dir, file), folder }))
    : [];
});
for (const { file, full, folder } of files) {
  const data = YAML.parse(fs.readFileSync(full, 'utf8'));
  const ratings = folder === 'policies' ? data.ratings : data.policies?.ratings;
  for (const rating of only === 'facts' ? [] : (ratings ?? [])) {
    for (const source of rating.sources ?? []) {
      if (!pages[source.url]) {
        checked++;
        wrong++;
        console.log(`${file} ${rating.topic}: no saved text for ${source.url} in ${index}`);
        continue;
      }
      check(`${file} ${rating.topic}`, source.url, source.quote);
    }
  }
  if (folder !== 'providers') continue;
  for (const [field, url, quotes] of facts(data)) {
    if (!pages[url]) {
      skipped += quotes.length;
      continue;
    }
    for (const quote of quotes) check(`${file} ${field}`, url, quote);
  }
}
console.log(
  `${checked} quotes checked, ${wrong} wrong; ${skipped} quotes of provider facts skipped, their pages not saved`,
);
process.exitCode = wrong > 0 ? 1 : 0;

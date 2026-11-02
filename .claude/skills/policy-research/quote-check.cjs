// Checks every policy quote in data/providers/*.yaml and data/policies/*.yaml against the text saved from its page (SKILL.md, step 4).
// Usage: node quote-check.cjs <repo root> <pages.json>, where pages.json maps each quoted URL to its saved text file
// (paths relative to pages.json). Prints each quote that isn't on its page word for word, with the page's own wording
// when only quotes, dashes or spaces differ, and exits non-zero if any is wrong.
const fs = require('fs');
const path = require('path');

const [repo, index] = process.argv.slice(2);
if (!repo || !index) {
  console.error('Usage: node quote-check.cjs <repo root> <pages.json>');
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
const texts = new Map();
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
  for (const rating of ratings ?? []) {
    for (const source of rating.sources ?? []) {
      checked++;
      const saved = pages[source.url];
      if (!saved) {
        wrong++;
        console.log(`${file} ${rating.topic}: no saved text for ${source.url} in ${index}`);
        continue;
      }
      if (!texts.has(saved)) {
        texts.set(saved, spaced(fs.readFileSync(path.resolve(path.dirname(index), saved), 'utf8')));
      }
      const text = texts.get(saved);
      if (text.includes(spaced(source.quote))) continue;
      wrong++;
      console.log(`${file} ${rating.topic}: not on ${source.url} word for word: "${source.quote}"`);
      const near = lookalike(text, source.quote);
      if (near) console.log(`  the page has: "${near}"`);
    }
  }
}
console.log(`${checked} quotes checked, ${wrong} wrong`);
process.exitCode = wrong > 0 ? 1 : 0;

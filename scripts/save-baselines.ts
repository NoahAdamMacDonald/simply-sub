// Saves the baseline of each page the catalog cites (BLUEPRINT §6.4, §6.5, M3.6): its text when its facts were read, in
// data/baselines/<host>/, which the nightly bot compares each page with. Each page is opened once in the browser on
// this machine (robots.txt first, the bot's token in the User-Agent); its HTML as served becomes the baseline when it
// has what the page shows, since the bot reads it with a plain fetch, else its text as shown (the bot then opens it
// with Browser Rendering).
//
//   npm run data:baselines                       every cited page that has no baseline yet
//   npm run data:baselines -- netflix mullvad    these providers' and bundles' pages, saved again
//   npm run data:baselines -- --all              every cited page, saved again
import {
  baselineLines,
  baselinePath,
  citedFacts,
  citedPages,
  missingQuotes,
  pageShows,
  readCatalogSource,
  servedCovers,
  toIsoDate,
  writeBaseline,
  type Baseline,
  type CitedFacts,
} from '@simply-sub/core';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Renderer } from './lib/browser';
import { checkCatalog, countErrors, plural, printIssues } from './lib/catalog-files';
import { absolute, workFile, type PageRecord } from './lib/pipeline-files';
import { PoliteWeb } from './lib/web';

const args = process.argv.slice(2);
const all = args.includes('--all');
const owners = args.filter((arg) => !arg.startsWith('--'));

const { sources, issues } = await checkCatalog();
if (countErrors(issues) > 0) {
  printIssues(issues);
  fail('The catalog has errors: fix them first (npm run data:validate).');
}
const catalog = readCatalogSource(sources);
const pages = citedPages(catalog.providers, catalog.bundles).filter(
  (page) => owners.length === 0 || page.owners.some((owner) => owners.includes(owner)),
);
const today = toIsoDate(new Date());
const renderer = new Renderer(new PoliteWeb());
let saved = 0;
const unread: string[] = [];
/** Pages where a fact the catalog rests on isn't to be seen today: read again before trusting their baseline. */
const unconfirmed: string[] = [];
try {
  for (const page of pages) {
    const path = baselinePath(page.url);
    if (!all && owners.length === 0 && (await exists(path))) continue;
    // A page the pipeline read this run (render-pages) isn't requested again.
    const rendered = (await readPage(page.url, page.owners)) ?? (await renderer.render(page.url));
    if ('error' in rendered) {
      unread.push(`${page.url} (${page.owners.join(', ')}): ${rendered.error}`);
      continue;
    }
    // The bot reads it with a plain fetch only when the HTML as served has what it shows, and every fact the catalog
    // rests on it.
    const facts = citedFacts(catalog.providers, catalog.bundles, page.url);
    const shown = [rendered.renderedText, ...rendered.views.map((view) => view.text)].join('\n');
    const method =
      servedCovers(rendered.servedText, rendered.renderedText) &&
      missing(rendered.servedText, facts).length === 0
        ? 'fetch'
        : 'browser';
    const gone = missing(method === 'fetch' ? rendered.servedText : shown, facts);
    if (gone.length > 0)
      unconfirmed.push(`${page.url} (${page.owners.join(', ')}): ${gone.join('; ')}`);
    const baseline: Baseline = {
      url: page.url,
      method,
      saved: today,
      lines: baselineLines(method === 'fetch' ? rendered.servedText : rendered.renderedText),
    };
    await mkdir(dirname(absolute(path)), { recursive: true });
    await writeFile(absolute(path), writeBaseline(baseline));
    saved++;
    console.log(
      `${path}: ${method}, ${plural(baseline.lines.length, 'line')} (${page.type}, ${page.owners.join(', ')})`,
    );
  }
} finally {
  await renderer.close();
}
for (const line of unread) console.log(`Not read: ${line}`);
for (const line of unconfirmed) console.log(`Not on the page today: ${line}`);
console.log(
  `Saved ${plural(saved, 'baseline')}${unread.length > 0 ? `; ${plural(unread.length, 'page')} couldn't be read, and the bot checks those by their facts alone` : ''}.`,
);

/** The facts a page's text doesn't show: quotes that aren't in it, and prices whose amount isn't near their name. */
function missing(text: string, facts: CitedFacts): string[] {
  const quotes = missingQuotes(text, facts.quotes).map((quote) => `"${quote.slice(0, 60)}"`);
  const prices = facts.prices
    .filter(
      (price) =>
        !pageShows(text, price.amount, price.currency, price.names) &&
        !(
          price.intervalCount > 1 &&
          pageShows(text, price.amount / price.intervalCount, price.currency, price.names)
        ),
    )
    .map((price) => `${price.amount} ${price.currency}`);
  return [...quotes, ...prices];
}

/** The page as render-pages saved it for one of its owners, if it did. */
async function readPage(url: string, owners: readonly string[]): Promise<PageRecord | undefined> {
  for (const owner of owners) {
    const folder = absolute(workFile(owner, 'pages'));
    for (const name of await readdir(folder).catch(() => [] as string[])) {
      if (!name.endsWith('.json')) continue;
      const record = JSON.parse(await readFile(`${folder}/${name}`, 'utf8')) as
        PageRecord | { error: string };
      if (!('error' in record) && (record.url === url || record.finalUrl === url)) return record;
    }
  }
  return undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(absolute(path));
    return true;
  } catch {
    return false;
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

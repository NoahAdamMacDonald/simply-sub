// Renders each provider's pages in the browser for the discovery pipeline (BLUEPRINT §6.5 ③, M3.3): the pages
// find-urls found (.pipeline/<id>/urls.json), and any added with --url, each opened once in the system Edge on this
// machine (Canadian prices, en-CA), after robots.txt allows it. For each it writes .pipeline/<id>/pages/<name>.json
// (its text as shown and as served, each Monthly/Yearly toggle's text, the currencies its prices are in) and
// <name>.jpg, a screenshot, as evidence for the extraction and the pull request.
//
//   npm run data:render -- bitdefender claude                       every page found for these
//   npm run data:render -- claude --kinds pricing                   only these kinds
//   npm run data:render -- claude --url pricing=https://claude.com/pricing/max   another page, as pricing-2
import { moneyIn, pageKinds, type PageKind } from '@simply-sub/core';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Renderer } from './lib/browser';
import { plural } from './lib/catalog-files';
import {
  absolute,
  readJson,
  workFile,
  writeJson,
  type FoundUrls,
  type PageRecord,
} from './lib/pipeline-files';
import { PoliteWeb } from './lib/web';

const args = process.argv.slice(2);
const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const kinds = (value('--kinds')?.split(',') ?? [...pageKinds]) as PageKind[];
const added = args.flatMap((arg, index) => (args[index - 1] === '--url' ? [arg] : []));
const ids = args.filter(
  (arg, index) => !arg.startsWith('--') && !['--kinds', '--url'].includes(args[index - 1] ?? ''),
);
if (ids.length === 0) fail('Name the providers: npm run data:render -- <id> [<id> …]');
if (added.length > 0 && ids.length > 1) fail('--url adds pages to one provider at a time.');

const web = new PoliteWeb();
const renderer = new Renderer(web);
const today = new Date().toISOString().slice(0, 10);
try {
  for (const id of ids) {
    const found = await readJson<FoundUrls>(workFile(id, 'urls.json'));
    const pages: { name: string; kind: PageKind; url: string }[] = [];
    for (const kind of kinds) {
      const page = found?.pages[kind];
      if (page) pages.push({ name: kind, kind, url: page.url });
    }
    for (const entry of added) {
      const [kind, url] = entry.split(/=(.*)/s);
      if (!(pageKinds as readonly string[]).includes(kind) || !url) {
        fail(`--url takes <kind>=<url>, a kind being one of ${pageKinds.join(', ')}`);
      }
      const count = pages.filter((page) => page.kind === kind).length;
      pages.push({
        name: count === 0 ? kind : `${kind}-${count + 1}`,
        kind: kind as PageKind,
        url,
      });
    }
    if (pages.length === 0) {
      console.log(
        `${id}: no pages to read. Run npm run data:urls -- ${id} first, or add one with --url.`,
      );
      continue;
    }
    console.log(`${id}:`);
    for (const page of pages) {
      const screenshot = workFile(id, `pages/${page.name}.jpg`);
      await mkdir(dirname(absolute(screenshot)), { recursive: true });
      const rendered = await renderer.render(page.url, screenshot, absolute, {
        toggles: page.kind === 'pricing' || page.kind === 'bundles',
      });
      if ('error' in rendered) {
        console.log(`  ${page.name.padEnd(10)} ${page.url}: ${rendered.error}`);
        await writeJson(workFile(id, `pages/${page.name}.json`), {
          kind: page.kind,
          url: page.url,
          read: today,
          error: rendered.error,
        });
        continue;
      }
      const record: PageRecord = {
        kind: page.kind,
        read: today,
        ...rendered,
        currencies: currencies([rendered.renderedText, ...rendered.views.map((view) => view.text)]),
      };
      await writeJson(workFile(id, `pages/${page.name}.json`), record);
      const shown = Object.entries(record.currencies)
        .map(([currency, count]) => `${currency} ${count}`)
        .join(', ');
      console.log(
        `  ${page.name.padEnd(10)} ${record.finalUrl}: "${record.title.slice(0, 60)}", ${plural(record.renderedText.length, 'character')}${record.views.length > 0 ? `, ${plural(record.views.length, 'toggle')}` : ''}${shown ? `, prices in ${shown}` : ''}`,
      );
    }
  }
} finally {
  await renderer.close();
}
console.log(
  `\n${plural(web.requested.length, 'request')} outside the browser (robots.txt). Pages in .pipeline/<id>/pages/.`,
);

/** How many prices the texts show in each currency, each mention once. */
function currencies(texts: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const mention of moneyIn(texts.join('\n'))) {
    if (mention.currency) counts[mention.currency] = (counts[mention.currency] ?? 0) + 1;
  }
  return counts;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// Finds each provider's pages for the discovery pipeline (BLUEPRINT §6.5 ②, M3.2): its pricing page, its cancel page,
// its terms of service and privacy policy, its payment methods, and its bundle and official reseller pages, with
// core's findPages: common paths, then sitemaps, then the home page's navigation and footer links, then a web search
// (Tavily, Brave, then SearXNG, within this machine's monthly budget). Writes .pipeline/<id>/urls.json for the
// renderer (npm run data:render) and prints what it found.
//
//   npm run data:urls -- bitdefender claude          these queue entries or catalog providers
//   npm run data:urls -- --next 10                   the next 10 queued services
//   npm run data:urls -- --sample                    the 20-service sample: how often the pricing page is right
//   options: --kinds pricing,terms (only these kinds)   --no-search (no web search)
//            --browser (a page whose plain fetch gets only a script's shell is opened once in the browser, as the
//            nightly bot does with Browser Rendering)
import {
  findPages,
  hostOf,
  nextQueued,
  pageKinds,
  queueFileSchema,
  toIsoDate,
  type FetchedPage,
  type PageKind,
  type ProviderSite,
} from '@simply-sub/core';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { loadCatalogFiles, plural } from './lib/catalog-files';
import { Renderer } from './lib/browser';
import { absolute, readJson, workFile, writeJson, type FoundUrls } from './lib/pipeline-files';
import { localSearchBudgets, webSearch } from './lib/search';
import { urlSample } from './lib/url-sample';
import { PoliteWeb } from './lib/web';

interface Target extends ProviderSite {
  id: string;
  /** The sample's right pricing pages. */
  pricing?: RegExp[];
}

const args = process.argv.slice(2);
const flag = (name: string) => args.indexOf(name);
const kindsArg = flag('--kinds') >= 0 ? args[flag('--kinds') + 1] : undefined;
const kinds = (kindsArg?.split(',') ?? [...pageKinds]) as PageKind[];
for (const kind of kinds) {
  if (!(pageKinds as readonly string[]).includes(kind)) {
    fail(`"${kind}" isn't a kind of page: ${pageKinds.join(', ')}`);
  }
}
const sample = args.includes('--sample');
const search = args.includes('--no-search') ? undefined : webSearch(await localSearchBudgets());
const targets = sample ? urlSample : await targetsFrom(args);
if (targets.length === 0) {
  fail('Name the services (queue or provider ids), or use --next <count> or --sample.');
}
if (!search) {
  console.log(
    'No web search (no TAVILY_API_KEY, BRAVE_API_KEY or SEARXNG_URL in .env, or --no-search): the last step is skipped.',
  );
}

const web = new PoliteWeb();
const renderer = args.includes('--browser') ? new Renderer(web) : undefined;
/** Less text than this is a script's shell (an app that fills itself in), which the browser reads. */
const shellChars = 400;
const io = {
  page: async (url: string): Promise<FetchedPage | { error: string }> => {
    const page = await web.page(url);
    if (!renderer || 'error' in page || page.text.replace(/\s+/g, ' ').length >= shellChars)
      return page;
    const rendered = await renderer.renderForLinks(page.url);
    return 'error' in rendered ? page : rendered;
  },
  file: (url: string) => web.file(url),
  resolve: (href: string, base: string) => web.resolve(href, base),
  ...(search && { search }),
};
let right = 0;
for (const target of targets) {
  const searched = sample ? (['pricing'] as PageKind[]) : kinds;
  const reports = await findPages(target, searched, io);
  // A run for some kinds keeps what an earlier run found for the others.
  const earlier = await readJson<FoundUrls>(workFile(target.id, 'urls.json'));
  const pages: FoundUrls['pages'] = Object.fromEntries(
    Object.entries(earlier?.pages ?? {}).filter(([kind]) => !searched.includes(kind as PageKind)),
  );
  for (const report of reports) {
    if (report.found) {
      pages[report.kind] = { url: report.found.url, via: report.found.via, fit: report.found.fit };
    }
  }
  const found: FoundUrls = {
    id: target.id,
    name: target.name,
    website: target.website,
    ...(target.domains && { domains: [...target.domains] }),
    found: toIsoDate(new Date()),
    pages,
    reports: [
      ...(earlier?.reports ?? []).filter((report) => !searched.includes(report.kind)),
      ...reports,
    ],
  };
  await writeJson(workFile(target.id, 'urls.json'), found);
  if (sample) {
    const url = pages.pricing?.url;
    const ok = url !== undefined && (target.pricing ?? []).some((pattern) => pattern.test(url));
    if (ok) right++;
    console.log(
      `${ok ? 'right' : url ? 'WRONG' : 'NONE '}  ${target.id}: ${url ?? '-'}${pages.pricing ? ` (${pages.pricing.via}, ${pages.pricing.fit})` : ''}`,
    );
    if (!ok) {
      for (const tried of reports[0].tried.slice(0, 8)) {
        console.log(`         ${tried.via} ${tried.url}: ${tried.result}`);
      }
    }
  } else {
    console.log(`${target.id} (${hostOf(target.website)})`);
    for (const report of reports) {
      const page = report.found;
      console.log(
        `  ${report.kind.padEnd(9)} ${page ? `${page.url} (${page.via}${page.fit === 'yes' ? '' : ', needs the browser to confirm'})` : `none: tried ${plural(report.tried.length, 'page')}${report.searched === 'none-left' ? ', no search left this month' : ''}`}`,
      );
    }
  }
}
await renderer?.close();
if (sample) {
  console.log(
    `\n${right} of ${targets.length} right (${Math.round((right / targets.length) * 100)}%), in ${plural(web.requested.length, 'request')}.`,
  );
} else {
  console.log(
    `\n${plural(web.requested.length, 'request')}. Wrote .pipeline/<id>/urls.json for each.`,
  );
}

/** The services named, or the next queued ones. */
async function targetsFrom(list: string[]): Promise<Target[]> {
  const queue = queueFileSchema.parse(
    parse(await readFile(absolute('data/queue.yaml'), 'utf8')) ?? [],
  );
  if (list.includes('--next')) {
    const count = Number(list[list.indexOf('--next') + 1]);
    if (!Number.isInteger(count) || count < 1) fail('--next takes a whole number of at least 1');
    return nextQueued(queue, count).map(({ id, name, website }) => ({ id, name, website }));
  }
  const { sources } = await loadCatalogFiles();
  const providers = new Map(
    sources.flatMap((source) => {
      const data = 'data' in source ? (source.data as Partial<Target> | null) : null;
      return source.file.startsWith('data/providers/') && data?.id
        ? [[data.id, data] as const]
        : [];
    }),
  );
  const skip = new Set(
    list
      .flatMap((arg, index) => (arg === '--kinds' ? [index + 1] : []))
      .map((index) => list[index]),
  );
  return list
    .filter((arg) => !arg.startsWith('--') && !skip.has(arg))
    .map((id) => {
      const provider = providers.get(id);
      if (provider?.name && provider.website) {
        return {
          id,
          name: provider.name,
          website: provider.website,
          ...(provider.domains && { domains: provider.domains }),
        };
      }
      const entry = queue.find((candidate) => candidate.id === id);
      if (!entry) fail(`"${id}" isn't in data/queue.yaml or data/providers/.`);
      return { id, name: entry.name, website: entry.website };
    });
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

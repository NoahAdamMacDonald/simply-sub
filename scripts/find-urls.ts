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
//            --region GB (M10.12: another country's pricing page, for a provider the catalog has: the hreflang and
//            locale links of the pages its prices cite first, then the search for that country's; pricing only unless
//            --kinds says otherwise; written to .pipeline/<id>/regions/GB/urls.json)
import {
  findPages,
  hostOf,
  nextQueued,
  pageKinds,
  queueFileSchema,
  regionalPages,
  regionalVariants,
  regionBrowser,
  wentToAnotherCountry,
  toIsoDate,
  type FetchedPage,
  type PageKind,
  type ProviderSite,
} from '@simply-sub/core';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { loadCatalogFiles, plural } from './lib/catalog-files';
import { Renderer } from './lib/browser';
import {
  absolute,
  readJson,
  workFile,
  workId,
  writeJson,
  type FoundUrls,
} from './lib/pipeline-files';
import { localSearchBudgets, webSearch } from './lib/search';
import { urlSample } from './lib/url-sample';
import { PoliteWeb } from './lib/web';

interface Target extends ProviderSite {
  id: string;
  /** The sample's right pricing pages. */
  pricing?: RegExp[];
  /** The pages a catalog provider's prices cite, whose hreflang and locale links lead to a region's (M10.12). */
  cited?: string[];
}

const args = process.argv.slice(2);
const flag = (name: string) => args.indexOf(name);
const region = flag('--region') >= 0 ? args[flag('--region') + 1] : undefined;
const browserSettings = region === undefined ? undefined : regionBrowser(region);
if (region !== undefined && browserSettings === undefined) {
  fail(
    `--region takes a country the pipeline reads: "${region}" isn't one yet (core's regionBrowser).`,
  );
}
const kindsArg = flag('--kinds') >= 0 ? args[flag('--kinds') + 1] : undefined;
const kinds = (kindsArg?.split(',') ?? (region ? ['pricing'] : [...pageKinds])) as PageKind[];
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

const web = new PoliteWeb(browserSettings?.acceptLanguage);
const renderer = args.includes('--browser') ? new Renderer(web, browserSettings) : undefined;
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
  const work = workId(target.id, region);
  // A region's pricing page, as the catalog's own pricing pages link to it, needs no search.
  const linked =
    region && searched.includes('pricing') ? await linkedPage(target, region) : undefined;
  const reports = await findPages(
    { ...target, ...(region && { region }) },
    searched.filter((kind) => !(linked && kind === 'pricing')),
    io,
  );
  if (linked) {
    reports.unshift({
      kind: 'pricing',
      found: { kind: 'pricing', url: linked.url, via: linked.via, fit: 'unreadable', score: 3 },
      tried: [{ url: linked.from, via: linked.via, result: 'probable' }],
      searched: 'no',
    });
  }
  // A run for some kinds keeps what an earlier run found for the others.
  const earlier = await readJson<FoundUrls>(workFile(work, 'urls.json'));
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
  await writeJson(workFile(work, 'urls.json'), found);
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
    `\n${plural(web.requested.length, 'request')}. Wrote .pipeline/<id>/${region ? `regions/${region}/` : ''}urls.json for each.`,
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
      .flatMap((arg, index) => (arg === '--kinds' || arg === '--region' ? [index + 1] : []))
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
          cited: citedPricing(provider),
        };
      }
      const entry = queue.find((candidate) => candidate.id === id);
      if (!entry) fail(`"${id}" isn't in data/queue.yaml or data/providers/.`);
      return { id, name: entry.name, website: entry.website };
    });
}

/** The pricing pages a provider file's plans cite, each once. */
function citedPricing(provider: unknown): string[] {
  const plans = (provider as { plans?: { prices?: { sourceUrl?: string }[] }[] }).plans ?? [];
  const urls = plans.flatMap((plan) =>
    (plan.prices ?? []).flatMap((price) => price.sourceUrl ?? []),
  );
  return [...new Set(urls)];
}

/**
 * The region's pricing page as a page the catalog cites links to it: an hreflang link or a link under the region's
 * locale (core's regionalPages). Else the same address with the region's country in place of the page's own
 * (regionalVariants: Netflix's help article's /ca to /gb), when it answers there without going to another country.
 * Undefined when neither finds one.
 */
async function linkedPage(
  target: Target,
  country: string,
): Promise<{ url: string; from: string; via: 'hreflang' | 'path' } | undefined> {
  const resolve = (href: string, base: string) => web.resolve(href, base);
  for (const url of target.cited ?? []) {
    const page = await web.page(url);
    if ('error' in page) continue;
    const found = regionalPages(page.html, page.url, resolve).get(country);
    if (found !== undefined) return { url: found, from: url, via: 'hreflang' };
  }
  for (const url of target.cited ?? []) {
    for (const variant of regionalVariants(url, country)) {
      const page = await web.page(variant);
      if (!('error' in page) && !wentToAnotherCountry(variant, page.url)) {
        return { url: page.url, from: url, via: 'path' };
      }
    }
  }
  return undefined;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

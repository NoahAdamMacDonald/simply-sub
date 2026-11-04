import { launch } from '@cloudflare/playwright';
import {
  automationSchema,
  bankOfCanadaSeriesUrl,
  policyFileSchema,
  seedDailyWrites,
  seedIndexPath,
  seedIndexSchema,
  seedNext,
  seedProviderPath,
  seedTables,
  type SeedDatabase,
  policyIndexPart,
  policyIndexPath,
  policyTopicsFileSchema,
  sharedPolicyFilePath,
  sharedPolicyFileSchema,
  workersAiModel,
  baselinePath,
  maxPageChars,
  readBaseline,
  pageText,
  wentToAnotherCountry,
  parseRobots,
  robotsAllow,
  userAgent,
  type Bundle,
  type FetchedPage,
  type Robots,
  type SearchBudget,
  type SnapshotProvider,
} from '@simply-sub/core';
import { readSeries } from './bank-of-canada';
import type { PageDeps, PageResult } from './check-pages';
import { extractionAnswerTokens, type DiscoveryServices, type DiscoveryWeb } from './discovery';
import { extractionModel } from './extraction';
import { GitHub } from './github';
import { parse } from 'yaml';
import type { Services } from './run';
import { botSearch } from './search';
import { kvState, type BotState, type KvLike } from './state';
import { bundleOwner, catalogIndex } from './targets';

// The night's services in the Worker: the catalog D1, the web (polite: robots.txt, one request per URL, en-CA
// headers), Browser Rendering, Workers AI, GitHub (the settings, the baselines, the pull requests) and KV (what the bot
// remembers between nights, under bot: keys in the namespace it shares with the API). Tests use fakes of these (test/run.spec.ts).

/** Canadian English, so a site that prices by locale shows Canada's (BLUEPRINT §7.7's region caveat). */
const headers = { 'User-Agent': userAgent, 'Accept-Language': 'en-CA,en;q=0.9' };
const timeoutMs = 15_000;
const maxRobotsBytes = 500_000;

export function workerServices(env: Env): Services {
  const github = new GitHub({
    token: env.GITHUB_TOKEN,
    repository: env.GITHUB_REPOSITORY,
    base: env.GITHUB_BASE,
  });
  const state = kvState(env.KV as unknown as KvLike);
  return {
    async readProviderIds() {
      return (await select<{ id: string }>(env.DB, 'SELECT id FROM providers ORDER BY id')).map(
        (row) => row.id,
      );
    },
    async readIndex(ids, namers) {
      const providers = (
        await select<{ json: string }>(
          env.DB,
          `SELECT json FROM providers WHERE id IN (${ids.map(() => '?').join(', ')}) ORDER BY id`,
          ...ids,
        )
      ).map((row) => JSON.parse(row.json) as SnapshotProvider);
      const here = new Set(ids);
      const bundles = (
        await select<{ json: string }>(env.DB, 'SELECT json FROM bundles ORDER BY id')
      )
        .map((row) => JSON.parse(row.json) as Bundle)
        .filter((bundle) => here.has(bundleOwner(bundle)));
      // Policies aren't in D1 (M11.8): the site's index of their files says which pages each cites, and the shared
      // documents these providers check (each by the first of the night's providers naming it) are read from their
      // files, a request each.
      const policies = policyIndexPart(
        await siteJson(new URL(policyIndexPath, env.SITE_URL)),
        namers,
      );
      const firsts = [...namers].sort();
      const checked = Object.keys(policies.sets).filter((set) =>
        here.has(firsts.find((id) => policies.providers[id]?.shared?.includes(set)) ?? ''),
      );
      const sets = await Promise.all(
        checked.map(async (id) =>
          sharedPolicyFileSchema.safeParse(
            await siteJson(new URL(sharedPolicyFilePath(id), env.SITE_URL)),
          ),
        ),
      );
      return catalogIndex(
        providers,
        bundles,
        sets.flatMap((set) => (set.success ? [set.data] : [])),
        policies,
        namers,
      );
    },
    async readProvider(id) {
      const [row] = await select<{ json: string }>(
        env.DB,
        'SELECT json FROM providers WHERE id = ?',
        id,
      );
      return row && (JSON.parse(row.json) as SnapshotProvider);
    },
    async readPolicies(url) {
      return policyFileSchema.parse(await siteJson(url)).policies;
    },
    seedNext: (today) =>
      seedNext(
        catalogDatabase(env.DB),
        {
          index: async () =>
            seedIndexSchema.parse(await siteJson(new URL(seedIndexPath, env.SITE_URL))),
          provider: async (id) =>
            (await siteResponse(new URL(seedProviderPath(id), env.SITE_URL))).text(),
          sha256,
        },
        { today, daily: seedDailyWrites },
      ),
    async readBundle(id) {
      const [row] = await select<{ json: string }>(
        env.DB,
        'SELECT json FROM bundles WHERE id = ?',
        id,
      );
      return row && (JSON.parse(row.json) as Bundle);
    },
    async readRobots(hosts) {
      const found: Record<string, Robots> = {};
      for (const host of hosts) found[host] = await robotsOf(host);
      return found;
    },
    readRepository: () => github.state(),
    async readSettings(commit) {
      return automationSchema.parse(parse(await github.text('data/automation.yaml', commit)));
    },
    async readBaseline(url, commit) {
      const text = await github.textIfThere(baselinePath(url), commit);
      return text === undefined ? null : (readBaseline(text) ?? null);
    },
    async readTopics(commit) {
      return policyTopicsFileSchema.parse(
        parse(await github.text('data/policy-topics.yaml', commit)),
      );
    },
    ask: (system, user) =>
      (env.AI as unknown as { run(model: string, input: unknown): Promise<unknown> }).run(
        workersAiModel,
        {
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          max_tokens: 600,
        },
      ),
    state,
    pages: (robots) => pageDeps(env, robots, github),
    async bankOfCanada(start) {
      const { get } = politeWeb({});
      const got = await get(
        `${bankOfCanadaSeriesUrl}?start_date=${start}`,
        'application/json',
        2_000_000,
      );
      if ('error' in got) return got;
      try {
        const series = readSeries(JSON.parse(new TextDecoder().decode(got.bytes)));
        return series ?? { error: 'The series isn’t in the shape the bot reads' };
      } catch {
        return { error: 'The series isn’t JSON' };
      }
    },
    discovery: discoveryServices(env, github, state),
    async readFiles(paths, commit) {
      const files: Record<string, string> = {};
      for (const path of paths) files[path] = await github.text(path, commit);
      return files;
    },
    propose: (state, made, branch) => github.propose(state, made, branch),
  };
}

/** Runs a read on the catalog D1. Only SELECTs: the night's checks never write (the seed writes through catalogDatabase). */
async function select<T>(db: D1Database, sql: string, ...values: unknown[]): Promise<T[]> {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error('The bot only reads the catalog');
  const { results } = await db
    .prepare(sql)
    .bind(...values)
    .all<T>();
  return results;
}

/**
 * One of the site's own static files (M11.8), which data:build writes beside the catalog: the Terms and policies
 * files, and the seed's.
 */
async function siteResponse(url: string | URL): Promise<Response> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${String(url)}: ${response.status} ${response.statusText}`);
  return response;
}

async function siteJson(url: string | URL): Promise<unknown> {
  return (await siteResponse(url)).json();
}

/**
 * The catalog D1 for seeding what waits (M11.8): its reads, and writes to the catalog's own tables only (a shape's,
 * providers_s3, and the catalog row), with the switch of the API's views to a new shape's tables, each step's in one
 * transaction.
 */
function catalogDatabase(db: D1Database): SeedDatabase {
  const tables = Object.keys(seedTables).join('|');
  const seeded = new RegExp(
    `^(?:(?:INSERT INTO|UPDATE|DELETE FROM) (?:${tables})(?:_s\\d+)? |DROP VIEW IF EXISTS (?:${tables});$|CREATE VIEW (${tables}) AS SELECT \\* FROM \\1_s\\d+;$)`,
  );
  return {
    async read(queries) {
      if (queries.some((query) => !/^\s*SELECT\b/i.test(query))) {
        throw new Error('The seed only reads with SELECT');
      }
      return (await db.batch(queries.map((query) => db.prepare(query)))).map(
        (result) => result.results,
      );
    },
    async write(statements) {
      const other = statements.find((statement) => !seeded.test(statement));
      if (other) throw new Error(`The bot writes only the catalog's tables: ${other.slice(0, 60)}`);
      await db.batch(statements.map((statement) => db.prepare(statement)));
    },
  };
}

/** A SHA-256 of `text`, in hex. */
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function robotsOf(host: string): Promise<Robots> {
  try {
    const response = await fetch(`https://${host}/robots.txt`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 400 && response.status < 500) return 'allow-all';
    if (!response.ok) return 'disallow-all';
    return parseRobots((await response.text()).slice(0, maxRobotsBytes));
  } catch {
    return 'disallow-all';
  }
}

/** Reads the web politely: each host's robots.txt first (once a step), with the bot's User-Agent and en-CA. */
function politeWeb(known: Readonly<Record<string, Robots>>) {
  // A host first met in this step (an icon on a CDN, a help centre): its robots.txt, read once.
  const robots = new Map(Object.entries(known));
  const allowed = async (url: URL) => {
    let rules = robots.get(url.host);
    if (rules === undefined) {
      rules = await robotsOf(url.host);
      robots.set(url.host, rules);
    }
    return robotsAllow(rules, `${url.pathname}${url.search}`);
  };
  const get = async (
    address: string,
    accept: string,
    maxBytes: number,
  ): Promise<{ url: string; bytes: Uint8Array } | { error: string }> => {
    const url = URL.parse(address);
    if (!url || !/^https?:$/.test(url.protocol)) return { error: 'Not a web address' };
    if (!(await allowed(url))) return { error: 'robots.txt doesn’t allow the bot to read it' };
    try {
      const response = await fetch(url, {
        headers: { ...headers, Accept: accept },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return { error: `The page answered ${response.status}` };
      if (Number(response.headers.get('content-length')) > maxBytes)
        return { error: 'The page is too big' };
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.length > maxBytes
        ? { error: 'The page is too big' }
        : { url: response.url, bytes };
    } catch (error) {
      return {
        error:
          error instanceof Error && error.name === 'TimeoutError'
            ? 'The page timed out'
            : 'The page couldn’t be reached',
      };
    }
  };
  return { robots, allowed, get };
}

/** A page's text as a browser shows it, with Browser Rendering. */
async function browserText(env: Env, url: string): Promise<PageResult> {
  let browser;
  try {
    browser = await launch(env.BROWSER as never);
    const context = await browser.newContext({
      userAgent,
      locale: 'en-CA',
      extraHTTPHeaders: { 'Accept-Language': headers['Accept-Language'] },
    });
    const tab = await context.newPage();
    await tab.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    const text = await tab.innerText('body');
    return { text: text.slice(0, maxPageChars) };
  } catch {
    return { error: 'Browser Rendering couldn’t read the page' };
  } finally {
    await browser?.close();
  }
}

function pageDeps(env: Env, known: Readonly<Record<string, Robots>>, github: GitHub): PageDeps {
  const { allowed, get } = politeWeb(known);
  return {
    async page(address): Promise<PageResult> {
      const got = await get(address, 'text/html,application/xhtml+xml', 4_000_000);
      if ('error' in got) return got;
      // A region's page that went to another country's isn't its page there (M10.12): unread, like one that didn't
      // answer.
      if (wentToAnotherCountry(address, got.url)) {
        return { error: `It went to another country's page (${got.url})` };
      }
      return { text: pageText(new TextDecoder().decode(got.bytes)) };
    },
    async browser(address): Promise<PageResult> {
      const url = URL.parse(address);
      if (!url || !(await allowed(url)))
        return { error: 'robots.txt doesn’t allow the bot to read it' };
      return browserText(env, url.href);
    },
    extract: (request) =>
      (env.AI as unknown as { run(model: string, input: unknown): Promise<unknown> }).run(
        extractionModel,
        request,
      ),
    async download(address, maxBytes, accept) {
      const got = await get(address, accept, maxBytes);
      return 'error' in got ? undefined : got;
    },
    async committedLogo(id) {
      try {
        return await github.bytes(`data/logos/${id}.png`, env.GITHUB_BASE);
      } catch {
        return undefined;
      }
    },
  };
}

/** What the discovery needs (M3.11): the queue and registries from GitHub, the web with a search, and Workers AI. */
function discoveryServices(env: Env, github: GitHub, state: BotState): DiscoveryServices {
  return {
    state,
    text: (path, commit) => github.text(path, commit),
    batchPulls: () => github.batchPulls(),
    web: (robots, search) => discoveryWeb(env, robots, state, search),
    extract: (system, user) =>
      (env.AI as unknown as { run(model: string, input: unknown): Promise<unknown> }).run(
        workersAiModel,
        {
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          max_tokens: extractionAnswerTokens,
        },
      ),
    propose: (repository, made, branch) => github.propose(repository, made, branch),
  };
}

/** The most a sitemap may be, unzipped: one lists up to 50,000 pages. */
const maxSitemapBytes = 10_000_000;

function discoveryWeb(
  env: Env,
  known: Readonly<Record<string, Robots>>,
  state: BotState,
  search: { budgets: SearchBudget[]; month: string },
): DiscoveryWeb {
  const { robots, allowed, get } = politeWeb(known);
  const texts = new Map<string, string>();
  const read = new Map<string, Promise<FetchedPage | { error: string }>>();
  const find = botSearch(
    search.budgets,
    {
      tavily: { key: env.TAVILY_API_KEY },
      brave: { key: env.BRAVE_API_KEY },
      searxng: { base: env.SEARXNG_URL },
    },
    {
      used: () => state.searches(search.month),
      count: (engine) => state.countSearch(search.month, engine),
    },
  );
  return {
    // Each page once a step, whichever kind asks for it.
    page: (address) => {
      let page = read.get(address);
      if (!page) {
        page = (async () => {
          const got = await get(address, 'text/html,application/xhtml+xml', 4_000_000);
          if ('error' in got) return got;
          const html = new TextDecoder().decode(got.bytes);
          const text = pageText(html);
          texts.set(got.url, text);
          return { url: got.url, html, text };
        })();
        read.set(address, page);
      }
      return page;
    },
    async file(address) {
      const got = await get(address, 'application/xml,text/xml,text/plain,*/*', maxSitemapBytes);
      if ('error' in got) return undefined;
      // A sitemap may come gzipped (sitemap.xml.gz).
      const zipped = got.bytes[0] === 0x1f && got.bytes[1] === 0x8b;
      const bytes = zipped ? await gunzip(got.bytes) : got.bytes;
      return bytes && bytes.length <= maxSitemapBytes ? new TextDecoder().decode(bytes) : undefined;
    },
    resolve(href, base) {
      const url = URL.parse(href, base);
      return url && /^https?:$/.test(url.protocol) ? url.href.replace(/#.*$/, '') : undefined;
    },
    ...(find && { search: find }),
    textOf: (url) => texts.get(url),
    async browser(address) {
      const url = URL.parse(address);
      if (!url || !(await allowed(url)))
        return { error: 'robots.txt doesn’t allow the bot to read it' };
      return browserText(env, url.href);
    },
    async download(address, maxBytes, accept) {
      const got = await get(address, accept, maxBytes);
      return 'error' in got ? undefined : got;
    },
    robots: () => Object.fromEntries(robots),
  };
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return undefined;
  }
}

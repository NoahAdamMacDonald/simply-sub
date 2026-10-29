import { launch } from '@cloudflare/playwright';
import {
  automationSchema,
  policyTopicsFileSchema,
  workersAiModel,
  baselinePath,
  maxPageChars,
  readBaseline,
  pageText,
  parseRobots,
  robotsAllow,
  userAgent,
  type Bundle,
  type FetchedPage,
  type Robots,
  type SearchBudget,
  type SnapshotProvider,
} from '@simply-sub/core';
import type { PageDeps, PageResult } from './check-pages';
import { extractionAnswerTokens, type DiscoveryServices, type DiscoveryWeb } from './discovery';
import { extractionModel } from './extraction';
import { GitHub } from './github';
import { parse } from 'yaml';
import type { Services } from './run';
import { botSearch } from './search';
import { kvState, type BotState, type KvLike } from './state';
import { catalogIndex } from './targets';

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
    async readIndex() {
      const providers = await select<{ json: string }>(
        env.DB,
        'SELECT json FROM providers ORDER BY id',
      );
      const bundles = await select<{ json: string }>(
        env.DB,
        'SELECT json FROM bundles ORDER BY id',
      );
      return catalogIndex(
        providers.map((row) => JSON.parse(row.json) as SnapshotProvider),
        bundles.map((row) => JSON.parse(row.json) as Bundle),
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
    discovery: discoveryServices(env, github, state),
    async readFiles(paths, commit) {
      const files: Record<string, string> = {};
      for (const path of paths) files[path] = await github.text(path, commit);
      return files;
    },
    propose: (state, made, branch) => github.propose(state, made, branch),
  };
}

/** Runs a read on the catalog D1. Only SELECTs: the binding could write, and the bot never does. */
async function select<T>(db: D1Database, sql: string, ...values: unknown[]): Promise<T[]> {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error('The bot only reads the catalog');
  const { results } = await db
    .prepare(sql)
    .bind(...values)
    .all<T>();
  return results;
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
      return 'error' in got ? got : { text: pageText(new TextDecoder().decode(got.bytes)) };
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

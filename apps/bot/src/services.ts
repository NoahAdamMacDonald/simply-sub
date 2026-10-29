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
  type Robots,
  type SnapshotProvider,
} from '@simply-sub/core';
import type { PageDeps, PageResult } from './check-pages';
import { extractionModel } from './extraction';
import { GitHub } from './github';
import { parse } from 'yaml';
import type { Services } from './run';
import { kvState, type KvLike } from './state';
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
    state: kvState(env.KV as unknown as KvLike),
    pages: (robots) => pageDeps(env, robots, github),
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

function pageDeps(env: Env, known: Readonly<Record<string, Robots>>, github: GitHub): PageDeps {
  // A host first met in this step (an icon on a CDN): its robots.txt, read once.
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
  return {
    async page(address): Promise<PageResult> {
      const got = await get(address, 'text/html,application/xhtml+xml', 4_000_000);
      return 'error' in got ? got : { text: pageText(new TextDecoder().decode(got.bytes)) };
    },
    async browser(address): Promise<PageResult> {
      const url = URL.parse(address);
      if (!url || !(await allowed(url)))
        return { error: 'robots.txt doesn’t allow the bot to read it' };
      let browser;
      try {
        browser = await launch(env.BROWSER as never);
        const context = await browser.newContext({
          userAgent,
          locale: 'en-CA',
          extraHTTPHeaders: { 'Accept-Language': headers['Accept-Language'] },
        });
        const tab = await context.newPage();
        await tab.goto(url.href, { waitUntil: 'networkidle', timeout: 30_000 });
        const text = await tab.innerText('body');
        return { text: text.slice(0, maxPageChars) };
      } catch {
        return { error: 'Browser Rendering couldn’t read the page' };
      } finally {
        await browser?.close();
      }
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

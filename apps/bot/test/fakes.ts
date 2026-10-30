import {
  automationSchema,
  baselineLines,
  policyTopicsFileSchema,
  pageText,
  type Automation,
  type Baseline,
  type SearchResult,
  type SnapshotProvider,
} from '@simply-sub/core';
import automationYaml from '../../../data/automation.yaml?raw';
import featuresYaml from '../../../data/features.yaml?raw';
import policyTopicsYaml from '../../../data/policy-topics.yaml?raw';
import resellersYaml from '../../../data/resellers.yaml?raw';
import { parse } from 'yaml';
import mullvadYaml from '../../../data/providers/mullvad.yaml?raw';
import netflixYaml from '../../../data/providers/netflix.yaml?raw';
import type { PageDeps, PageResult } from '../src/check-pages';
import type { DiscoveryServices, DiscoveryWeb } from '../src/discovery';
import type { ExtractionRequest } from '../src/extraction';
import type { RepositoryState } from '../src/github';
import { gitBlobSha } from '../src/icons';
import type { Proposal } from '../src/proposal';
import type { Services } from '../src/run';
import { memoryState, type BotState } from '../src/state';
import { catalogIndex } from '../src/targets';
import mullvadPricing from './fixtures/mullvad-pricing.html?raw';
import mullvadResellers from './fixtures/mullvad-resellers.html?raw';
import netflixAu from './fixtures/netflix-au.html?raw';
import netflixCa from './fixtures/netflix-ca.html?raw';
import netflixNz from './fixtures/netflix-nz.html?raw';
import netflixPaymentCa from './fixtures/netflix-payment-ca.html?raw';
import netflixPaymentUs from './fixtures/netflix-payment-us.html?raw';

// A night's world for the tests: the real Netflix and Mullvad files as the catalog has them, their pages as fixtures
// (a page that isn't here answers 404), their icons, a Workers AI that answers as told, and a GitHub that keeps the
// pull request it's given.

export const today = '2026-10-29';

export const netflix = parse(netflixYaml) as SnapshotProvider;
export const mullvad = parse(mullvadYaml) as SnapshotProvider;
export const files: Record<string, string> = {
  'data/providers/netflix.yaml': netflixYaml,
  'data/providers/mullvad.yaml': mullvadYaml,
};

/** A PNG's first bytes, which is all the icon search reads: the signature and the IHDR chunk. */
export function png(width: number, salt = 0): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, width);
  bytes[40] = salt;
  return bytes;
}

export interface World {
  /** URL → HTML. */
  pages: Record<string, string>;
  /** URL → an icon file. */
  icons: Record<string, Uint8Array>;
  /** Workers AI's answer to a request. */
  ai?: (request: ExtractionRequest) => unknown;
  /** URLs only a browser gets the text of. */
  browserOnly?: Record<string, string>;
  /** Workers AI's answer to a review's messages (M3.10). */
  review?: (system: string, user: string) => unknown;
  /** The discovery's world (M3.11): data/queue.yaml as main has it (one with no services by default). */
  queue?: string;
  /** URL → a file's text (robots.txt, a sitemap). */
  files?: Record<string, string>;
  /** Workers AI's answer to a part of an extraction. */
  extract?: (system: string, user: string) => unknown;
  /** The queue ids in open and rejected batch pull requests. */
  batchPulls?: { open: string[]; closed: string[] };
  /** A web search's results. */
  search?: (query: string) => SearchResult[] | undefined;
}

/** The logos as committed. */
export const committedLogos: Record<string, Uint8Array> = { netflix: png(180), mullvad: png(192) };

/** The stored pages and icons: nothing has changed. */
export function storedWorld(): World {
  return {
    pages: {
      'https://help.netflix.com/en/node/24926/ca': netflixCa,
      'https://help.netflix.com/en/node/24926/au': netflixAu,
      'https://help.netflix.com/en/node/24926/nz': netflixNz,
      'https://help.netflix.com/en/node/116380/ca': netflixPaymentCa,
      'https://help.netflix.com/en/node/116380/us': netflixPaymentUs,
      'https://mullvad.net/en/pricing': mullvadPricing,
      'https://mullvad.net/en/help/partnerships-and-resellers': mullvadResellers,
      'https://www.netflix.com/': '<link rel="apple-touch-icon" href="/icon-180.png">',
      'https://mullvad.net/': '<link rel="icon" sizes="192x192" href="/icon-192.png">',
    },
    icons: {
      'https://www.netflix.com/icon-180.png': png(180),
      'https://mullvad.net/icon-192.png': png(192),
    },
  };
}

export interface Calls {
  pages: string[];
  browser: string[];
  ai: ExtractionRequest[];
}

export function fakeDeps(
  world: World,
  calls: Calls = { pages: [], browser: [], ai: [] },
): PageDeps {
  return {
    async page(url): Promise<PageResult> {
      calls.pages.push(url);
      const html = world.pages[url];
      return html === undefined ? { error: 'The page answered 404' } : { text: pageText(html) };
    },
    async browser(url): Promise<PageResult> {
      calls.browser.push(url);
      const text = world.browserOnly?.[url];
      return text === undefined ? { error: 'Browser Rendering couldn’t read the page' } : { text };
    },
    async extract(request) {
      calls.ai.push(request);
      return world.ai?.(request) ?? { response: { prices: [] } };
    },
    async committedLogo(id) {
      return committedLogos[id];
    },
    async download(url) {
      calls.pages.push(url);
      const icon = world.icons[url];
      if (icon) return { url, bytes: icon };
      const html = world.pages[url];
      return html === undefined ? undefined : { url, bytes: new TextEncoder().encode(html) };
    },
  };
}

/**
 * data/automation.yaml as main has it, with the digest on 2026-10-29's weekday and no discovery unless `changes` say
 * otherwise.
 */
export function settings(changes: Partial<Automation> = {}): Automation {
  const automation = automationSchema.parse(parse(automationYaml));
  return {
    ...automation,
    digest: { day: 'thursday' },
    ...changes,
    cadence: { ...automation.cadence, discovery: 'off', ...changes.cadence },
  };
}

/**
 * Each stored page's baseline, as main has it: its text as the bot reads it (M3.9), so a night with nothing changed
 * finds every page the same.
 */
export function storedBaselines(): Record<string, Baseline> {
  return Object.fromEntries(
    Object.entries(storedWorld().pages).map(([url, html]) => [
      url,
      { url, method: 'fetch', saved: '2026-10-28', lines: baselineLines(pageText(html)) },
    ]),
  );
}

/** The catalog D1, the repository and GitHub for `world`; `proposals` keeps what GitHub was given. */
export async function fakeServices(
  world: World,
  providers: SnapshotProvider[] = [netflix, mullvad],
  options: { settings?: Automation; baselines?: Record<string, Baseline>; state?: BotState } = {},
): Promise<
  Services & {
    proposals: (Proposal & { branch: string })[];
    steps: string[];
    discovery: ReturnType<typeof fakeDiscovery>;
  }
> {
  const logos = {
    netflix: await gitBlobSha(committedLogos['netflix']),
    mullvad: await gitBlobSha(committedLogos['mullvad']),
  };
  const repository: RepositoryState = { commit: 'c0ffee', tree: 'tree0', logos, resellers: [] };
  const proposals: (Proposal & { branch: string })[] = [];
  const baselines = options.baselines ?? storedBaselines();
  const state = options.state ?? memoryState();
  const propose = async (_state: RepositoryState, made: Proposal, branch: string) => {
    proposals.push({ ...made, branch });
    return `https://github.com/NoahAdamMacDonald/simply-sub/pull/${proposals.length}`;
  };
  return {
    proposals,
    steps: [],
    readIndex: async () => catalogIndex(providers, []),
    readProvider: async (id) => providers.find((provider) => provider.id === id),
    readBundle: async () => undefined,
    readRobots: async (hosts) =>
      Object.fromEntries(hosts.map((host) => [host, 'allow-all' as const])),
    readRepository: async () => repository,
    readSettings: async () => options.settings ?? settings(),
    readBaseline: async (url) => baselines[url] ?? null,
    readTopics: async () => policyTopicsFileSchema.parse(parse(policyTopicsYaml)),
    ask: async (system, user) =>
      world.review?.(system, user) ?? { response: { decision: 'unsure', quotes: [] } },
    state,
    pages: () => fakeDeps(world),
    readFiles: async (paths) => Object.fromEntries(paths.map((path) => [path, files[path] ?? ''])),
    propose,
    discovery: fakeDiscovery(world, state, propose),
  };
}

/** The repository's files the discovery reads. */
function repositoryText(world: World, path: string): string {
  const text = {
    'data/queue.yaml': world.queue ?? '[]\n',
    'data/features.yaml': featuresYaml,
    'data/policy-topics.yaml': policyTopicsYaml,
    'data/resellers.yaml': resellersYaml,
  }[path];
  if (text === undefined) throw new Error(`GitHub GET contents/${path}: 404`);
  return text;
}

/** The discovery's services for `world` (M3.11). */
export function fakeDiscovery(
  world: World,
  state: BotState,
  propose: DiscoveryServices['propose'],
): DiscoveryServices & { reads: string[]; asked: string[] } {
  const reads: string[] = [];
  const asked: string[] = [];
  return {
    reads,
    asked,
    state,
    text: async (path) => repositoryText(world, path),
    batchPulls: async () => world.batchPulls ?? { open: [], closed: [] },
    web: () => fakeWeb(world, reads),
    extract: async (system, user) => {
      asked.push(user);
      return world.extract?.(system, user) ?? { response: '{}' };
    },
    propose,
  };
}

function fakeWeb(world: World, reads: string[]): DiscoveryWeb {
  const texts = new Map<string, string>();
  const download = fakeDeps(world).download;
  return {
    async page(url) {
      reads.push(url);
      const html = world.pages[url];
      if (html === undefined) return { error: 'The page answered 404' };
      const text = pageText(html);
      texts.set(url, text);
      return { url, html, text };
    },
    async file(url) {
      reads.push(url);
      return world.files?.[url];
    },
    resolve(href, base) {
      const url = URL.parse(href, base);
      return url && /^https?:$/.test(url.protocol) ? url.href.replace(/#.*$/, '') : undefined;
    },
    ...(world.search && { search: async (query: string) => world.search?.(query) }),
    textOf: (url) => texts.get(url),
    async browser(url) {
      reads.push(`browser ${url}`);
      const text = world.browserOnly?.[url];
      return text === undefined ? { error: 'Browser Rendering couldn’t read the page' } : { text };
    },
    download,
    robots: () => ({}),
  };
}

/** Runs a step at once, as a Workflow does the first time, and notes its name. */
export function stepper(names: string[]) {
  return async <T>(name: string, task: () => Promise<T>): Promise<T> => {
    names.push(name);
    return task();
  };
}

import { pageText, type SnapshotProvider } from '@simply-sub/core';
import { parse } from 'yaml';
import mullvadYaml from '../../../data/providers/mullvad.yaml?raw';
import netflixYaml from '../../../data/providers/netflix.yaml?raw';
import type { PageDeps, PageResult } from '../src/check-pages';
import type { ExtractionRequest } from '../src/extraction';
import type { RepositoryState } from '../src/github';
import { gitBlobSha } from '../src/icons';
import type { Proposal } from '../src/proposal';
import type { Services } from '../src/run';
import { catalogIndex } from '../src/targets';
import mullvadPricing from './fixtures/mullvad-pricing.html?raw';
import mullvadResellers from './fixtures/mullvad-resellers.html?raw';
import netflixCa from './fixtures/netflix-ca.html?raw';
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
}

/** The logos as committed. */
export const committedLogos: Record<string, Uint8Array> = { netflix: png(180), mullvad: png(192) };

/** The stored pages and icons: nothing has changed. */
export function storedWorld(): World {
  return {
    pages: {
      'https://help.netflix.com/en/node/24926/ca': netflixCa,
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

/** The catalog D1, the repository and GitHub for `world`; `proposals` keeps what GitHub was given. */
export async function fakeServices(
  world: World,
  providers: SnapshotProvider[] = [netflix, mullvad],
): Promise<Services & { proposals: Proposal[]; steps: string[] }> {
  const logos = {
    netflix: await gitBlobSha(committedLogos['netflix']),
    mullvad: await gitBlobSha(committedLogos['mullvad']),
  };
  const repository: RepositoryState = { commit: 'c0ffee', tree: 'tree0', logos, resellers: [] };
  const proposals: Proposal[] = [];
  return {
    proposals,
    steps: [],
    readIndex: async () => catalogIndex(providers, []),
    readProvider: async (id) => providers.find((provider) => provider.id === id),
    readBundle: async () => undefined,
    readRobots: async (hosts) =>
      Object.fromEntries(hosts.map((host) => [host, 'allow-all' as const])),
    readRepository: async () => repository,
    pages: () => fakeDeps(world),
    readFiles: async (paths) => Object.fromEntries(paths.map((path) => [path, files[path] ?? ''])),
    propose: async (_state, made) => {
      proposals.push(made);
      return 'https://github.com/NoahAdamMacDonald/simply-sub/pull/1';
    },
  };
}

/** Runs a step at once, as a Workflow does the first time, and notes its name. */
export function stepper(names: string[]) {
  return async <T>(name: string, task: () => Promise<T>): Promise<T> => {
    names.push(name);
    return task();
  };
}

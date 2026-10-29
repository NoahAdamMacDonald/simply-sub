import type { IsoDate, SearchEngine } from '@simply-sub/core';
import type { DiscoveryBatch, ServiceWork } from './discovery';
import type { Searches } from './search';
import type { Finding } from './types';

// What the bot remembers between nights (BLUEPRINT §6.4, M3.9), in the KV namespace it shares with the API under keys
// that start with `bot:`: when each page and logo was last checked (one key, written once a night), the day the last
// digest was built, what each page that changed is waiting to propose (a key per page, kept until main's
// baseline has caught up with it), the month's searches (M3.11), and the discovery batch under way with each
// service's work so far, until its pull request is opened. The catalog itself stays in Git: nothing here is a
// source of truth.

/** A page's (or a logo's) findings waiting for the weekly digest. */
export interface Pending {
  /** The page's URL, or `logo:<id>`. */
  key: string;
  /** The night it was last checked. */
  seen: IsoDate;
  findings: Finding[];
}

export interface BotState {
  /** URL (or `logo:<id>`) → the night it was last checked. */
  checks(): Promise<Record<string, IsoDate>>;
  saveChecks(checks: Readonly<Record<string, IsoDate>>): Promise<void>;
  lastDigest(): Promise<IsoDate | undefined>;
  saveDigest(date: IsoDate): Promise<void>;
  pending(): Promise<Pending[]>;
  putPending(pending: Pending): Promise<void>;
  dropPending(key: string): Promise<void>;
  /** The month's searches (YYYY-MM), by engine. */
  searches(month: string): Promise<Searches>;
  countSearch(month: string, engine: SearchEngine): Promise<void>;
  /** The discovery batch under way; saving undefined ends it. */
  discovery(): Promise<DiscoveryBatch | undefined>;
  saveDiscovery(batch: DiscoveryBatch | undefined): Promise<void>;
  /** A service's discovery work; saving undefined drops it. */
  work(id: string): Promise<ServiceWork | undefined>;
  saveWork(id: string, work: ServiceWork | undefined): Promise<void>;
}

/** The part of Workers KV the state uses. */
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

const checksKey = 'bot:checks';
const digestKey = 'bot:digest';
const pendingPrefix = 'bot:pending:';
const searchPrefix = 'bot:search:';
const discoveryKey = 'bot:discovery';
const workPrefix = 'bot:discovery:';

/** The state in a KV namespace. */
export function kvState(kv: KvLike): BotState {
  const searches = async (month: string) =>
    JSON.parse((await kv.get(`${searchPrefix}${month}`)) ?? '{}') as Searches;
  return {
    async checks() {
      return JSON.parse((await kv.get(checksKey)) ?? '{}') as Record<string, IsoDate>;
    },
    async saveChecks(checks) {
      await kv.put(checksKey, JSON.stringify(checks));
    },
    async lastDigest() {
      return (await kv.get(digestKey)) ?? undefined;
    },
    async saveDigest(date) {
      await kv.put(digestKey, date);
    },
    async pending() {
      const found: Pending[] = [];
      let cursor: string | undefined;
      do {
        const page = await kv.list({ prefix: pendingPrefix, ...(cursor && { cursor }) });
        for (const { name } of page.keys) {
          const value = await kv.get(name);
          if (value) found.push(JSON.parse(value) as Pending);
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return found;
    },
    async putPending(pending) {
      await kv.put(pendingKey(pending.key), JSON.stringify(pending));
    },
    async dropPending(key) {
      await kv.delete(pendingKey(key));
    },
    searches,
    async countSearch(month, engine) {
      const used = await searches(month);
      used[engine] = (used[engine] ?? 0) + 1;
      await kv.put(`${searchPrefix}${month}`, JSON.stringify(used));
    },
    async discovery() {
      const value = await kv.get(discoveryKey);
      return value ? (JSON.parse(value) as DiscoveryBatch) : undefined;
    },
    async saveDiscovery(batch) {
      if (batch) await kv.put(discoveryKey, JSON.stringify(batch));
      else await kv.delete(discoveryKey);
    },
    async work(id) {
      const value = await kv.get(`${workPrefix}${id}`);
      return value ? (JSON.parse(value) as ServiceWork) : undefined;
    },
    async saveWork(id, work) {
      if (work) await kv.put(`${workPrefix}${id}`, JSON.stringify(work));
      else await kv.delete(`${workPrefix}${id}`);
    },
  };
}

/** A page's KV key: a hash of its URL, since KV keys are at most 512 bytes. */
function pendingKey(key: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${pendingPrefix}${hash.toString(16).padStart(8, '0')}`;
}

/** A state in memory, for the tests. */
export function memoryState(): BotState & { kv: Map<string, string> } {
  const kv = new Map<string, string>();
  const state = kvState({
    get: async (key) => kv.get(key) ?? null,
    put: async (key, value) => void kv.set(key, value),
    delete: async (key) => void kv.delete(key),
    list: async ({ prefix }) => ({
      keys: [...kv.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
    }),
  });
  return Object.assign(state, { kv });
}

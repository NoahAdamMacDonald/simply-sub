import {
  reportedPlanSchema,
  reportKey,
  reportKeyPrefix,
  type IsoDate,
  type ReportedPlan,
  type SearchEngine,
} from '@simply-sub/core';
import type { DiscoveryBatch, ServiceWork } from './discovery';
import type { Memo } from './night';
import type { Searches } from './search';
import type { Finding } from './types';
import type { Writes } from './writes';

// What the bot remembers between nights (BLUEPRINT §6.4, M3.9), in the KV namespace it shares with the API under keys
// that start with `bot:`: when each page and logo was last checked (one key, written once a night), the day the last
// digest was built, what each page that changed is waiting to propose (a key per page, kept until main's
// baseline has caught up with it), the month's searches (M3.11), the discovery batch under way with each service's
// work so far, until its pull request is opened, and what each step of a night in parts returned, for its next parts. The API's nightly clean-up adds the price reports, a key per
// reported plan (M10.10), which the weekly digest takes. The catalog itself stays in Git: nothing here is a source of
// truth.

/** A page's (or a logo's) findings waiting for the weekly digest. */
export interface Pending {
  /** The page's URL, or `logo:<id>`. */
  key: string;
  /** The night its findings were last written: a night that finds the same leaves the entry as it was. */
  seen: IsoDate;
  findings: Finding[];
  /**
   * The provider whose night checked it (M11.8): the nights between see only their own providers, so its night tidies
   * it. Entries from before have none.
   */
  owner?: string;
}

export interface BotState {
  /** URL (or `logo:<id>`) → the night it was last checked. */
  checks(): Promise<Record<string, IsoDate>>;
  saveChecks(checks: Readonly<Record<string, IsoDate>>): Promise<void>;
  lastDigest(): Promise<IsoDate | undefined>;
  saveDigest(date: IsoDate): Promise<void>;
  pending(): Promise<Pending[]>;
  /**
   * The pending entries' KV names, sorted, without reading them: a step may make at most 1,000 requests to KV, and
   * 2026-11-24 had 1,399 entries, so they're read a part at a time (pendingAt).
   */
  pendingNames(): Promise<string[]>;
  /** The pending entries with these KV names that are still there. */
  pendingAt(names: readonly string[]): Promise<Pending[]>;
  /** The pending entries of these keys (pages' URLs, logo: and failed: keys) that are still there. */
  pendingOf(keys: readonly string[]): Promise<Pending[]>;
  putPending(pending: Pending): Promise<void>;
  /** Drops an entry; `there` when the caller has just read it, which saves reading it again. */
  dropPending(key: string, there?: boolean): Promise<void>;
  /** The month's searches (YYYY-MM), by engine. */
  searches(month: string): Promise<Searches>;
  countSearch(month: string, engine: SearchEngine): Promise<void>;
  /** The discovery batch under way; saving undefined ends it. */
  discovery(): Promise<DiscoveryBatch | undefined>;
  saveDiscovery(batch: DiscoveryBatch | undefined): Promise<void>;
  /** A service's discovery work; saving undefined drops it. */
  work(id: string): Promise<ServiceWork | undefined>;
  saveWork(id: string, work: ServiceWork | undefined): Promise<void>;
  /** The price reports the API handed over (M10.10), a plan each, until a digest has them. */
  reports(): Promise<ReportedPlan[]>;
  dropReport(plan: string): Promise<void>;
  /**
   * What each step of `date`'s night returned, for its later parts (night.ts), kept three days; `read` from the second
   * part on.
   */
  night(date: IsoDate, read: boolean): Memo & { read: boolean };
}

/** The part of Workers KV the state uses. */
export interface KvLike {
  get(key: string): Promise<string | null>;
  /** At most kvBulkKeys keys in one request (Workers KV's bulk get), each with its value or null. */
  getMany(keys: readonly string[]): Promise<Map<string, string | null>>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

/** The most keys one bulk get reads: Workers KV's limit. */
export const kvBulkKeys = 100;

/**
 * The values of `keys`, kvBulkKeys a request. A Workflow instance may make 1,000 requests to Cloudflare's services, and
 * part 33 of 2026-11-25 passed them reading the night's step results and the pending entries one key at a time.
 */
async function readMany(kv: KvLike, keys: readonly string[]): Promise<Map<string, string | null>> {
  const found = new Map<string, string | null>();
  for (let start = 0; start < keys.length; start += kvBulkKeys) {
    for (const [key, value] of await kv.getMany(keys.slice(start, start + kvBulkKeys))) {
      found.set(key, value);
    }
  }
  return found;
}

/** Every key with `prefix`, a list request a thousand. */
async function listAll(kv: KvLike, prefix: string): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix, ...(cursor && { cursor }) });
    names.push(...page.keys.map(({ name }) => name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return names;
}

const checksKey = 'bot:checks';
const digestKey = 'bot:digest';
const pendingPrefix = 'bot:pending:';
const searchPrefix = 'bot:search:';
const discoveryKey = 'bot:discovery';
const workPrefix = 'bot:discovery:';
const nightPrefix = 'bot:night:';
/** A night's steps are kept three days: its parts take minutes, and a night after has its own. */
const nightTtl = 3 * 24 * 60 * 60;

/** The state in a KV namespace. */
export function kvState(kv: KvLike): BotState {
  const searches = async (month: string) =>
    JSON.parse((await kv.get(`${searchPrefix}${month}`)) ?? '{}') as Searches;
  const pendingAt = async (names: readonly string[]) => {
    const values = await readMany(kv, names);
    return names.flatMap((name) => {
      const value = values.get(name);
      return value ? [JSON.parse(value) as Pending] : [];
    });
  };
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
    async pendingNames() {
      return (await listAll(kv, pendingPrefix)).sort();
    },
    pendingAt,
    async pendingOf(keys) {
      return pendingAt(keys.map(pendingKey));
    },
    // KV allows the free plan's account 1,000 writes and 1,000 deletes a day, and the night of 2026-11-24 used up the
    // writes rewriting every checked page's entry only for its date. So an entry is written only when what it proposes
    // has changed, and deleted only when it's there: reads are a hundred times cheaper.
    async putPending(pending) {
      const key = pendingKey(pending.key);
      const stored = await kv.get(key);
      if (stored !== null && sameProposal(JSON.parse(stored) as Pending, pending)) return;
      await kv.put(key, JSON.stringify(pending));
    },
    async dropPending(key, there = false) {
      const stored = pendingKey(key);
      if (there || (await kv.get(stored)) !== null) await kv.delete(stored);
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
    async reports() {
      const found: ReportedPlan[] = [];
      let cursor: string | undefined;
      do {
        const page = await kv.list({ prefix: reportKeyPrefix, ...(cursor && { cursor }) });
        for (const { name } of page.keys) {
          const parsed = reportedPlanSchema.safeParse(parseJson(await kv.get(name)));
          if (parsed.success) found.push(parsed.data);
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return found;
    },
    async dropReport(plan) {
      await kv.delete(reportKey(plan));
    },
    night(date, read) {
      const prefix = `${nightPrefix}${date}:`;
      const key = (name: string) => `${prefix}${name.length > 200 ? hash(name) : name}`;
      /** The earlier parts' results, read at once: a few requests, not one a step. */
      let earlier: Promise<Map<string, string | null>> | undefined;
      return {
        read,
        async get(name) {
          earlier ??= listAll(kv, prefix).then((names) => readMany(kv, names));
          // A result KV's list doesn't show yet (it can lag a minute) is read on its own.
          const value = (await earlier).get(key(name)) ?? (await kv.get(key(name)));
          return value === null
            ? undefined
            : (JSON.parse(value) as { value: unknown } | { failed: string });
        },
        async put(name, value) {
          await kv.put(key(name), JSON.stringify({ value }), { expirationTtl: nightTtl });
        },
        async fail(name, reason) {
          await kv.put(key(name), JSON.stringify({ failed: reason }), { expirationTtl: nightTtl });
        },
      };
    },
  };
}

/** A KV value's JSON, or undefined for none or text that isn't JSON. */
function parseJson(value: string | null): unknown {
  try {
    return value === null ? undefined : (JSON.parse(value) as unknown);
  } catch {
    return undefined;
  }
}

/** Whether two entries propose the same: the same findings for the same provider, whatever night they were seen. */
function sameProposal(stored: Pending, next: Pending): boolean {
  return (
    stored.key === next.key &&
    stored.owner === next.owner &&
    JSON.stringify(stored.findings) === JSON.stringify(next.findings)
  );
}

/** A page's KV key: a hash of its URL, since KV keys are at most 512 bytes. */
function pendingKey(key: string): string {
  return `${pendingPrefix}${hash(key)}`;
}

/** An FNV-1a hash of `text`, in hex. */
function hash(text: string): string {
  let hashed = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hashed ^= text.charCodeAt(index);
    hashed = Math.imul(hashed, 0x01000193) >>> 0;
  }
  return hashed.toString(16).padStart(8, '0');
}

/** A state in memory, for the tests: its writes counted by `writes` when given. */
export function memoryState(writes?: Writes): BotState & { kv: Map<string, string> } {
  const kv = new Map<string, string>();
  const inMemory: KvLike = {
    get: async (key) => kv.get(key) ?? null,
    getMany: async (keys) => new Map(keys.map((key) => [key, kv.get(key) ?? null])),
    put: async (key, value) => void kv.set(key, value),
    delete: async (key) => void kv.delete(key),
    list: async ({ prefix }) => ({
      keys: [...kv.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
    }),
  };
  const state = kvState(writes ? writes.count(inMemory) : inMemory);
  return Object.assign(state, { kv });
}

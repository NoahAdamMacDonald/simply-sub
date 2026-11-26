import type { KvLike } from './state';

// The KV writes a night makes (BLUEPRINT §6.4). On the free plan the whole account has 1,000 KV writes a day (and
// 1,000 deletes), which the API shares: its icons, FX rates and price reports. The night of 2026-11-24 used them all
// within 20 minutes, so the night counts its writes and deletes, step by step, and once writesPerNight are spent its
// remaining page checks wait for another night: pages it didn't check stay due, so their provider's next night takes
// them. The steps every night needs (the check dates, the digest) still run, within the rest of the day's writes.

/** The KV writes and deletes a night's page checks may take: the rest of the day's 1,000 is left for the API's. */
export const writesPerNight = 600;

/**
 * The requests to KV a part (a Workflow instance) starts a step with at most: an instance may make 1,000 to Cloudflare's
 * services (KV, D1, Workers AI, Browser Rendering), and part 33 of 2026-11-25 passed them. A step takes a few hundred at
 * most (the tidying's: 200 entries read in two, and as many deletes), and the rest is left for D1's and the AI's.
 */
export const kvCallsPerPart = 500;

/** Counts the KV writes and deletes of the step running now, and the part's requests to KV. */
export class Writes {
  /** The writes and deletes the step running now has made. */
  used = 0;
  /** The part's requests to KV, every kind: reads, lists, writes and deletes. */
  calls = 0;

  /** A step starts. */
  start(): void {
    this.used = 0;
  }

  /** `kv`, with its writes and deletes counted. */
  count(kv: KvLike): KvLike {
    return {
      get: (key) => {
        this.calls++;
        return kv.get(key);
      },
      getMany: (keys) => {
        this.calls++;
        return kv.getMany(keys);
      },
      list: (options) => {
        this.calls++;
        return kv.list(options);
      },
      put: (key, value, options) => {
        this.used++;
        this.calls++;
        return kv.put(key, value, options);
      },
      delete: (key) => {
        this.used++;
        this.calls++;
        return kv.delete(key);
      },
    };
  }
}

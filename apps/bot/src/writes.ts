import type { KvLike } from './state';

// The KV writes a night makes (BLUEPRINT §6.4). On the free plan the whole account has 1,000 KV writes a day (and
// 1,000 deletes), which the API shares: its icons, FX rates and price reports. The night of 2026-11-24 used them all
// within 20 minutes, so the night counts its writes and deletes, step by step, and once writesPerNight are spent its
// remaining page checks wait for another night: pages it didn't check stay due, so their provider's next night takes
// them. The steps every night needs (the check dates, the digest) still run, within the rest of the day's writes.

/** The KV writes and deletes a night's page checks may take: the rest of the day's 1,000 is left for the API's. */
export const writesPerNight = 600;

/** Thrown before a step that may wait (a page check) once the night's writes are spent: it's left for another night. */
export class OutOfWrites extends Error {
  constructor() {
    super('The night has used its KV writes');
    this.name = 'OutOfWrites';
  }
}

/** Counts the KV writes and deletes of the step running now. */
export class Writes {
  /** The writes and deletes the step running now has made. */
  used = 0;

  /** A step starts. */
  start(): void {
    this.used = 0;
  }

  /** `kv`, with its writes and deletes counted. */
  count(kv: KvLike): KvLike {
    return {
      get: (key) => kv.get(key),
      list: (options) => kv.list(options),
      put: (key, value, options) => {
        this.used++;
        return kv.put(key, value, options);
      },
      delete: (key) => {
        this.used++;
        return kv.delete(key);
      },
    };
  }
}

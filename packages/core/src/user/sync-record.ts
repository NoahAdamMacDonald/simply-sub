import * as z from 'zod';
import { base64Schema, recordIdSchema, timestampSchema } from './record';

/** The longest name a device can have. */
export const maxDeviceNameLength = 60;

/** What can stop sync on a device until the user acts: the chain was deleted, it needs a newer app, or won't open. */
export const syncProblemSchema = z.enum(['gone', 'newer', 'unopenable']);
export type SyncProblem = z.infer<typeof syncProblemSchema>;

/**
 * Sync on this device (PROJECT-PLAN M10.9, BLUEPRINT §11.4): one record, under the key `sync`, while sync is on. It
 * holds the code, the user's secret, so the app lock seals it, and nothing of it is backed up or synced. The keys come
 * from the code each time; the server never sees it.
 */
export const syncRecordSchema = z.strictObject({
  key: z.literal('sync'),
  /** The chain's code: 32 bytes, as base64. */
  seed: base64Schema.refine((seed) => seed.length === 44, 'Use 32 bytes as base64'),
  /** This device on the chain: an id made when sync was turned on here, and the name the user gave it. */
  deviceId: recordIdSchema,
  deviceName: z.string().trim().min(1).max(maxDeviceNameLength),
  /** The chain's version this device last read or wrote: its next write names it (If-Match). */
  version: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .optional(),
  /** When this device last synced. */
  syncedAt: timestampSchema.optional(),
  /** What stopped sync here, until the user acts on it. */
  problem: syncProblemSchema.optional(),
  updatedAt: timestampSchema,
});
export type SyncRecord = z.infer<typeof syncRecordSchema>;

/** A name for this device from its browser's user agent: "Edge on Windows", "Safari on iPhone", or "This browser". */
export function defaultDeviceName(userAgent: string): string {
  const browser = /Edg(e|A|iOS)?\//.test(userAgent)
    ? 'Edge'
    : /Firefox\/|FxiOS\//.test(userAgent)
      ? 'Firefox'
      : /SamsungBrowser\//.test(userAgent)
        ? 'Samsung Internet'
        : /Chrome\/|CriOS\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : undefined;
  const system = /iPhone/.test(userAgent)
    ? 'iPhone'
    : /iPad/.test(userAgent)
      ? 'iPad'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(userAgent)
            ? 'Mac'
            : /CrOS/.test(userAgent)
              ? 'ChromeOS'
              : /Linux/.test(userAgent)
                ? 'Linux'
                : undefined;
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? (system ? `A browser on ${system}` : 'This browser');
}

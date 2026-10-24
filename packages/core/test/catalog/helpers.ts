import type { z } from 'zod';

/** Each issue as `path: message`, for example `plans.0.prices.0.currency: Use a three-letter …`. */
export function issues(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

/** A deep copy of `value` with the key at `path` set, or removed when `newValue` is undefined. */
export function withValue(
  value: unknown,
  path: readonly (string | number)[],
  newValue: unknown,
): unknown {
  const copy: unknown = JSON.parse(JSON.stringify(value));
  const parent = path
    .slice(0, -1)
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], copy);
  const record = parent as Record<string | number, unknown>;
  const last = path[path.length - 1];
  if (newValue === undefined) {
    delete record[last];
  } else {
    record[last] = newValue;
  }
  return copy;
}

/** Reads a nested value from parsed JSON. */
export function at(value: unknown, ...path: (string | number)[]): unknown {
  return path.reduce<unknown>(
    (node, key) => (node as Record<string | number, unknown>)?.[key],
    value,
  );
}

/**
 * The start of a PNG of the given size: the signature and the IHDR chunk, which is all the icon code reads, plus
 * `padding` bytes to make the file larger.
 */
export function pngBytes(width: number, height: number, padding = 0): Uint8Array {
  const bytes = new Uint8Array(33 + padding);
  const view = new DataView(bytes.buffer);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24); // 8-bit RGBA; the CRC after it is left as zeros
  return bytes;
}

/** ASCII text as bytes (core has no TextEncoder: it's a DOM and Node API). */
export function asciiBytes(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

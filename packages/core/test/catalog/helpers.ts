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

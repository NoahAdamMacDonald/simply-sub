import type { z } from 'zod';

/** Adds an issue for every value that already appeared earlier in `values`, at the path `pathOf` gives it. */
export function addDuplicateIssues(
  ctx: z.RefinementCtx,
  values: readonly string[],
  pathOf: (index: number) => PropertyKey[],
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: 'custom',
        message: `"${value}" is listed more than once`,
        path: pathOf(index),
      });
    }
    seen.add(value);
  });
}

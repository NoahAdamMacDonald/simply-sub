import type { z } from 'zod';

// Small helpers shared by the schemas and validateCatalog.

/** The index of every value that already appeared earlier in `values`. */
export function repeatedIndexes(values: readonly string[]): number[] {
  const seen = new Set<string>();
  return values.flatMap((value, index) => {
    const repeated = seen.has(value);
    seen.add(value);
    return repeated ? [index] : [];
  });
}

/** The `id` of a parsed YAML object, before it has been checked against a schema. */
export function idOf(item: unknown): string | undefined {
  if (typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'string') {
    return item.id;
  }
  return undefined;
}

export function listedMoreThanOnce(value: string): string {
  return `"${value}" is listed more than once`;
}

/** Adds an issue for every value that already appeared earlier in `values`, at the path `pathOf` gives it. */
export function addDuplicateIssues(
  ctx: z.RefinementCtx,
  values: readonly string[],
  pathOf: (index: number) => PropertyKey[],
): void {
  for (const index of repeatedIndexes(values)) {
    ctx.addIssue({
      code: 'custom',
      message: listedMoreThanOnce(values[index]),
      path: pathOf(index),
    });
  }
}

/**
 * The end of a message about a value that isn't one of `candidates`: ` (a, b, c)` when there are only a few,
 * else the closest one as ` (did you mean b?)`.
 */
export function choices(value: string, candidates: readonly string[]): string {
  return candidates.length > 0 && candidates.length <= 12
    ? ` (${candidates.join(', ')})`
    : didYouMean(value, candidates);
}

/** ` (did you mean b?)` when a candidate looks like a typo of `value`, else ` (${otherwise})` or nothing. */
export function didYouMean(
  value: string,
  candidates: readonly string[],
  otherwise?: string,
): string {
  const closest = closestMatch(value, candidates);
  if (closest !== undefined) {
    return ` (did you mean ${closest}?)`;
  }
  return otherwise === undefined ? '' : ` (${otherwise})`;
}

/**
 * The candidate that looks like a typo of `value`, or undefined when none does. A typo is a few edits away: at most
 * a third of the value's length, and at least one. The first of equally close candidates wins.
 */
export function closestMatch(value: string, candidates: readonly string[]): string | undefined {
  const limit = Math.max(1, Math.floor(value.length / 3));
  let closest: string | undefined;
  let closestDistance = limit + 1;
  for (const candidate of candidates) {
    // The lengths alone put it this many edits away, so most candidates skip the full comparison.
    if (Math.abs(candidate.length - value.length) >= closestDistance) {
      continue;
    }
    const distance = editDistance(value, candidate);
    if (distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }
  return closest;
}

/** The Levenshtein distance: the fewest insertions, deletions and substitutions that turn `a` into `b`. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min(previous[j] + 1, current[j - 1] + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length];
}

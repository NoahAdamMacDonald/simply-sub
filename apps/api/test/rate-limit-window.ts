/**
 * Waits for the next minute when this one has less than 3 s left. The tests' Rate Limiting bindings are miniflare's,
 * which count in windows aligned to the wall clock's minutes (its ratelimit-object.worker.js), so a burst of requests
 * that ran into the next minute would find its count started again: a limit that holds most of the time fails now and
 * then. A burst after this has 3 s or more, and takes under one; the wait stays within a test's 5 s.
 */
export async function freshRateLimitWindow(): Promise<void> {
  const left = 60_000 - (Date.now() % 60_000);
  if (left < 3_000) await new Promise((resolve) => setTimeout(resolve, left + 50));
}

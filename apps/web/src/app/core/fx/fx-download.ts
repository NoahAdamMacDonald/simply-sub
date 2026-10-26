import { fxBodySchema, type FxRates } from '@simply-sub/core';

// Loaded by FxStore on its first fetch, as a chunk of its own, so the schema it checks the rates with stays out of
// the initial bundle.

/** How long a request may take before the server counts as out of reach. */
const requestTimeout = 30_000;

/**
 * GET /fx's rates in `currency`, or undefined when they're the rates the app has already (same base, date and
 * rates), or can't be had: offline, or the Worker answers with an error (Frankfurter down with nothing kept). The
 * browser's cache answers until /fx's max-age runs out, so most calls send nothing.
 */
export async function fetchRates(
  currency: string,
  current: FxRates | undefined,
): Promise<FxRates | undefined> {
  let response: Response;
  try {
    response = await fetch(`api/v1/fx?base=${encodeURIComponent(currency)}`, {
      signal: AbortSignal.timeout(requestTimeout),
    });
  } catch {
    // Offline: the stored rates serve.
    return undefined;
  }
  if (!response.ok) {
    console.warn(`Exchange rates for ${currency} aren't available: ${response.status}`);
    return undefined;
  }
  const { data } = fxBodySchema.parse(await response.json());
  if (data.base !== currency) {
    throw new Error(`Asked for rates in ${currency}, got ${data.base}`);
  }
  return current && sameRates(current, data) ? undefined : data;
}

function sameRates(a: FxRates, b: FxRates): boolean {
  return (
    a.base === b.base && a.date === b.date && JSON.stringify(a.rates) === JSON.stringify(b.rates)
  );
}

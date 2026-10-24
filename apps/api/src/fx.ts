import {
  ecbRatesUrl,
  fxFreshFor,
  fxFreshSeconds,
  keptEcbRatesSchema,
  readEcbRates,
  type EcbRates,
  type KeptEcbRates,
} from '@simply-sub/core';

// The ECB's exchange rates for GET /fx and, from M2.3, GET /providers (BLUEPRINT §5.2, §7.1). KV keeps the last
// good rates under one key, in euros, and core's rebaseRates gives them in any base, so one fetch from Frankfurter
// every 12 hours serves every currency: about two KV writes a day.

const kvKey = 'fx:ecb';
/** How long Frankfurter gets to answer before the kept rates are used instead. */
const timeoutMs = 5000;

export interface Rates {
  ecb: KeptEcbRates;
  /** True when Frankfurter failed and these are the last good rates. */
  stale: boolean;
  /** How many more seconds the rates are fresh for: 0 when they're stale. */
  freshFor: number;
}

/**
 * The rates KV keeps while they're fresh, else new ones from Frankfurter, which replace them. When Frankfurter
 * fails, the last good rates come back marked stale, or undefined when there are none. `now` is an ISO 8601
 * timestamp in UTC, to the second.
 */
export async function ecbRates(env: Env, now: string): Promise<Rates | undefined> {
  const kept = keptEcbRatesSchema.safeParse(parsedJson(await env.KV.get(kvKey)));
  const freshFor = kept.success ? fxFreshFor(kept.data.fetchedAt, now) : 0;
  if (kept.success && freshFor > 0) {
    return { ecb: kept.data, stale: false, freshFor };
  }
  const fetched = await fetchEcbRates();
  if (fetched) {
    const ecb: KeptEcbRates = { ...fetched, fetchedAt: now };
    await env.KV.put(kvKey, JSON.stringify(ecb));
    return { ecb, stale: false, freshFor: fxFreshSeconds };
  }
  return kept.success ? { ecb: kept.data, stale: true, freshFor: 0 } : undefined;
}

/** Today's rates from Frankfurter, or undefined when it fails, times out or answers with anything else. */
async function fetchEcbRates(): Promise<EcbRates | undefined> {
  try {
    const response = await fetch(ecbRatesUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel();
      console.warn(`Frankfurter answered HTTP ${response.status}.`);
      return undefined;
    }
    const rates = readEcbRates(await response.json());
    if (!rates) {
      console.warn("Frankfurter's answer isn't one day's ECB rates.");
    }
    return rates;
  } catch (error) {
    console.warn(`Frankfurter didn't answer: ${error instanceof Error ? error.name : 'unknown'}.`);
    return undefined;
  }
}

function parsedJson(text: string | null): unknown {
  try {
    return text === null ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

import {
  exchangeRate,
  normalized,
  type FxRates,
  type ProviderMatch,
  type ProvidersQuery,
  type SnapshotProvider,
} from '@simply-sub/core';
import { providerOf } from './lookups';

// GET /providers' pages sorted from the cheapest with no text, category or feature (M11.8, shape 5, BLUEPRINT §5.3).
// Core sorts matches by the shown plan's lowest monthly equivalent in the query's currency, then by name, then by id
// (searchProviders). provider_prices holds each provider's lowest monthly equivalent in each currency it's priced in,
// so converted at that currency's rate, the lowest of them is a bound its price can't be below. A page walks each
// currency's rows from the cheapest, the first n of each, through the table's key, and reads the n providers whose
// bounds come first, all before where the walks stopped: a provider not read can't come before the next one's bound,
// so the matches before it are every match there is, in core's order. When they're fewer than the page needs, the
// walks go four times as far, and after a few rounds every provider is read. So a page parses about twice the matches
// it needs and reads n rows of each currency, whatever the catalog's size. A currency's walk is a statement of its
// own in one batch: D1 takes 5 terms at most in a compound SELECT, and counts a batch as one query of the 50 a
// request may make.
//
// Not from the dearest: core sorts that on the shown plan, the cheapest, so a provider's highest price is no bound
// that ends a walk early, and such a page reads every provider.

/** How far the first walk goes in each currency, at least: twice the matches the page needs. */
const firstWalk = 32;

/** The rounds that walk before every provider is read. */
const walkRounds = 3;

/** How far a bound and core's converted price can differ: a few units in the last place, from rounding. */
const margin = 1e-9;

/** The longest list of ids a read inlines: D1 takes statements up to 100 KB. Past it, every provider is read. */
const maxIdList = 90_000;

export interface PricePageOptions {
  /** The currencies provider_prices may hold: the catalog row's. */
  currencies: readonly string[];
  /** How many providers the build has: the catalog row's count. */
  providers: number;
  /** The rates core picks prices with, in the query's currency. */
  fx: FxRates;
  /** The matches the page needs: those before it, its own, and the next for its cursor. */
  window: number;
  /** Core's searchProviders on the providers read, in the request's context. */
  search: (providers: SnapshotProvider[]) => ProviderMatch[];
}

export interface PricePage {
  /** The catalog version D1 holds. Undefined before the first seed. */
  version?: string;
  /** The matches in core's order, up to where the walks stopped: at least `window` when there are that many. */
  matches: ProviderMatch[];
  /** What the reads cost, as D1 bills them. */
  rowsRead: number;
  /** How many rounds walked: 0 when every provider was read at once. */
  rounds: number;
  /** How many providers the last read parsed. */
  providersRead: number;
}

/** A row a walk read: a provider's lowest monthly equivalent in a currency. */
interface WalkRow {
  low: number;
  name: string;
  provider_id: string;
}

/** A name and id, as SQLite orders them. */
interface Tie {
  name: string;
  id: string;
}

/** Where a page stops: no provider it didn't read comes before it. */
interface Cut {
  /** The bound no provider not read is below. */
  bound: number;
  /** At a bound of 0 (free plans): the name and id no free provider not read comes before. */
  tie?: Tie;
}

/** Each provider walked, with its bound from the rows walked. */
type Walked = Map<string, { bound: number; name: string }>;

/** A page of `query`'s matches sorted from the cheapest, reading only the providers it needs. */
export async function loadPricePage(
  db: D1Database,
  query: ProvidersQuery,
  options: PricePageOptions,
): Promise<PricePage> {
  const target = query.currency ?? '';
  // A currency with no rate is shown as it is (core's pickPrice), so it compares as 1 to 1.
  const factors = options.currencies
    .filter((currency) => /^[A-Z]{3}$/.test(currency))
    .map((currency) => ({ currency, factor: exchangeRate(currency, target, options.fx) ?? 1 }));
  let rowsRead = 0;
  let rounds = 0;
  for (
    let n = Math.max(firstWalk, 2 * options.window);
    rounds < walkRounds && n < options.providers;
    n *= 4
  ) {
    rounds++;
    const [before, ...walks] = await db.batch([
      db.prepare(markSql),
      ...factors.map(({ currency }) => db.prepare(walkSql(currency, n))),
    ]);
    rowsRead += [before, ...walks].reduce((sum, result) => sum + result.meta.rows_read, 0);
    const walked = walkedOf(
      factors.map(({ factor }, at) => ({ factor, rows: (walks[at]?.results ?? []) as WalkRow[] })),
      n,
    );
    // Every currency walked to its end: everything is read below.
    if (!walked) break;
    const { cut, ids } = nearest(walked.cut, walked.providers, n);
    const list = ids.map(sqlText).join(', ');
    if (list.length > maxIdList) break;
    const [after, read] = await db.batch([
      db.prepare(markSql),
      db.prepare(`SELECT search AS json FROM providers WHERE id IN (${list})`),
    ]);
    rowsRead += after.meta.rows_read + read.meta.rows_read;
    // A seed wrote between the reads: they may not describe one catalog.
    if (JSON.stringify(before.results) !== JSON.stringify(after.results)) break;
    const known = options.search(read.results.map(providerOf)).filter((match) => {
      const price = match.plans[0].bestMonthlyEquivalent ?? 0;
      return comesFirst(price, normalized(match.provider.name), match.provider.id, cut, margin);
    });
    // Past maxPrice, which core compares to the cent, no provider not read can match.
    const past = query.maxPrice !== undefined && cut.bound * (1 - margin) >= query.maxPrice + 0.01;
    if (known.length >= options.window || past) {
      const version = (after.results[0] as { version: string } | undefined)?.version;
      return {
        ...(version !== undefined && { version }),
        matches: known,
        rowsRead,
        rounds,
        providersRead: read.results.length,
      };
    }
  }
  const [catalog, everyone] = await db.batch([
    db.prepare('SELECT version FROM catalog'),
    db.prepare('SELECT search AS json FROM providers'),
  ]);
  const version = (catalog.results[0] as { version: string } | undefined)?.version;
  return {
    ...(version !== undefined && { version }),
    matches: options.search(everyone.results.map(providerOf)),
    rowsRead: rowsRead + catalog.meta.rows_read + everyone.meta.rows_read,
    rounds,
    providersRead: everyone.results.length,
  };
}

/** What a seed changes in the catalog row with every write. */
const markSql = 'SELECT version, waiting, written_on, written FROM catalog';

/**
 * The first `n` rows of a currency from the cheapest, through provider_prices' key: ties by name as core breaks
 * them.
 */
export function walkSql(currency: string, n: number): string {
  return `SELECT low, name, provider_id FROM provider_prices WHERE currency = ${sqlText(currency)} ORDER BY low, name, provider_id LIMIT ${n}`;
}

/**
 * Each provider the walks read, with its bound, and where they stopped: the lowest of each currency's nth row,
 * converted, with the name and id there for a tie at 0. Undefined when every currency was walked to its end.
 */
function walkedOf(
  walks: readonly { factor: number; rows: readonly WalkRow[] }[],
  n: number,
): { cut: Cut; providers: Walked } | undefined {
  const providers: Walked = new Map();
  let cut: { bound: number; tie: Tie } | undefined;
  for (const { factor, rows } of walks) {
    for (const row of rows) {
      const bound = row.low * factor;
      const found = providers.get(row.provider_id);
      if (!found || bound < found.bound) providers.set(row.provider_id, { bound, name: row.name });
    }
    // Fewer than n: the currency's rows end there, and every provider priced in it was walked.
    if (rows.length < n) continue;
    const last = rows.reduce((a, b) =>
      b.low > a.low ||
      (b.low === a.low && compareText(b.name, b.provider_id, a.name, a.provider_id) > 0)
        ? b
        : a,
    );
    const here = { bound: last.low * factor, tie: { name: last.name, id: last.provider_id } };
    if (
      !cut ||
      here.bound < cut.bound ||
      (here.bound === cut.bound &&
        compareText(here.tie.name, here.tie.id, cut.tie.name, cut.tie.id) < 0)
    ) {
      cut = here;
    }
  }
  return cut && { cut, providers };
}

/**
 * The `budget` providers walked whose bounds come first, all before `cut`, and the cut moved up to the next one's
 * bound (at 0, to the last one's name and id), which no provider not among them comes before.
 */
function nearest(cut: Cut, walked: Walked, budget: number): { cut: Cut; ids: string[] } {
  const first = [...walked]
    .filter(([id, { bound, name }]) => comesFirst(bound, name, id, cut))
    .sort(
      ([a, x], [b, y]) =>
        x.bound - y.bound || (x.bound === 0 ? compareText(x.name, a, y.name, b) : 0),
    );
  const ids = first.slice(0, budget).map(([id]) => id);
  const next = first[budget]?.[1];
  const last = first[budget - 1];
  if (!next || !last) return { cut, ids };
  return {
    cut: {
      bound: next.bound,
      ...(next.bound === 0 && { tie: { name: last[1].name, id: last[0] } }),
    },
    ids,
  };
}

/**
 * Whether a provider with this price (or bound) comes before `cut` in core's order, so it's certain to be in its
 * place. With `slack`, a price core converted, which can differ from a bound by rounding. A tie at 0 is decided by
 * name as SQLite ordered the walk, which is core's order when the name at the cut is all below U+D800.
 */
function comesFirst(price: number, name: string, id: string, cut: Cut, slack = 0): boolean {
  if (price < cut.bound * (1 - slack)) return true;
  return (
    cut.bound === 0 &&
    price === 0 &&
    cut.tie !== undefined &&
    !/[\uD800-￿]/.test(cut.tie.name) &&
    compareText(name, id, cut.tie.name, cut.tie.id) <= 0
  );
}

/** SQLite's order for a name and id: by code point (UTF-8's bytes), which JavaScript's < isn't past U+D7FF. */
function compareText(name: string, id: string, otherName: string, otherId: string): number {
  return codePoints(name, otherName) || codePoints(id, otherId);
}

function codePoints(a: string, b: string): number {
  const [x, y] = [[...a], [...b]];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const difference = (x[i].codePointAt(0) ?? 0) - (y[i].codePointAt(0) ?? 0);
    if (difference !== 0) return difference;
  }
  return x.length - y.length;
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

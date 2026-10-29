import * as z from 'zod';

// Web search for the discovery pipeline (BLUEPRINT §6.5): the last way to find a provider's page, when its common
// paths, sitemaps and links didn't. Three engines behind one interface, tried in order, each until its monthly budget
// is spent (the user's choice in M3): Tavily (its free plan, 1,000 searches a month and no card), then Brave (a card
// on file and $5 of credit a month, about 1,000 searches, so its budget stays under that), then SearXNG (a
// metasearch engine you run yourself: free, with no budget). Core builds each request and reads each answer; the
// scripts and the bot send them, with keys from .env or Worker secrets, never from the repository.

export const searchEngineSchema = z.enum(['tavily', 'brave', 'searxng']);
export type SearchEngine = z.infer<typeof searchEngineSchema>;

/** One result: where it goes and what the engine says about it. */
export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

/** A request to send with fetch. */
export interface SearchRequest {
  url: string;
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string };
}

/** What an engine needs: Tavily's and Brave's keys, SearXNG's address (an https URL of your own instance). */
export interface SearchAccess {
  key?: string;
  base?: string;
}

/** The most results a search asks for: the first few are where an official page is, if anywhere. */
export const searchResultCount = 8;

/**
 * The request for `query`, in Canadian English where the engine takes a region, or undefined when the engine isn't
 * set up (no key, or no SearXNG address).
 */
export function searchRequest(
  engine: SearchEngine,
  query: string,
  access: SearchAccess,
): SearchRequest | undefined {
  switch (engine) {
    case 'tavily':
      return access.key
        ? {
            url: 'https://api.tavily.com/search',
            init: {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${access.key}`,
                'Content-Type': 'application/json',
              },
              // basic: one credit a search (advanced costs two).
              body: JSON.stringify({
                query,
                max_results: searchResultCount,
                search_depth: 'basic',
                country: 'canada',
                include_answer: false,
              }),
            },
          }
        : undefined;
    case 'brave':
      return access.key
        ? {
            url: `https://api.search.brave.com/res/v1/web/search?${queryString({
              q: query,
              count: String(searchResultCount),
              country: 'CA',
              search_lang: 'en',
            })}`,
            init: {
              method: 'GET',
              headers: { Accept: 'application/json', 'X-Subscription-Token': access.key },
            },
          }
        : undefined;
    case 'searxng': {
      const base = access.base?.replace(/\/+$/, '');
      return base && /^https?:\/\/[^/\s]+/.test(base)
        ? {
            url: `${base}/search?${queryString({ q: query, format: 'json', language: 'en-CA' })}`,
            init: { method: 'GET', headers: { Accept: 'application/json' } },
          }
        : undefined;
    }
  }
}

const tavilyAnswer = z.object({
  results: z.array(
    z.object({ url: z.string(), title: z.string().optional(), content: z.string().optional() }),
  ),
});
const braveAnswer = z.object({
  web: z
    .object({
      results: z.array(
        z.object({
          url: z.string(),
          title: z.string().optional(),
          description: z.string().optional(),
        }),
      ),
    })
    .optional(),
});
const searxngAnswer = z.object({
  results: z.array(
    z.object({ url: z.string(), title: z.string().optional(), content: z.string().optional() }),
  ),
});

/** The results in an engine's JSON answer, in its order; an answer of another shape has none. */
export function readSearchResults(engine: SearchEngine, json: unknown): SearchResult[] {
  const results =
    engine === 'brave'
      ? (braveAnswer.safeParse(json).data?.web?.results ?? []).map((result) => ({
          url: result.url,
          title: result.title ?? '',
          snippet: result.description ?? '',
        }))
      : (
          (engine === 'tavily' ? tavilyAnswer : searxngAnswer).safeParse(json).data?.results ?? []
        ).map((result) => ({
          url: result.url,
          title: result.title ?? '',
          snippet: result.content ?? '',
        }));
  return results.filter((result) => /^https?:\/\//.test(result.url));
}

/** An engine and its monthly budget: undefined means no limit (your own SearXNG). */
export interface SearchBudget {
  engine: SearchEngine;
  monthly?: number;
}

/**
 * The engine the next search goes to: the first, in order, that's set up and has budget left this month, or undefined
 * when none has. `used` counts this month's searches by engine.
 */
export function nextSearchEngine(
  budgets: readonly SearchBudget[],
  used: Readonly<Partial<Record<SearchEngine, number>>>,
  configured: (engine: SearchEngine) => boolean,
): SearchEngine | undefined {
  return budgets.find(
    ({ engine, monthly }) =>
      configured(engine) && (monthly === undefined || (used[engine] ?? 0) < monthly),
  )?.engine;
}

/**
 * A query string, as application/x-www-form-urlencoded writes it (spaces as +), without URLSearchParams: core
 * type-checks without DOM or Node APIs.
 */
export function queryString(values: Readonly<Record<string, string>>): string {
  const encode = (text: string) => encodeURIComponent(text).replace(/%20/g, '+');
  return Object.entries(values)
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .join('&');
}

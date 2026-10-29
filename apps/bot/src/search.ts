import {
  nextSearchEngine,
  readSearchResults,
  searchRequest,
  type SearchAccess,
  type SearchBudget,
  type SearchEngine,
  type SearchResult,
} from '@simply-sub/core';

// The bot's web search (BLUEPRINT §6.5, M3.11): core's engines in data/automation.yaml's order (Tavily, then Brave,
// then SearXNG), each until the bot's monthly budget there is spent, counted in KV by month. Their keys are Worker
// secrets (TAVILY_API_KEY, BRAVE_API_KEY, SEARXNG_URL), never in the repository: an engine without one is skipped.

/** This month's searches, by engine. */
export type Searches = Partial<Record<SearchEngine, number>>;

/** Where this month's searches are counted. */
export interface SearchCounter {
  used(): Promise<Searches>;
  count(engine: SearchEngine): Promise<void>;
}

/** The search the discovery uses, or undefined when no engine is set up. */
export function botSearch(
  budgets: readonly SearchBudget[],
  access: Readonly<Partial<Record<SearchEngine, SearchAccess>>>,
  counter: SearchCounter,
  fetcher: typeof fetch = fetch,
): ((query: string) => Promise<SearchResult[] | undefined>) | undefined {
  const configured = (engine: SearchEngine) =>
    searchRequest(engine, 'test', access[engine] ?? {}) !== undefined;
  if (!budgets.some(({ engine }) => configured(engine))) return undefined;
  return async (query) => {
    const engine = nextSearchEngine(budgets, await counter.used(), configured);
    if (!engine) return undefined;
    const request = searchRequest(engine, query, access[engine] ?? {});
    if (!request) return undefined;
    // Counted before it's sent: a search that fails may still have been charged.
    await counter.count(engine);
    try {
      const response = await fetcher(request.url, {
        ...request.init,
        signal: AbortSignal.timeout(20_000),
      });
      return response.ok ? readSearchResults(engine, await response.json()) : [];
    } catch {
      return [];
    }
  };
}

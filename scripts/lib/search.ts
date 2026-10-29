// Web search for the pipeline's scripts (BLUEPRINT §6.5, M3.2): core's engines (Tavily, then Brave, then SearXNG),
// each until this machine's monthly budget in data/automation.yaml (M3.8) is spent. Keys come from the environment or
// the gitignored .env at the repository's root (TAVILY_API_KEY, BRAVE_API_KEY, SEARXNG_URL), never from the
// repository. Each search is counted in .pipeline/search-usage.json, by month and engine.
import {
  automationSchema,
  nextSearchEngine,
  searchBudgets,
  readSearchResults,
  searchRequest,
  type SearchAccess,
  type SearchBudget,
  type SearchEngine,
  type SearchResult,
} from '@simply-sub/core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { repoRoot } from './catalog-files';

/** What this machine may search a month, by engine: its share in data/automation.yaml. */
export async function localSearchBudgets(): Promise<SearchBudget[]> {
  const text = await readFile(fileURLToPath(new URL('data/automation.yaml', repoRoot)), 'utf8');
  return searchBudgets(automationSchema.parse(parse(text)), 'local');
}

const usageFile = fileURLToPath(new URL('.pipeline/search-usage.json', repoRoot));

/** Loads .env from the repository's root into process.env, when it's there. */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL('.env', repoRoot)));
  } catch {
    // No .env: the environment has what there is.
  }
}

function access(engine: SearchEngine): SearchAccess {
  switch (engine) {
    case 'tavily':
      return { key: process.env['TAVILY_API_KEY'] };
    case 'brave':
      return { key: process.env['BRAVE_API_KEY'] };
    case 'searxng':
      return { base: process.env['SEARXNG_URL'] };
  }
}

/**
 * The search the pipeline uses, or undefined when no engine is set up. It answers undefined once every engine's
 * budget is spent this month, and an empty list when an engine fails (the next search tries again).
 */
export function webSearch(
  budgets: readonly SearchBudget[],
): ((query: string) => Promise<SearchResult[] | undefined>) | undefined {
  loadDotEnv();
  const configured = (engine: SearchEngine) =>
    searchRequest(engine, 'test', access(engine)) !== undefined;
  if (!budgets.some(({ engine }) => configured(engine))) return undefined;
  return async (query) => {
    const month = new Date().toISOString().slice(0, 7);
    const usage = await readUsage();
    const used = usage[month] ?? {};
    const engine = nextSearchEngine(budgets, used, configured);
    if (!engine) return undefined;
    const request = searchRequest(engine, query, access(engine));
    if (!request) return undefined;
    // Counted before it's sent: a search that fails may still have been charged.
    used[engine] = (used[engine] ?? 0) + 1;
    usage[month] = used;
    await writeUsage(usage);
    try {
      const response = await fetch(request.url, {
        ...request.init,
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        console.warn(`${engine} search answered ${response.status}: "${query}"`);
        return [];
      }
      return readSearchResults(engine, await response.json());
    } catch {
      console.warn(`${engine} search failed: "${query}"`);
      return [];
    }
  };
}

type Usage = Record<string, Partial<Record<SearchEngine, number>>>;

async function readUsage(): Promise<Usage> {
  try {
    return JSON.parse(await readFile(usageFile, 'utf8')) as Usage;
  } catch {
    return {};
  }
}

async function writeUsage(usage: Usage): Promise<void> {
  await mkdir(dirname(usageFile), { recursive: true });
  await writeFile(usageFile, `${JSON.stringify(usage, null, 2)}\n`);
}

import type { SearchEngine } from '@simply-sub/core';
import { describe, expect, it } from 'vitest';
import { botSearch, type Searches } from '../src/search';

// The bot's search (M3.11): each engine in data/automation.yaml's order until its monthly budget is spent, counted
// before it's sent, and none without its secret.

function counter() {
  const used: Searches = {};
  return {
    used,
    counter: {
      used: async () => ({ ...used }),
      count: async (engine: SearchEngine) => void (used[engine] = (used[engine] ?? 0) + 1),
    },
  };
}

/** Each engine's answer, as its API gives it, and the engines asked, in order. */
function fakeEngines(failing: SearchEngine[] = []) {
  const asked: SearchEngine[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const engine: SearchEngine = url.startsWith('https://api.tavily.com')
      ? 'tavily'
      : url.startsWith('https://api.search.brave.com')
        ? 'brave'
        : 'searxng';
    asked.push(engine);
    if (failing.includes(engine)) return new Response('busy', { status: 503 });
    const result = { url: `https://example.com/${engine}`, title: engine };
    return Response.json(
      engine === 'brave' ? { web: { results: [result] } } : { results: [result] },
    );
  }) as typeof fetch;
  return { asked, fetcher };
}

const access = {
  tavily: { key: 'tvly-test' },
  brave: { key: 'brave-test' },
  searxng: { base: 'https://searx.example' },
};

describe('botSearch', () => {
  it('uses each engine in order until its budget is spent', async () => {
    const { used, counter: count } = counter();
    const { asked, fetcher } = fakeEngines();
    const search = botSearch(
      [{ engine: 'tavily', monthly: 2 }, { engine: 'brave', monthly: 1 }, { engine: 'searxng' }],
      access,
      count,
      fetcher,
    );
    for (let time = 0; time < 5; time++) await search?.('streamco pricing');
    expect(asked).toEqual(['tavily', 'tavily', 'brave', 'searxng', 'searxng']);
    expect(used).toEqual({ tavily: 2, brave: 1, searxng: 2 });
    expect(await search?.('streamco pricing')).toEqual([
      { url: 'https://example.com/searxng', title: 'searxng', snippet: '' },
    ]);
  });

  it('skips an engine without its secret, and says when none is left this month', async () => {
    const { counter: count } = counter();
    const { asked, fetcher } = fakeEngines();
    const search = botSearch(
      [{ engine: 'tavily', monthly: 1 }, { engine: 'brave', monthly: 1 }, { engine: 'searxng' }],
      { brave: access.brave },
      count,
      fetcher,
    );
    expect(await search?.('a')).toHaveLength(1);
    expect(await search?.('b')).toBeUndefined();
    expect(asked).toEqual(['brave']);
    expect(botSearch([{ engine: 'tavily', monthly: 1 }], {}, count, fetcher)).toBeUndefined();
  });

  it('counts a search that failed, and finds nothing with it', async () => {
    const { used, counter: count } = counter();
    const { fetcher } = fakeEngines(['tavily']);
    const search = botSearch([{ engine: 'tavily', monthly: 5 }], access, count, fetcher);
    expect(await search?.('a')).toEqual([]);
    expect(used).toEqual({ tavily: 1 });
  });
});

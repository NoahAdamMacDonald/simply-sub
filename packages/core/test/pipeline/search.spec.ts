import { describe, expect, it } from 'vitest';
import { nextSearchEngine, queryString, readSearchResults, searchRequest } from '../../src';

describe('searchRequest', () => {
  it('asks Tavily for a basic search in Canada, with the key in a header', () => {
    const request = searchRequest('tavily', 'Netflix plans pricing Canada', { key: 'tvly-123' });
    expect(request?.url).toBe('https://api.tavily.com/search');
    expect(request?.init.method).toBe('POST');
    expect(request?.init.headers['Authorization']).toBe('Bearer tvly-123');
    expect(JSON.parse(request?.init.body ?? '')).toEqual({
      query: 'Netflix plans pricing Canada',
      max_results: 8,
      search_depth: 'basic',
      country: 'canada',
      include_answer: false,
    });
  });

  it('asks Brave in Canadian English, with its subscription token', () => {
    const request = searchRequest('brave', 'how to cancel Crave', { key: 'brv' });
    expect(request?.url).toBe(
      'https://api.search.brave.com/res/v1/web/search?q=how+to+cancel+Crave&count=8&country=CA&search_lang=en',
    );
    expect(request?.init.headers).toEqual({
      Accept: 'application/json',
      'X-Subscription-Token': 'brv',
    });
  });

  it('asks your SearXNG for JSON', () => {
    expect(
      searchRequest('searxng', 'Proton bundle', { base: 'https://search.example.org/' })?.url,
    ).toBe('https://search.example.org/search?q=Proton+bundle&format=json&language=en-CA');
  });

  it('is undefined for an engine that isn’t set up', () => {
    expect(searchRequest('tavily', 'x', {})).toBeUndefined();
    expect(searchRequest('brave', 'x', { key: '' })).toBeUndefined();
    expect(searchRequest('searxng', 'x', { base: 'not a url' })).toBeUndefined();
  });
});

describe('readSearchResults', () => {
  it("reads each engine's results", () => {
    expect(
      readSearchResults('tavily', {
        results: [{ url: 'https://a.example', title: 'A', content: 'about A', score: 0.9 }],
      }),
    ).toEqual([{ url: 'https://a.example', title: 'A', snippet: 'about A' }]);
    expect(
      readSearchResults('brave', {
        web: { results: [{ url: 'https://b.example', title: 'B', description: 'about B' }] },
      }),
    ).toEqual([{ url: 'https://b.example', title: 'B', snippet: 'about B' }]);
    expect(
      readSearchResults('searxng', { results: [{ url: 'https://c.example', title: 'C' }] }),
    ).toEqual([{ url: 'https://c.example', title: 'C', snippet: '' }]);
  });

  it('has no results in an answer of another shape, or that aren’t web addresses', () => {
    expect(readSearchResults('brave', { error: 'quota' })).toEqual([]);
    expect(
      readSearchResults('tavily', { results: [{ url: 'javascript:alert(1)', title: 'x' }] }),
    ).toEqual([]);
  });
});

describe('nextSearchEngine', () => {
  const budgets = [
    { engine: 'tavily', monthly: 2 },
    { engine: 'brave', monthly: 1 },
    { engine: 'searxng' },
  ] as const;
  const all = () => true;

  it('takes the first engine with budget left, in order', () => {
    expect(nextSearchEngine(budgets, {}, all)).toBe('tavily');
    expect(nextSearchEngine(budgets, { tavily: 2 }, all)).toBe('brave');
    expect(nextSearchEngine(budgets, { tavily: 2, brave: 1 }, all)).toBe('searxng');
  });

  it('skips an engine that isn’t set up, and has none once every budget is spent', () => {
    expect(nextSearchEngine(budgets, {}, (engine) => engine !== 'tavily')).toBe('brave');
    expect(nextSearchEngine(budgets.slice(0, 2), { tavily: 2, brave: 1 }, all)).toBeUndefined();
  });
});

describe('queryString', () => {
  it('encodes like a form, with spaces as +', () => {
    expect(queryString({ q: 'a b&c=d', n: '1' })).toBe('q=a+b%26c%3Dd&n=1');
  });
});

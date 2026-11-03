import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  providerSearchText,
  providersBody,
  providerTextQuery,
  rankKeyOptions,
  readCatalogSource,
  readProvidersQuery,
  searchProviderOf,
  searchProviders,
  withPlanFeatures,
  type SnapshotProvider,
} from '../../src';
import { catalog, today } from '../catalog/catalog-files';

// What GET /providers reads in D1 since shape 4 (M11.8): the slim search JSON must give the same results as the full
// one, and the FTS5 index must find every provider searchProviders matches, whatever the text.

const data = buildCatalogData(readCatalogSource(catalog()), 'https://sub.simplely.ca/icons/');
const { features, categories } = data;
const context = { features, categories, today };
const rates = {
  base: 'CAD',
  date: today,
  source: 'test',
  rates: { USD: 0.73, EUR: 0.64, GBP: 0.56 },
};

/** The API's body for `params` over these providers, as D1 gives them (provider-wide features merged). */
function body(providers: readonly SnapshotProvider[], params: Record<string, string>) {
  const read = readProvidersQuery(
    Object.fromEntries(Object.entries(params).map(([key, value]) => [key, [value]])),
    { features, categories, currencies: ['CAD', 'USD', 'EUR', 'GBP'] },
  );
  if ('problems' in read) throw new Error(JSON.stringify(read.problems));
  const matches = searchProviders(providers.map(withPlanFeatures), read.query, {
    ...context,
    ...(read.query.region !== undefined && { fx: rates }),
  });
  return providersBody(matches, {
    query: read.query,
    offset: read.offset,
    catalogVersion: 'abc1234',
  });
}

/** Every word and name the registry and the providers have, and parts of them: the texts to search for. */
const vocabulary = (() => {
  const names = new Set<string>();
  for (const provider of data.providers) {
    [provider.name, ...(provider.aliases ?? [])].forEach((name) => names.add(name));
    provider.plans.forEach((plan) => names.add(plan.name));
  }
  for (const feature of features) {
    [feature.name, ...(feature.aliases ?? [])].forEach((name) => names.add(name));
    rankKeyOptions(feature).forEach((option) =>
      [option.name, ...option.aliases].forEach((name) => names.add(name)),
    );
  }
  categories.service.forEach((category) => names.add(category.name));
  const texts = new Set<string>();
  for (const name of names) {
    texts.add(name);
    for (const word of name.toLowerCase().split(/\s+/)) {
      texts.add(word);
      if (word.length > 4) texts.add(word.slice(1, -1));
      texts.add(`${word}s`);
    }
  }
  return [...texts].filter((text) => text.trim() !== '');
})();

/** The providers an FTS5 trigram MATCH of `expression` finds: each AND group has a phrase in the provider's text. */
function ftsFinds(expression: string, texts: ReadonlyMap<string, string>): Set<string> {
  const groups = expression
    .split(' AND ')
    .map((group) =>
      [...group.matchAll(/"((?:[^"]|"")*)"/g)].map(([, phrase]) => phrase.replaceAll('""', '"')),
    );
  return new Set(
    [...texts]
      .filter(([, text]) =>
        groups.every((phrases) => phrases.some((phrase) => text.includes(phrase))),
      )
      .map(([id]) => id),
  );
}

describe('the search JSON (M11.8)', () => {
  const slim = data.providers.map(searchProviderOf);

  it('leaves out what only a card shows', () => {
    const mullvad = slim.find((provider) => provider.id === 'mullvad');
    expect(Object.keys(mullvad ?? {})).not.toContain('notes');
    expect(Object.keys(mullvad ?? {})).not.toContain('owner');
    expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(data.providers).length);
  });

  it.each([
    {},
    { region: 'CA' },
    { region: 'US', currency: 'USD', sort: 'price_desc' },
    { region: 'DE', currency: 'EUR' },
    { category: 'vpn' },
    { q: 'netflix' },
    { q: 'vpn', region: 'CA' },
    { q: '4k', region: 'CA', sort: 'price_asc' },
    { feature: 'video.quality=1080p', region: 'CA' },
    { region: 'CA', interval: 'year' },
    { sort: 'features' },
  ])('gives the same body as the full JSON for %o', (params) => {
    expect(body(slim, params as Record<string, string>)).toEqual(
      body(data.providers, params as Record<string, string>),
    );
  });
});

describe('the FTS5 index (M11.8)', () => {
  const texts = new Map(
    data.providers.map((provider) => [
      provider.id,
      providerSearchText(provider, features, categories),
    ]),
  );

  it('finds every provider the text matches, for every name, word and part of one', () => {
    let checked = 0;
    for (const q of vocabulary) {
      const expression = providerTextQuery(q, { features, categories });
      if (expression === undefined) continue;
      checked++;
      const found = ftsFinds(expression, texts);
      const matched = body(data.providers, { q }).data.map((result) => result.provider.id);
      expect({ q, missed: matched.filter((id) => !found.has(id)) }).toEqual({ q, missed: [] });
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('finds them for two words at once', () => {
    const words = vocabulary.filter((text) => !text.includes(' ')).slice(0, 40);
    for (const first of words) {
      for (const second of words.slice(0, 10)) {
        const q = `${first} ${second}`;
        const expression = providerTextQuery(q, { features, categories });
        if (expression === undefined) continue;
        const found = ftsFinds(expression, texts);
        const matched = body(data.providers, { q }).data.map((result) => result.provider.id);
        expect({ q, missed: matched.filter((id) => !found.has(id)) }).toEqual({ q, missed: [] });
      }
    }
  });

  it('asks for every term, as any of its forms, quoted', () => {
    expect(providerTextQuery('Netflix VPNs', { features, categories })).toBe(
      '("netflix") AND ("vpns" OR "vpn")',
    );
  });

  it('leaves a text with a form under three characters to a full search', () => {
    expect(providerTextQuery('4k', { features, categories })).toBeUndefined();
    expect(providerTextQuery('  ', { features, categories })).toBeUndefined();
  });

  it('names what the provider can be found by, a tab between each', () => {
    const netflix = texts.get('netflix')?.split('\t') ?? [];
    expect(netflix[0]).toBe('netflix');
    expect(netflix).toContain('video quality');
  });
});

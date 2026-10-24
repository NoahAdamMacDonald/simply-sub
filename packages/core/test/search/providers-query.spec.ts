import { describe, expect, it } from 'vitest';
import {
  providersCursor,
  readCatalogSource,
  readProvidersQuery,
  type QueryContext,
} from '../../src';
import { catalog } from '../catalog/catalog-files';

const { features, categories } = readCatalogSource(catalog());
const context: QueryContext = { features, categories };

/** A query string's parameters, as Hono's c.req.queries() gives them. Core has no URLSearchParams. */
function queries(search: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const pair of search.split('&').filter(Boolean)) {
    const at = pair.indexOf('=');
    const key = decodeURIComponent(at < 0 ? pair : pair.slice(0, at));
    (result[key] ??= []).push(at < 0 ? '' : decodeURIComponent(pair.slice(at + 1)));
  }
  return result;
}

function read(search: string, more: Partial<QueryContext> = {}) {
  return readProvidersQuery(queries(search), { ...context, ...more });
}

function problems(search: string, more: Partial<QueryContext> = {}) {
  const result = read(search, more);
  return 'problems' in result ? result.problems : [];
}

describe('readProvidersQuery', () => {
  it('sorts by name, 20 a page, with nothing given', () => {
    expect(read('')).toEqual({ query: { sort: 'name', limit: 20 }, offset: 0 });
  });

  it("sorts by price with a region, in the region's currency", () => {
    expect(read('region=CA')).toEqual({
      query: { region: 'CA', currency: 'CAD', sort: 'price_asc', limit: 20 },
      offset: 0,
    });
  });

  it('sorts by relevance with text, which it trims', () => {
    expect(read('q=%20%20proton%20%20vpn%20&region=CA&currency=USD')).toEqual({
      query: { q: 'proton vpn', region: 'CA', currency: 'USD', sort: 'relevance', limit: 20 },
      offset: 0,
    });
  });

  it("shows US dollars where the ECB has no rate for the region's currency", () => {
    expect(read('region=AE', { currencies: ['CAD', 'EUR', 'USD'] })).toMatchObject({
      query: { region: 'AE', currency: 'USD' },
    });
    expect(read('region=EU', { currencies: ['CAD', 'EUR', 'USD'] })).toMatchObject({
      query: { region: 'EU', currency: 'EUR' },
    });
  });

  it("lists meta.query's keys in the contract's order, whatever order they came in", () => {
    const result = read(
      'limit=3&sort=price_asc&nativeOnly=true&currency=CAD&region=CA&interval=month&maxPrice=20&minPrice=5&feature=video.quality%3D4k&category=streaming&q=tv',
    );

    expect('query' in result && Object.keys(result.query)).toEqual([
      'q',
      'category',
      'feature',
      'minPrice',
      'maxPrice',
      'interval',
      'region',
      'currency',
      'nativeOnly',
      'sort',
      'limit',
    ]);
    expect(result).toMatchObject({
      query: {
        feature: ['video.quality=4k'],
        minPrice: 5,
        maxPrice: 20,
        nativeOnly: true,
        limit: 3,
      },
    });
  });

  it('reads comma-separated rank keys once each', () => {
    expect(
      read('feature=video.quality%3D4k,%20streaming.ad-free,video.quality%3D4k'),
    ).toMatchObject({
      query: { feature: ['video.quality=4k', 'streaming.ad-free'] },
    });
  });

  it('reads a cursor back as the offset it points at', () => {
    expect(read(`cursor=${providersCursor(40)}`)).toMatchObject({ offset: 40 });
  });

  it("refuses the contract's invalid example, in the order the parameters came", () => {
    expect(problems('sort=cheapest&limit=500')).toEqual([
      {
        param: 'sort',
        issue: 'Expected one of: relevance, price_asc, price_desc, name, features.',
      },
      { param: 'limit', issue: 'Must be between 1 and 50.' },
    ]);
  });

  it.each([
    [
      'page=2',
      'page',
      'Unknown parameter. GET /providers takes q, category, feature, minPrice, maxPrice, interval, region, currency, nativeOnly, sort, cursor and limit.',
    ],
    ['region=CA&region=US', 'region', 'Give one value.'],
    [
      'feature=streaming.ad-free&feature=vpn.included',
      'feature',
      'Give one feature parameter, with the rank keys separated by commas.',
    ],
    ['q=%20', 'q', 'Must not be empty: leave q out to list every provider.'],
    [`q=${'a'.repeat(101)}`, 'q', 'Use at most 100 characters.'],
    [
      'category=streming',
      'category',
      '"streming" isn\'t a service category (streaming, vpn, privacy-suite).',
    ],
    ['feature=', 'feature', 'List at least one rank key, such as video.quality=4k.'],
    [
      'feature=vpn.include',
      'feature',
      '"vpn.include" isn\'t a feature (did you mean vpn.included?).',
    ],
    [
      'feature=streaming.ad-free%3Dyes',
      'feature',
      'streaming.ad-free is a boolean feature, which has no values: use streaming.ad-free alone.',
    ],
    [
      'feature=video.quality',
      'feature',
      'video.quality needs a value: video.quality=480p (480p, 720p, 1080p, 4k).',
    ],
    [
      'feature=video.quality%3D8k,vpn.devices%3D11%2B',
      'feature',
      '"8k" isn\'t a video.quality value (480p, 720p, 1080p, 4k); "11+" isn\'t a vpn.devices tier (1-5, 6-10).',
    ],
    ['feature=includes-subscription', 'feature', 'includes-subscription has no rank keys.'],
    ['feature=storage.cloud', 'feature', 'storage.cloud has no rank keys.'],
    ['minPrice=-1&region=CA', 'minPrice', 'Use an amount of 0 or more, such as 9.99.'],
    ['maxPrice=ten&region=CA', 'maxPrice', 'Use an amount of 0 or more, such as 9.99.'],
    ['interval=monthly', 'interval', 'Expected one of: day, week, month, year.'],
    [
      'region=UK',
      'region',
      '"UK" isn\'t an ISO 3166-1 region code: use GB for the United Kingdom.',
    ],
    [
      'region=CA&currency=cad',
      'currency',
      'Use a three-letter ISO 4217 currency code in capitals (CAD).',
    ],
    ['region=CA&nativeOnly=yes', 'nativeOnly', 'Use true or false.'],
    [
      'cursor=abc',
      'cursor',
      'Not a cursor from meta.nextCursor: leave it out to start at the first page.',
    ],
    ['limit=0', 'limit', 'Must be between 1 and 50.'],
    ['limit=2.5', 'limit', 'Must be between 1 and 50.'],
    ['sort=relevance', 'sort', 'relevance needs q, the text to match.'],
    [
      'sort=price_desc',
      'sort',
      'price_desc needs region: prices are picked for a region, such as CA.',
    ],
    ['region=CA&minPrice=20&maxPrice=10', 'minPrice', 'Must not be more than maxPrice.'],
  ])('refuses %s', (search, param, issue) => {
    expect(problems(search)).toEqual([{ param, issue }]);
  });

  it('refuses each price parameter without a region', () => {
    expect(problems('minPrice=1&maxPrice=9&currency=CAD&nativeOnly=true')).toEqual(
      ['minPrice', 'maxPrice', 'currency', 'nativeOnly'].map((param) => ({
        param,
        issue: 'Needs region: prices are picked for a region, such as CA.',
      })),
    );
  });

  it('refuses a currency there are no rates for, listing the ones there are', () => {
    expect(problems('region=CA&currency=AED', { currencies: ['CAD', 'EUR', 'USD'] })).toEqual([
      { param: 'currency', issue: 'The ECB has no rate for AED: use one of CAD, EUR, USD.' },
    ]);
  });

  it('refuses more than 10 rank keys', () => {
    const keys = ['480p', '720p', '1080p', '4k'].map((value) => `video.quality=${value}`);
    const many = [
      ...keys,
      'streaming.ad-free',
      'vpn.included',
      'vpn.unlimited-traffic',
      'vpn.devices=1-5',
      'vpn.devices=6-10',
      'streaming.live=sports',
      'streaming.live=tv-channels',
    ];

    expect(problems(`feature=${encodeURIComponent(many.join(','))}`)).toEqual([
      { param: 'feature', issue: 'List at most 10 rank keys.' },
    ]);
  });
});

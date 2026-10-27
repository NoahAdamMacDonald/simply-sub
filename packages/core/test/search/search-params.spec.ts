import { describe, expect, it } from 'vitest';
import {
  readCatalogSource,
  readSearchParams,
  sameSearchParams,
  searchText,
  writeSearchParams,
  type CatalogQuery,
  type QueryParams,
} from '../../src';
import { catalog } from '../catalog/catalog-files';

// The fixture catalog's registry (catalog-files.ts): video.quality, streaming.ad-free, streams, live TV, the VPN
// features, and the streaming, vpn and privacy-suite service categories.

const registry = readCatalogSource(catalog());

function read(params: QueryParams): CatalogQuery {
  return readSearchParams(params, registry);
}

describe('readSearchParams', () => {
  it("reads P8's URL into Search's query", () => {
    expect(
      read({
        q: 'netflix',
        sort: 'price_desc',
        min: '5',
        max: '20.5',
        cat: 'streaming',
        f: 'video.quality=4k,streaming.ad-free',
        act: 'active,none',
        native: '1',
      }),
    ).toEqual({
      q: 'netflix',
      sort: 'price_desc',
      category: 'streaming',
      features: ['video.quality=4k', 'streaming.ad-free'],
      minPrice: 5,
      maxPrice: 20.5,
      activity: ['active', 'not-listed'],
      nativeOnly: true,
    });
  });

  it('reads nothing from no parameters', () => {
    expect(read({})).toEqual({});
  });

  it('drops what isn’t valid in the catalog, and any parameter it doesn’t know', () => {
    expect(
      read({
        q: '   ',
        sort: 'cheapest',
        cat: 'fitness',
        f: 'video.quality=8k,streaming.ad-free=yes,includes-subscription=netflix,nope,vpn.included',
        act: 'gone,inactive',
        native: 'true',
        min: '-5',
        max: '1e3',
        addTo: 'some-list',
      }),
    ).toEqual({ features: ['vpn.included'], activity: ['inactive'] });
    expect(read({ min: 'abc', max: '' })).toEqual({});
  });

  it('keeps Best match only with text', () => {
    expect(read({ sort: 'relevance' })).toEqual({});
    expect(read({ q: 'vpn', sort: 'relevance' })).toEqual({ q: 'vpn', sort: 'relevance' });
    expect(read({ sort: 'price_asc' })).toEqual({ sort: 'price_asc' });
  });

  it('reads a minimum of 0 as none, and drops a range whose minimum is above its maximum', () => {
    expect(read({ min: '0', max: '20' })).toEqual({ maxPrice: 20 });
    expect(read({ min: '0' })).toEqual({});
    expect(read({ max: '0' })).toEqual({ maxPrice: 0 });
    expect(read({ min: '25', max: '20' })).toEqual({});
    expect(read({ min: '20', max: '20' })).toEqual({ minPrice: 20, maxPrice: 20 });
  });

  it('trims the text, joins repeated lists, keeps the first of anything else, and lists each value once', () => {
    expect(
      read({
        q: ['  proton   vpn ', 'netflix'],
        f: ['video.quality=4k', 'streaming.ad-free, video.quality=4k'],
        act: ['none', 'active', 'none'],
        cat: ['vpn', 'streaming'],
      }),
    ).toEqual({
      q: 'proton vpn',
      category: 'vpn',
      features: ['video.quality=4k', 'streaming.ad-free'],
      // Activity in the panel's order.
      activity: ['active', 'not-listed'],
    });
  });
});

describe('Sold in', () => {
  it('reads sold=1 and sold=0, else the user’s default', () => {
    expect(read({ sold: '1' })).toEqual({ soldOnly: true });
    expect(read({ sold: '0' })).toEqual({});
    expect(read({ sold: 'yes' })).toEqual({});
    expect(readSearchParams({}, registry, { soldOnly: true })).toEqual({ soldOnly: true });
    expect(readSearchParams({ sold: '0' }, registry, { soldOnly: true })).toEqual({});
    expect(readSearchParams({ sold: 'yes' }, registry, { soldOnly: true })).toEqual({
      soldOnly: true,
    });
  });

  it('writes sold only when it differs from the default, last', () => {
    expect(writeSearchParams({ soldOnly: true })).toEqual({ sold: '1' });
    expect(writeSearchParams({})).toEqual({});
    expect(writeSearchParams({ soldOnly: true }, { soldOnly: true })).toEqual({});
    expect(writeSearchParams({}, { soldOnly: true })).toEqual({ sold: '0' });
    expect(Object.keys(writeSearchParams({ q: 'vpn', nativeOnly: true, soldOnly: true }))).toEqual([
      'q',
      'native',
      'sold',
    ]);
  });

  it('reads back what it writes, for either default', () => {
    for (const defaults of [{}, { soldOnly: true }]) {
      for (const query of [{ q: 'vpn' }, { q: 'vpn', soldOnly: true }]) {
        expect(readSearchParams(writeSearchParams(query, defaults), registry, defaults)).toEqual(
          query,
        );
      }
    }
  });
});

describe('writeSearchParams', () => {
  it("writes P8's parameters in its order", () => {
    const params = writeSearchParams({
      nativeOnly: true,
      activity: ['not-listed', 'active'],
      features: ['video.quality=4k', 'streaming.ad-free'],
      category: 'streaming',
      maxPrice: 20,
      minPrice: 5,
      sort: 'price_desc',
      q: 'netflix',
    });

    expect(Object.entries(params)).toEqual([
      ['q', 'netflix'],
      ['sort', 'price_desc'],
      ['min', '5'],
      ['max', '20'],
      ['cat', 'streaming'],
      ['f', 'video.quality=4k,streaming.ad-free'],
      ['act', 'active,none'],
      ['native', '1'],
    ]);
  });

  it('leaves out what’s empty, off or the default', () => {
    expect(
      writeSearchParams({
        q: '  ',
        sort: 'relevance',
        minPrice: 0,
        features: [],
        activity: [],
        nativeOnly: false,
      }),
    ).toEqual({});
    expect(writeSearchParams({ maxPrice: 0 })).toEqual({ max: '0' });
  });

  it('writes amounts to the cent, and the text trimmed', () => {
    expect(writeSearchParams({ q: ' proton  vpn ', minPrice: 9.999, maxPrice: 10.5 })).toEqual({
      q: 'proton vpn',
      min: '10',
      max: '10.5',
    });
  });

  it('writes what it reads, so a URL it wrote reads back the same', () => {
    const query: CatalogQuery = {
      q: 'vpn',
      sort: 'relevance',
      category: 'vpn',
      features: ['vpn.devices=6-10', 'vpn.included'],
      minPrice: 2.5,
      maxPrice: 12,
      activity: ['inactive', 'not-listed'],
      nativeOnly: true,
    };
    expect(read(writeSearchParams(query))).toEqual(query);

    const messy = { q: ' vpn ', sort: 'relevance', f: 'nope,vpn.included', min: '0', x: '1' };
    const written = writeSearchParams(read(messy));
    expect(written).toEqual({ q: 'vpn', sort: 'relevance', f: 'vpn.included' });
    expect(writeSearchParams(read(written))).toEqual(written);
  });
});

describe('sameSearchParams', () => {
  it('is true only for exactly the parameters written', () => {
    const written = { q: 'vpn', f: 'vpn.included' };

    expect(sameSearchParams({ f: 'vpn.included', q: 'vpn' }, written)).toBe(true);
    expect(sameSearchParams({ q: 'vpn', f: 'vpn.included', page: undefined }, written)).toBe(true);
    expect(sameSearchParams({ q: 'vpn' }, written)).toBe(false);
    expect(sameSearchParams({ q: 'vpn', f: 'vpn.included', addTo: 'x' }, written)).toBe(false);
    expect(sameSearchParams({ q: ['vpn', 'vpn'], f: 'vpn.included' }, written)).toBe(false);
    expect(sameSearchParams({ q: 'vpn ', f: 'vpn.included' }, written)).toBe(false);
    expect(sameSearchParams({}, {})).toBe(true);
  });
});

describe('searchText', () => {
  it('trims the text and keeps single spaces', () => {
    expect(searchText('  netflix \t 4k  ')).toBe('netflix 4k');
    expect(searchText('   ')).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import {
  combineCandidates,
  pickWebsite,
  readWikidataResults,
  wikidataClasses,
  wikidataQuery,
} from '../../src';

/** A row of the query service's JSON answer. */
function row(qid: string, name: string, sitelinks: number, websites: string[]) {
  return {
    item: { type: 'uri', value: `http://www.wikidata.org/entity/${qid}` },
    name: { 'xml:lang': 'en', type: 'literal', value: name },
    sitelinks: {
      datatype: 'http://www.w3.org/2001/XMLSchema#integer',
      type: 'literal',
      value: String(sitelinks),
    },
    websites: { type: 'literal', value: websites.join(' ') },
  };
}

describe('wikidataClasses', () => {
  it('names each class once, with a service category', () => {
    const ids = wikidataClasses.map(({ qid }) => qid);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { qid, category } of wikidataClasses) {
      expect(qid).toMatch(/^Q\d+$/);
      expect(category).toMatch(/^[a-z-]+$/);
    }
  });
});

describe('wikidataQuery', () => {
  it("asks for one class's instances with a website, most written-about first", () => {
    const query = wikidataQuery('Q56240391', 40, 8);
    expect(query).toContain('wdt:P31 wd:Q56240391');
    expect(query).toContain('wdt:P856 ?website');
    expect(query).toContain('FILTER(?sitelinks >= 8)');
    expect(query).toContain('FILTER NOT EXISTS { ?item wdt:P576 [] }');
    expect(query).toContain('ORDER BY DESC(?sitelinks) ?item');
    expect(query).toMatch(/LIMIT 40$/);
  });

  it('refuses anything but an item id, so nothing else reaches the query', () => {
    expect(() => wikidataQuery('Q1 } DELETE', 10, 0)).toThrow('Not a Wikidata item id');
  });
});

describe('readWikidataResults', () => {
  it('turns rows into queue candidates of the category', () => {
    const json = {
      head: { vars: ['item', 'name', 'sitelinks', 'websites'] },
      results: {
        bindings: [
          row('Q689141', 'Spotify', 104, ['https://www.spotify.com', 'https://open.spotify.com/']),
          row('Q20056642', 'Apple Music', 58, [
            'https://music.apple.com/us',
            'https://www.apple.com/music',
          ]),
          // No usable website: left out.
          row('Q1', 'Nowhere', 50, ['http://abc.onion/']),
          // No name to make an id from: left out.
          row('Q2', '???', 50, ['https://example.com']),
        ],
      },
    };
    expect(readWikidataResults(json, 'music')).toEqual([
      {
        id: 'spotify',
        name: 'Spotify',
        website: 'https://www.spotify.com',
        category: 'music',
        wikidata: 'Q689141',
        sitelinks: 104,
      },
      {
        id: 'apple-music',
        name: 'Apple Music',
        website: 'https://music.apple.com/us',
        category: 'music',
        wikidata: 'Q20056642',
        sitelinks: 58,
      },
    ]);
  });

  it('refuses an answer that is not SPARQL results', () => {
    expect(() => readWikidataResults({ error: 'timeout' }, 'music')).toThrow('SPARQL JSON results');
  });
});

describe('pickWebsite', () => {
  it("prefers a host with the name's words over an unrelated one", () => {
    expect(
      pickWebsite(
        ['https://www.ytubeapk.com', 'https://www.youtube.com/premium'],
        'YouTube Premium',
      ),
    ).toBe('https://www.youtube.com/premium');
    expect(
      pickWebsite(
        ['https://www.amazon.co.jp/gp/video/storefront', 'https://www.primevideo.com/'],
        'Amazon Prime Video',
      ),
    ).toBe('https://www.primevideo.com');
  });

  it('prefers the home page, then the shortest, and makes it https', () => {
    expect(pickWebsite(['https://nordvpn.com/ja/', 'http://nordvpn.com/'], 'NordVPN')).toBe(
      'https://nordvpn.com',
    );
    expect(pickWebsite(['https://www.netflix.com/', 'https://netflix.com/'], 'Netflix')).toBe(
      'https://netflix.com',
    );
  });

  it('drops queries, fragments and onion services', () => {
    expect(pickWebsite(['https://example.org/?ref=wd#x', 'http://abcdef.onion/'], 'Example')).toBe(
      'https://example.org',
    );
    expect(pickWebsite(['http://abcdef.onion/'], 'Example')).toBeUndefined();
  });
});

describe('combineCandidates', () => {
  it("keeps each item once, with the first class's category, most written-about first", () => {
    const tv = [
      {
        id: 'netflix',
        name: 'Netflix',
        website: 'https://netflix.com',
        category: 'streaming',
        wikidata: 'Q907311',
        sitelinks: 144,
      },
      {
        id: 'tubi',
        name: 'Tubi',
        website: 'https://tubitv.com',
        category: 'streaming',
        wikidata: 'Q3',
        sitelinks: 12,
      },
    ];
    const music = [
      {
        id: 'spotify',
        name: 'Spotify',
        website: 'https://www.spotify.com',
        category: 'music',
        wikidata: 'Q689141',
        sitelinks: 104,
      },
      {
        id: 'netflix',
        name: 'Netflix',
        website: 'https://netflix.com',
        category: 'music',
        wikidata: 'Q907311',
        sitelinks: 144,
      },
      {
        id: 'plex',
        name: 'Plex',
        website: 'https://plex.tv',
        category: 'music',
        wikidata: 'Q4',
        sitelinks: 12,
      },
    ];
    expect(combineCandidates([tv, music]).map(({ id, category }) => `${id} ${category}`)).toEqual([
      'netflix streaming',
      'spotify music',
      'tubi streaming',
      'plex music',
    ]);
  });
});

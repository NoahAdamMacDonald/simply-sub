import { describe, expect, it } from 'vitest';
import {
  hreflangCountry,
  parseWebAddress,
  pathCountry,
  regionalPages,
  regionalVariants,
  regionalRefusal,
  regionBrowser,
  segmentCountry,
  wentToAnotherCountry,
} from '../../src';

// Regional pricing pages (M10.12): locales mapped to countries, a page's pages for other countries, and a page read for
// a region that turned out to be another's.

describe('locales', () => {
  it('reads the country of an hreflang value, never a language alone', () => {
    expect(hreflangCountry('en-GB')).toBe('GB');
    expect(hreflangCountry('en-uk')).toBe('GB');
    expect(hreflangCountry('zh-Hant-TW')).toBe('TW');
    expect(hreflangCountry('uk-UA')).toBe('UA');
    // Ukrainian, a language alone, a part of the world, the default.
    for (const value of ['uk', 'en', 'es-419', 'x-default']) {
      expect(hreflangCountry(value)).toBeUndefined();
    }
  });

  it('reads the country of a locale path segment, the UK’s uk included', () => {
    expect(segmentCountry('en-gb')).toBe('GB');
    expect(segmentCountry('en_GB')).toBe('GB');
    expect(segmentCountry('uk')).toBe('GB');
    expect(segmentCountry('au')).toBe('AU');
    expect(segmentCountry('fr-ca')).toBe('CA');
    expect(segmentCountry('de-de')).toBe('DE');
    // Spotify's way round: the country first.
    expect(segmentCountry('ca-en')).toBe('CA');
    for (const segment of ['de', 'fr', 'tv', 'pricing', 'en']) {
      expect(segmentCountry(segment)).toBeUndefined();
    }
  });

  it('finds a URL’s country in its first two path segments', () => {
    expect(pathCountry('https://www.example.com/en-gb/pricing')).toBe('GB');
    expect(pathCountry('https://www.example.com/uk/plans')).toBe('GB');
    expect(pathCountry('https://help.example.com/hc/en-au/articles/1')).toBe('AU');
    expect(pathCountry('https://www.example.com/pricing')).toBeUndefined();
  });
});

describe('regionalPages', () => {
  // Core has no URL parser: absolute links, and paths from the page's host, are all these pages have.
  const resolve = (href: string, base: string) => {
    if (/^https?:\/\//.test(href)) return href;
    const host = parseWebAddress(base)?.host;
    return host && href.startsWith('/') ? `https://${host}${href}` : undefined;
  };

  it('takes a page’s hreflang links, made absolute, each country once', () => {
    const html = `
      <link rel="alternate" hreflang="en-ca" href="https://www.example.com/en-ca/pricing">
      <link rel="alternate" hreflang="en-GB" href="/en-gb/pricing">
      <link hreflang="en-gb" rel="alternate" href="/en-gb/other">
      <link rel="alternate" hreflang="x-default" href="/pricing">
      <link rel="alternate" hreflang="de" href="/de/pricing">
      <link rel="stylesheet" hreflang="en-au" href="/au.css">`;
    expect([...regionalPages(html, 'https://www.example.com/en-ca/pricing', resolve)]).toEqual([
      ['CA', 'https://www.example.com/en-ca/pricing'],
      ['GB', 'https://www.example.com/en-gb/pricing'],
    ]);
  });

  it('takes links to the same path under another country’s locale, on the same host', () => {
    const html = `
      <a href="/en-au/pricing">Australia</a>
      <a href="https://www.example.com/uk/pricing">United Kingdom</a>
      <a href="/en-nz/plans">New Zealand, another page</a>
      <a href="https://elsewhere.com/en-ie/pricing">Another site</a>`;
    expect([...regionalPages(html, 'https://www.example.com/pricing', resolve)]).toEqual([
      ['AU', 'https://www.example.com/en-au/pricing'],
      ['GB', 'https://www.example.com/uk/pricing'],
    ]);
    expect([...regionalPages(html, 'https://www.example.com/en-ca/pricing', resolve)].length).toBe(
      2,
    );
  });
});

describe('a page read for a region', () => {
  const read = (final: string, currencies: string[] = ['GBP']) => ({
    requested: 'https://www.example.com/en-gb/pricing',
    final,
    currencies,
  });

  it('is refused when it went to another country’s page, or was one', () => {
    expect(regionalRefusal('GB', read('https://www.example.com/en-us/pricing'))).toBe(
      "It went to US's page (https://www.example.com/en-us/pricing), not GB's.",
    );
    expect(
      regionalRefusal('GB', {
        requested: 'https://www.example.com/en-au/pricing',
        final: 'https://www.example.com/en-au/pricing',
        currencies: ['AUD'],
      }),
    ).toBe("Its address is AU's page, not GB's.");
    expect(regionalRefusal('GB', read('https://www.example.com/en-gb/pricing'))).toBeUndefined();
  });

  it('is refused when its prices are only in another country’s currency', () => {
    expect(regionalRefusal('GB', read('https://www.example.com/pricing', ['CAD']))).toBe(
      'Its prices are in CAD, not GBP: the site may price by where the visitor is.',
    );
    expect(
      regionalRefusal('GB', read('https://www.example.com/pricing', ['USD', 'GBP'])),
    ).toBeUndefined();
    // No prices to tell by.
    expect(regionalRefusal('GB', read('https://www.example.com/pricing', []))).toBeUndefined();
    // A bare $ is never pounds, and can be Australia's dollar.
    expect(regionalRefusal('GB', read('https://www.example.com/pricing', ['dollar']))).toBe(
      'Its prices are in dollars, not GBP: the site may price by where the visitor is.',
    );
    expect(
      regionalRefusal('AU', {
        requested: 'https://www.example.com/pricing',
        final: 'https://www.example.com/pricing',
        currencies: ['dollar'],
      }),
    ).toBeUndefined();
  });

  it('is guessed from a country in another page’s address, segment or slug', () => {
    expect(regionalVariants('https://help.netflix.com/en/node/24926/ca', 'GB')).toEqual([
      'https://help.netflix.com/en/node/24926/gb',
      'https://help.netflix.com/en/node/24926/uk',
    ]);
    expect(regionalVariants('https://www.xbox.com/en-US/xbox-game-pass', 'AU')).toEqual([
      'https://www.xbox.com/en-AU/xbox-game-pass',
    ]);
    expect(
      regionalVariants('https://help.disneyplus.com/article/disneyplus-en-ca-price', 'AU'),
    ).toEqual(['https://help.disneyplus.com/article/disneyplus-en-au-price']);
    expect(regionalVariants('https://open.spotify.com/ca-en/premium', 'NZ')).toEqual([
      'https://open.spotify.com/nz-en/premium',
    ]);
    // Nothing to swap, or the region's already.
    expect(regionalVariants('https://www.example.com/pricing', 'GB')).toEqual([]);
    expect(regionalVariants('https://www.example.com/en-gb/pricing', 'GB')).toEqual([]);
  });

  it('counts for the nightly check as unread when it went to another country', () => {
    const asked = 'https://www.example.com/en-gb/pricing';
    expect(wentToAnotherCountry(asked, 'https://www.example.com/en-us/pricing')).toBe(true);
    expect(wentToAnotherCountry(asked, 'https://www.example.com/pricing')).toBe(true);
    expect(wentToAnotherCountry(asked, 'https://www.example.com/en-gb/pricing/')).toBe(false);
    // A page with no country in its address can't tell.
    expect(
      wentToAnotherCountry(
        'https://www.example.com/pricing',
        'https://www.example.com/en-us/pricing',
      ),
    ).toBe(false);
  });

  it('is read in English as spoken there, in its time zone', () => {
    expect(regionBrowser('GB')).toEqual({
      locale: 'en-GB',
      acceptLanguage: 'en-GB,en;q=0.9',
      timeZone: 'Europe/London',
    });
    expect(regionBrowser('ZZ')).toBeUndefined();
  });
});

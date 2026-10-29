import { describe, expect, it } from 'vitest';
import {
  comparable,
  excerpt,
  missingQuotes,
  moneyIn,
  nameIndexes,
  pageShows,
  pageText,
  parseRobots,
  robotsAllow,
  sameCurrency,
  taxWording,
} from '@simply-sub/core';
import netflixCa from './fixtures/netflix-ca.html?raw';

describe('pageText', () => {
  it('keeps what a page shows: no scripts, styles or comments, entities decoded', () => {
    const text = pageText(netflixCa);
    expect(text).toContain('Standard: $18.99 / month');
    expect(text).toContain('Prices don’t include sales tax.');
    expect(text).not.toContain('first month');
    expect(text).not.toContain('$1.00');
    expect(text).not.toContain('font-weight');
    expect(pageText('<p>Fish&nbsp;&amp;&#32;chips &#x20AC;5 &euro;6</p>')).toBe(
      'Fish & chips €5 €6',
    );
  });

  it('compares words in any quotes, dashes, case and spacing', () => {
    expect(comparable('Since March 2020, we’ve  partnered — “Inet”')).toBe(
      'since march 2020, we\'ve partnered - "inet"',
    );
  });

  it('cuts the parts around the names out of a long page', () => {
    const text = `${'x'.repeat(5000)} Standard $18.99 ${'y'.repeat(5000)}`;
    const found = nameIndexes(text, ['standard']);
    expect(found).toEqual([5001]);
    const part = excerpt(text, found, 50);
    expect(part).toContain('Standard $18.99');
    expect(part.length).toBe(100);
  });
});

describe('moneyIn', () => {
  it('finds amounts with decimals or a currency, in the ways pages write them', () => {
    const found = moneyIn(
      '€5 /month · $18.99 · CA$7.84 · 325 kr · 1,299.00 · 29,99 € · 5 devices · 2026',
    );
    expect(found.map(({ amount, currency }) => [amount, currency])).toEqual([
      [5, 'EUR'],
      [18.99, 'dollar'],
      [7.84, 'CAD'],
      [325, 'SEK'],
      [1299, undefined],
      [29.99, 'EUR'],
    ]);
  });

  it('matches a bare $ to any dollar, and a written currency only to itself', () => {
    expect(sameCurrency('dollar', 'CAD')).toBe(true);
    expect(sameCurrency('dollar', 'EUR')).toBe(false);
    expect(sameCurrency(undefined, 'EUR')).toBe(true);
    expect(sameCurrency('USD', 'CAD')).toBe(false);
  });

  it('says a page shows a price near its plan’s name, or anywhere on a page that names none', () => {
    const text = pageText(netflixCa);
    expect(pageShows(text, 18.99, 'CAD', ['Standard'])).toBe(true);
    expect(pageShows(text, 19.99, 'CAD', ['Standard'])).toBe(false);
    // In euros, $18.99 isn't it.
    expect(pageShows(text, 18.99, 'EUR', ['Standard'])).toBe(false);
    expect(pageShows('Price: €5', 5, 'EUR', ['Mullvad VPN'])).toBe(true);
    expect(pageShows(`Premium $23.99 ${'.'.repeat(800)} Basic`, 23.99, 'CAD', ['Basic'])).toBe(
      false,
    );
  });
});

describe('taxWording', () => {
  it('finds the quote in any quotes and spacing, and wording that says tax is added', () => {
    expect(taxWording('It’s one flat rate.  Including VAT.', 'Including VAT.', '')).toEqual({
      status: 'kept',
    });
    expect(taxWording('It’s one flat rate.', 'Including VAT.', '')).toEqual({
      status: 'quote-gone',
    });
    expect(taxWording('Including VAT.', 'Including VAT.', '€5 excl. VAT')).toEqual({
      status: 'contradicted',
      wording: 'excl. VAT',
    });
    expect(taxWording('Including VAT.', 'Including VAT.', '$9.99 + tax')).toMatchObject({
      status: 'contradicted',
    });
    expect(
      missingQuotes('we’ve partnered with ProxyStore', ["we've partnered with ProxyStore", 'Inet']),
    ).toEqual(['Inet']);
  });
});

describe('robots.txt', () => {
  const robots = parseRobots(
    [
      'User-agent: *',
      'Disallow: /checkout',
      'Allow: /checkout/plans$',
      '',
      'User-agent: GPTBot',
      'Disallow: /',
      '',
      'User-agent: simplysubbot',
      'User-agent: OtherBot',
      'Disallow: /private/',
      'Allow: /private/pricing',
    ].join('\n'),
  );

  it('uses the bot’s own group, the longest rule winning and Allow winning a tie', () => {
    expect(robotsAllow(robots, '/private/secret')).toBe(false);
    expect(robotsAllow(robots, '/private/pricing?plan=1')).toBe(true);
    // Its own group says nothing about /checkout.
    expect(robotsAllow(robots, '/checkout')).toBe(true);
  });

  it('falls back to *, with wildcards and $', () => {
    const general = parseRobots(
      'User-agent: *\nDisallow: /*.pdf$\nDisallow: /checkout\nAllow: /checkout/plans$',
    );
    expect(robotsAllow(general, '/terms.pdf')).toBe(false);
    expect(robotsAllow(general, '/terms.pdf?x')).toBe(true);
    expect(robotsAllow(general, '/checkout/pay')).toBe(false);
    expect(robotsAllow(general, '/checkout/plans')).toBe(true);
    expect(robotsAllow('allow-all', '/anything')).toBe(true);
    expect(robotsAllow('disallow-all', '/')).toBe(false);
  });
});

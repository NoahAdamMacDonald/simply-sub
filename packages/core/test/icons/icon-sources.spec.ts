import { describe, expect, it } from 'vitest';
import {
  iconLinksIn,
  iconServices,
  iconServiceUrls,
  isIconServiceUrl,
  wellKnownIconPaths,
} from '../../src';

describe('iconLinksIn', () => {
  it('lists the icons a page declares, the largest first, without SVG or mask icons', () => {
    // proton.me's head, 2026-10-23.
    const html = `
      <link rel="stylesheet" href="/styles.css">
      <link rel="apple-touch-icon" sizes="180x180" href="/favicons/apple-touch-icon.png">
      <link rel="icon" type="image/png" sizes="32x32" href="/favicons/favicon-32x32.png">
      <link rel="icon" type="image/png" sizes="16x16" href="/favicons/favicon-16x16.png">
      <link rel="mask-icon" href="/favicons/safari-pinned-tab.svg" color="#6d4aff">
      <link rel="shortcut icon" href="/favicons/favicon.ico">`;
    expect(iconLinksIn(html)).toEqual([
      { href: '/favicons/apple-touch-icon.png', rel: 'apple-touch-icon', sizes: '180x180' },
      { href: '/favicons/favicon-32x32.png', rel: 'icon', sizes: '32x32' },
      { href: '/favicons/favicon-16x16.png', rel: 'icon', sizes: '16x16' },
      { href: '/favicons/favicon.ico', rel: 'icon' },
    ]);
  });

  it('counts an apple-touch-icon without sizes as 180 pixels', () => {
    // crave.ca's head, 2026-10-23.
    const html = `
      <link rel="icon" type="image/x-icon" href="/9641/assets/logos/favicon.ico" />
      <link rel="icon" type="image/png" sizes="32x32" href="/9641/assets/logos/favicon-32x32.png" />
      <link rel="apple-touch-icon" href="/9641/assets/logos/craveLogo.png" />`;
    expect(iconLinksIn(html).map((link) => link.href)).toEqual([
      '/9641/assets/logos/craveLogo.png',
      '/9641/assets/logos/favicon-32x32.png',
      '/9641/assets/logos/favicon.ico',
    ]);
  });

  it('reads any attribute order, quoting and case, and decodes entities', () => {
    const html = `<LINK HREF='https://cdn.example.com/icon.png?v=2&amp;s=192' Rel=Icon sizes=192x192>
      <link href=/touch.png rel="apple-touch-icon-precomposed"/>`;
    expect(iconLinksIn(html)).toEqual([
      { href: 'https://cdn.example.com/icon.png?v=2&s=192', rel: 'icon', sizes: '192x192' },
      { href: '/touch.png', rel: 'apple-touch-icon-precomposed' },
    ]);
  });

  it('takes the largest of several sizes, and leaves out SVG icons', () => {
    const html = `
      <link rel="icon" href="/favicon.svg" type="image/svg+xml">
      <link rel="icon" href="/logo.svg?v=3" sizes="any">
      <link rel="icon" href="/favicon.ico" sizes="16x16 48x48">
      <link rel="icon" href="/favicon-24.png" sizes="24x24">`;
    expect(iconLinksIn(html).map((link) => link.href)).toEqual(['/favicon.ico', '/favicon-24.png']);
  });

  it('finds nothing in a page without icon links', () => {
    expect(iconLinksIn('<html><head><title>Example</title></head></html>')).toEqual([]);
  });
});

describe('iconServiceUrls', () => {
  it("asks Google's favicon service, then DuckDuckGo's, for any host name", () => {
    expect(iconServiceUrls('www.Example-Shop.co.uk')).toEqual([
      'https://www.google.com/s2/favicons?domain=www.example-shop.co.uk&sz=128',
      'https://icons.duckduckgo.com/ip3/www.example-shop.co.uk.ico',
    ]);
  });
});

describe('iconServices', () => {
  it('names each service, as GET /icon reports where an icon came from', () => {
    expect(iconServices('localgym.example')).toEqual([
      { name: 'google', url: 'https://www.google.com/s2/favicons?domain=localgym.example&sz=128' },
      { name: 'duckduckgo', url: 'https://icons.duckduckgo.com/ip3/localgym.example.ico' },
    ]);
  });
});

describe('isIconServiceUrl', () => {
  it("accepts the services' own hosts, including the gstatic.com servers Google redirects to", () => {
    expect(isIconServiceUrl('https://www.google.com/s2/favicons?domain=netflix.com&sz=128')).toBe(
      true,
    );
    expect(
      isIconServiceUrl(
        'https://t0.gstatic.com/faviconV2?client=SOCIAL&url=http://netflix.com&size=128',
      ),
    ).toBe(true);
    expect(isIconServiceUrl('https://icons.duckduckgo.com/ip3/netflix.com.ico')).toBe(true);
  });

  it('refuses any other host, plain HTTP, and hosts that only start like a service', () => {
    expect(isIconServiceUrl('https://netflix.com/favicon.ico')).toBe(false);
    expect(isIconServiceUrl('http://www.google.com/s2/favicons')).toBe(false);
    expect(isIconServiceUrl('https://www.google.com.evil.example/')).toBe(false);
    expect(isIconServiceUrl('https://t0.gstatic.com@evil.example/')).toBe(false);
    expect(isIconServiceUrl('https://169.254.169.254/')).toBe(false);
  });
});

describe('wellKnownIconPaths', () => {
  it('lists the paths sites serve icons at without declaring them', () => {
    expect(wellKnownIconPaths).toEqual(['/apple-touch-icon.png', '/favicon.ico']);
  });
});

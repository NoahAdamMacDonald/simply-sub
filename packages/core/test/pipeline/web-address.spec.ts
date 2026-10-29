import { describe, expect, it } from 'vitest';
import { bareHost, hostOnDomain, httpsAddress, parseWebAddress } from '../../src';

describe('parseWebAddress', () => {
  it('reads the parts of an absolute http(s) address', () => {
    expect(parseWebAddress('https://help.Netflix.com/en/node/24926/ca?x=1#top')).toEqual({
      protocol: 'https',
      host: 'help.netflix.com',
      path: '/en/node/24926/ca',
      query: '?x=1',
    });
    expect(parseWebAddress('http://user@example.com:8080')).toEqual({
      protocol: 'http',
      host: 'example.com',
      path: '/',
      query: '',
    });
  });

  it.each([
    '/pricing',
    'mailto:help@example.com',
    'https://localhost/',
    'ftp://example.com',
    'https://exa mple.com',
    'https://1.2.3.4/',
  ])('refuses %s', (url) => {
    expect(parseWebAddress(url)).toBeUndefined();
  });
});

describe('httpsAddress', () => {
  it('writes the address as https without its fragment', () => {
    expect(httpsAddress(parseWebAddress('http://netflix.com/ca?a=b#plans')!)).toBe(
      'https://netflix.com/ca?a=b',
    );
  });
});

describe('hosts', () => {
  it('drops www and matches subdomains', () => {
    expect(bareHost('www.netflix.com')).toBe('netflix.com');
    expect(hostOnDomain('help.netflix.com', 'www.netflix.com')).toBe(true);
    expect(hostOnDomain('netflix.com.evil.example', 'netflix.com')).toBe(false);
    expect(hostOnDomain('notnetflix.com', 'netflix.com')).toBe(false);
  });
});

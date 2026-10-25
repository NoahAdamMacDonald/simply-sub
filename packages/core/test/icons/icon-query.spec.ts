import { describe, expect, it } from 'vitest';
import { readIconQuery } from '../../src';

/** What the Worker passes: the URL parser's host name, which is ASCII (xn--) for an international one. */
const toAscii = (host: string) => {
  // Core's tests have no URL type (ES library only), but Node runs them, where URL exists.
  const parse = (
    globalThis as unknown as { URL: { parse(url: string): { hostname: string } | null } }
  ).URL.parse;
  return parse(`https://${host}`)?.hostname;
};

function read(domain: string | string[], more: Record<string, string[]> = {}) {
  return readIconQuery({ domain: Array.isArray(domain) ? domain : [domain], ...more }, { toAscii });
}

function issue(domain: string): string | undefined {
  const result = read(domain);
  return 'problems' in result ? result.problems[0].issue : undefined;
}

describe('readIconQuery', () => {
  it('reads a domain, in lower case and without a trailing dot or spaces', () => {
    expect(read('localgym.example')).toEqual({ query: { domain: 'localgym.example' } });
    expect(read(' WWW.Example-Shop.co.uk. ')).toEqual({
      query: { domain: 'www.example-shop.co.uk' },
    });
    expect(read('xn--caf-dma.ca')).toEqual({ query: { domain: 'xn--caf-dma.ca' } });
  });

  it('writes an international domain in its xn-- form', () => {
    expect(read('Café.ca')).toEqual({ query: { domain: 'xn--caf-dma.ca' } });
    expect(read('bücher.example')).toEqual({ query: { domain: 'xn--bcher-kva.example' } });
  });

  it('refuses a URL, a port, a path or user info, as the contract example shows', () => {
    const bare = "Expected a bare hostname like 'example.com' (no scheme or path).";

    expect(issue('https://localgym.example/join')).toBe(bare);
    expect(issue('localgym.example:8080')).toBe(bare);
    expect(issue('localgym.example/join')).toBe(bare);
    expect(issue('me@localgym.example')).toBe(bare);
    expect(issue('local gym.example')).toBe(bare);
  });

  it('refuses IP addresses, including ones an international name maps to', () => {
    const ip = 'Use a domain name, not an IP address.';

    expect(issue('127.0.0.1')).toBe(ip);
    expect(issue('169.254.169.254')).toBe(ip);
    expect(issue('[::1]')).toBe(ip);
    expect(issue('fe80::1')).toBe(ip);
    expect(issue('１２７.０.０.１')).toBe(ip);
  });

  it('refuses a single label, a bad label or top-level domain, and a domain too long to be one', () => {
    expect(issue('localhost')).toBe('Use a full domain name, such as example.com.');
    expect(issue('')).toBe('Use a full domain name, such as example.com.');
    const notADomain =
      'Not a domain name: use letters, digits and hyphens between dots, such as example.com.';
    expect(issue('-gym.example')).toBe(notADomain);
    expect(issue('gym..example')).toBe(notADomain);
    expect(issue('under_score.example')).toBe(notADomain);
    expect(issue('gym.123')).toBe(notADomain);
    expect(issue('gym.c')).toBe(notADomain);
    expect(issue(`${'a'.repeat(64)}.example`)).toBe(notADomain);
    expect(issue(`${'abcdefghi.'.repeat(25)}example`)).toBe(
      'Use a domain name of at most 253 characters.',
    );
    expect(issue('gym\u0001.example')).toBe(notADomain);
  });

  it('needs one domain parameter and takes nothing else, size included', () => {
    expect(readIconQuery({}, { toAscii })).toEqual({
      problems: [{ param: 'domain', issue: "Needed: the website's domain, such as example.com." }],
    });
    expect(read(['a.example', 'b.example'])).toEqual({
      problems: [{ param: 'domain', issue: 'Give one value.' }],
    });
    expect(read('localgym.example', { size: ['64'] })).toEqual({
      problems: [{ param: 'size', issue: 'Unknown parameter. GET /icon takes domain.' }],
    });
  });
});

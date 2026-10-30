import { describe, expect, it } from 'vitest';
import { contentHash, openFeed, sealFeed } from '../src/feed-seal';
import { fromBase64, secretHash, sha256Hex } from '../src/writes';

// A live calendar's file sealed at rest (src/feed-seal.ts, M10.21): it opens only with its feed's token and under its
// own row, and the content hash is keyed by the token.

const token = 'k7Qm2Zp9XvT4bN8cR1sW0a';
const otherToken = 'Jd8f2LqP0zXn5Vt7Bc3HyA';
const ics = [
  'BEGIN:VCALENDAR',
  'X-WR-CALNAME:Simply Sub',
  ...Array.from({ length: 200 }, (_, index) =>
    ['BEGIN:VEVENT', `UID:${index}@sub.simplely.ca`, 'SUMMARY:Netflix: $19.94', 'END:VEVENT'].join(
      '\r\n',
    ),
  ),
  'END:VCALENDAR',
].join('\r\n');

describe('sealFeed and openFeed', () => {
  it('seal a calendar that opens with its token under its row, gzipped first', async () => {
    const hash = await secretHash(token);
    const sealed = await sealFeed(token, hash, ics);

    expect(await openFeed(token, hash, sealed)).toBe(ics);
    expect(sealed).not.toContain('Netflix');
    expect(atob(sealed)).not.toContain('Netflix');
    const bytes = fromBase64(sealed);
    expect(bytes[0]).toBe(1);
    // 200 alike events: far smaller than the file.
    expect(bytes.length).toBeLessThan(ics.length / 10);
  });

  it('seal it anew each time, with a new IV', async () => {
    const hash = await secretHash(token);
    expect(await sealFeed(token, hash, ics)).not.toBe(await sealFeed(token, hash, ics));
  });

  it("refuse another feed's token, another row, and a file that's been changed", async () => {
    const hash = await secretHash(token);
    const sealed = await sealFeed(token, hash, ics);
    const changed = fromBase64(sealed);
    changed[20] ^= 1;

    await expect(openFeed(otherToken, hash, sealed)).rejects.toThrow();
    await expect(openFeed(token, await secretHash(otherToken), sealed)).rejects.toThrow();
    await expect(openFeed(token, hash, btoa(String.fromCharCode(...changed)))).rejects.toThrow();
    await expect(openFeed(token, hash, btoa('\u0002rest'))).rejects.toThrow(
      'Not a sealed calendar file',
    );
  });
});

describe('contentHash', () => {
  it('is keyed by the token: the same for the same feed, another for another, never the plain SHA-256', async () => {
    const content = JSON.stringify({ name: 'Simply Sub', color: null, events: [] });
    const hash = await contentHash(token, content);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await contentHash(token, content)).toBe(hash);
    expect(await contentHash(otherToken, content)).not.toBe(hash);
    expect(hash).not.toBe(await sha256Hex(content));
  });
});

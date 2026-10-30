import { describe, expect, it } from 'vitest';
import { joinLinkBodySchema, joinLinkUrl, readJoinLink, readScannedCode } from '../../src';

// The one-time join link (M10.14): its address, reading it back from a page's fragment or a scanned QR code, and
// POST /join's answer.

const id = 'Q2hhaW5MaW5rSWQwMDAwMA';
const key = 'S2V5S2V5S2V5S2V5S2V5S2V5S2V5S2V5S2V5S2V5S2U';
const origin = 'https://sub.simplely.ca';
const words = 'abandon '.repeat(23) + 'art';

describe('the join link', () => {
  it('puts its id and key after the #, which never reaches the server', () => {
    expect(joinLinkUrl(origin, { id, key })).toBe(`${origin}/join#${id}.${key}`);
  });

  it('reads back from its fragment', () => {
    expect(readJoinLink(`${id}.${key}`)).toEqual({ id, key });
  });

  it.each([
    ['nothing', ''],
    ['an id alone', id],
    ['a short key', `${id}.${key.slice(1)}`],
    ['a long id', `${id}A.${key}`],
    ['a third part', `${id}.${key}.x`],
    ['characters base64url has not', `${id}.${key.slice(1)}+`],
  ])('is not read from %s', (_what, fragment) => {
    expect(readJoinLink(fragment)).toBeUndefined();
  });
});

describe('a QR code scanned in Join', () => {
  it('is this app’s join link', () => {
    expect(readScannedCode(`  ${origin}/join#${id}.${key}\n`, origin)).toEqual({
      kind: 'link',
      link: { id, key },
    });
  });

  it('is another site’s join link: a preview’s, say', () => {
    expect(readScannedCode(`https://preview.workers.dev/join#${id}.${key}`, origin)).toEqual({
      kind: 'elsewhere',
    });
  });

  it('is a sync code’s 24 words, the QR code before M10.14', () => {
    expect(readScannedCode(words.toUpperCase(), origin)).toEqual({
      kind: 'words',
      words: words.split(' '),
    });
  });

  it.each([
    ['another page of the app', `${origin}/settings#${id}.${key}`],
    ['a link without its key', `${origin}/join#${id}`],
    ['a web address', 'https://example.com/'],
    ['a few words', 'abandon ability able'],
    ['24 things that aren’t words', '1 '.repeat(24)],
  ])('is something else: %s', (_what, text) => {
    expect(readScannedCode(text, origin)).toEqual({ kind: 'unknown' });
  });
});

describe('POST /join’s answer', () => {
  it('holds the link’s id and when it stops working', () => {
    const body = { data: { id, expiresAt: '2026-10-30T18:30:00Z' }, meta: {} };
    expect(joinLinkBodySchema.parse(body)).toEqual(body);
    expect(
      joinLinkBodySchema.safeParse({
        ...body,
        data: { id: 'short', expiresAt: '2026-10-30T18:30:00Z' },
      }).success,
    ).toBe(false);
  });
});

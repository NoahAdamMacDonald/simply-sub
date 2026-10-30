import { TestBed } from '@angular/core/testing';
import { readJoinLink } from '@simply-sub/core';
import { openJoinCode } from '../../core/crypto/join-crypto';
import { JoinLinks } from './join-links';

// Join links in the app (M10.14): making one sends only the sealed code, and its address carries the key after the #;
// taking one opens what the server answers, once. Fetch is a stand-in for the Worker's /api/v1/join.

const id = 'YGFiY2RlZmdoaWprbG1ubw';
const counting = Uint8Array.from({ length: 32 }, (_, index) => index);

describe('JoinLinks', () => {
  let fetches: { method: string; url: string; type: string | null; body?: Uint8Array }[];
  let answer: (method: string) => Response | Promise<Response>;

  beforeEach(() => {
    fetches = [];
    answer = () => new Response(null, { status: 404 });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      fetches.push({
        method,
        url: String(input),
        type: new Headers(init.headers).get('Content-Type'),
        ...(init.body !== undefined && {
          body: new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer()),
        }),
      });
      return answer(method);
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  const links = () => TestBed.inject(JoinLinks);

  it('makes a link that sends the server only the sealed code, its key after the #', async () => {
    answer = () =>
      Response.json({ data: { id, expiresAt: '2026-10-30T18:40:00Z' }, meta: {} }, { status: 201 });
    const made = await links().make(counting);

    expect(made).toMatchObject({ id, expiresAt: '2026-10-30T18:40:00Z' });
    const url = new URL(made.url);
    expect(`${url.origin}${url.pathname}`).toBe(`${document.location.origin}/join`);
    const link = readJoinLink(url.hash.slice(1));
    expect(link?.id).toBe(id);
    expect(fetches).toEqual([
      expect.objectContaining({
        method: 'POST',
        url: '/api/v1/join',
        type: 'application/octet-stream',
      }),
    ]);
    const sent = fetches[0].body ?? new Uint8Array();
    expect(sent).toHaveLength(61);
    expect(await openJoinCode(link?.key ?? '', new Uint8Array(sent))).toEqual(counting);
  });

  it('takes a link’s code once, and says why when it can’t', async () => {
    // The contract's example: the code 0x00..0x1f sealed with the key 0x40..0x5f.
    const sealed = Uint8Array.from(
      atob('AaChoqOkpaanqKmqq9eOBDzm7poqcWZL9YWxPvn/BufU+HqTOvrF9IH132Dn+8HGQ/R+tiAS23AcFJXkNA=='),
      (char) => char.charCodeAt(0),
    );
    const key = 'QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8';
    answer = () => new Response(sealed);

    expect(await links().take({ id, key })).toEqual({ kind: 'code', seed: counting });
    expect(fetches).toEqual([
      expect.objectContaining({ method: 'DELETE', url: `/api/v1/join/${id}` }),
    ]);

    answer = () => new Response(null, { status: 404 });
    expect(await links().take({ id, key })).toEqual({ kind: 'gone' });
    answer = () => Promise.reject(new TypeError('Failed to fetch'));
    expect(await links().take({ id, key })).toEqual({ kind: 'offline' });
    answer = () => new Response(null, { status: 500 });
    expect(await links().take({ id, key })).toEqual({ kind: 'failed' });
    answer = () => new Response(sealed);
    expect(await links().take({ id, key: 'A'.repeat(43) })).toEqual({ kind: 'unopenable' });
  });

  it('withdraws a link no device has taken, and minds no answer', async () => {
    answer = () => Promise.reject(new TypeError('Failed to fetch'));
    await links().withdraw(id);
    expect(fetches).toEqual([
      expect.objectContaining({ method: 'DELETE', url: `/api/v1/join/${id}` }),
    ]);
  });
});

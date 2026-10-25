import { isIconServiceUrl } from '@simply-sub/core';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import contract from '../../../docs/api-output-examples.json';
import app from '../src/index';

// GET /icon (docs/api-output-examples.json). Google's and DuckDuckGo's icon services are stand-ins that answer as the
// real ones do (2026-10-25): Google redirects to its gstatic.com servers, and both answer 404 with a small
// placeholder for a site they don't know. KV is miniflare's.
const BASE = 'https://sub.simplely.ca/api/v1';
const examples = contract.endpoints['GET /icon'].examples;

/** A PNG's signature and IHDR chunk: all core's readPngSize reads. */
function png(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33);
  const view = new DataView(bytes.buffer);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, size);
  view.setUint32(20, size);
  return bytes;
}

/** An ICO holding one PNG, as DuckDuckGo serves a site's favicon. */
function ico(image: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(22 + image.length);
  const view = new DataView(bytes.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, 1, true);
  view.setUint32(6 + 8, image.length, true);
  view.setUint32(6 + 12, 22, true);
  bytes.set(image, 22);
  return bytes;
}

interface Services {
  /** What Google's gstatic.com server answers after the redirect: an icon, or 404 with its placeholder. */
  google?: Uint8Array<ArrayBuffer> | 'unknown';
  duckduckgo?: Uint8Array<ArrayBuffer> | 'unknown';
  /** Where Google's service redirects, when not to gstatic.com. */
  redirect?: string;
}

const fetched: string[] = [];
const upstream = vi.spyOn(globalThis, 'fetch');
const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
  vi.spyOn(console, method).mockImplementation(() => undefined),
);

function serve({ google = 'unknown', duckduckgo = 'unknown', redirect }: Services) {
  upstream.mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    fetched.push(url);
    const answer = (body: Uint8Array<ArrayBuffer> | 'unknown', type: string) =>
      body === 'unknown'
        ? new Response(png(16), { status: 404, headers: { 'Content-Type': 'image/png' } })
        : new Response(body, { headers: { 'Content-Type': type } });
    if (url.startsWith('https://www.google.com/s2/favicons')) {
      const domain = new URL(url).searchParams.get('domain');
      return new Response(null, {
        status: 301,
        headers: {
          Location:
            redirect ??
            `https://t0.gstatic.com/faviconV2?client=SOCIAL&url=http://${domain}&size=128`,
        },
      });
    }
    if (url.startsWith('https://t0.gstatic.com/')) {
      return answer(google, 'image/png');
    }
    if (url.startsWith('https://icons.duckduckgo.com/')) {
      return answer(duckduckgo, 'image/x-icon');
    }
    throw new Error(`The test fetched ${url}`);
  });
}

function get(query: string, bindings: Partial<Env> = {}) {
  return Promise.resolve(app.fetch(new Request(`${BASE}/icon${query}`), { ...env, ...bindings }));
}

async function keptIcons() {
  return (await env.KV.list<{ source: string }>({ prefix: 'icon:' })).keys;
}

beforeEach(async () => {
  fetched.length = 0;
  upstream.mockReset();
  for (const { name } of await keptIcons()) {
    await env.KV.delete(name);
  }
});

describe('GET /icon', () => {
  it("answers the example's request: DuckDuckGo's icon when Google has none", async () => {
    const [example] = examples;
    const icon = png(64);
    serve({ duckduckgo: ico(icon) });

    const response = await get(new URL(example.request.url).search);

    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': example.response.headers['Content-Type'],
      'cache-control': example.response.headers['Cache-Control'],
      'x-icon-source': 'duckduckgo',
    });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(icon);
  });

  it("gives the larger icon, and Google's on a tie", async () => {
    serve({ google: png(128), duckduckgo: ico(png(64)) });
    const larger = await get('?domain=larger.example');
    serve({ google: png(64), duckduckgo: ico(png(64)) });
    const tie = await get('?domain=tie.example');

    expect(larger.headers.get('X-Icon-Source')).toBe('google');
    expect(new Uint8Array(await larger.arrayBuffer())).toEqual(png(128));
    expect(tie.headers.get('X-Icon-Source')).toBe('google');
  });

  it('keeps the icon in KV for 30 days under a hash of the domain, and answers from there next time', async () => {
    serve({ google: png(128) });
    const first = await get('?domain=localgym.example');
    const asked = fetched.length;
    const second = await get('?domain=LocalGym.Example.');

    expect(first.status).toBe(200);
    expect(asked).toBe(3);
    expect(fetched.length).toBe(asked);
    expect(second.status).toBe(200);
    expect(second.headers.get('X-Icon-Source')).toBe('google');
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(png(128));
    const [kept, ...others] = await keptIcons();
    expect(others).toEqual([]);
    expect(kept.name).toMatch(/^icon:[0-9a-f]{64}$/);
    expect(kept.metadata).toEqual({ source: 'google' });
    expect((kept.expiration ?? 0) - Date.now() / 1000).toBeGreaterThan(30 * 86400 - 60);
  });

  it('answers 404 without a usable icon as the example shows, and remembers that for a day', async () => {
    const example = examples[1];
    serve({ google: png(16), duckduckgo: 'unknown' });
    const response = await get(new URL(example.request.url).search);
    const asked = fetched.length;
    const again = await get('?domain=nosuchsite.example');

    expect(response.status).toBe(example.response.status);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': example.response.headers['Content-Type'],
      'cache-control': example.response.headers['Cache-Control'],
    });
    expect(await response.json()).toEqual(example.response.body);
    expect(again.status).toBe(404);
    expect(fetched.length).toBe(asked);
    const [kept] = await keptIcons();
    expect(kept.metadata).toEqual({ source: 'none' });
    const left = (kept.expiration ?? 0) - Date.now() / 1000;
    expect(left).toBeGreaterThan(86400 - 60);
    expect(left).toBeLessThanOrEqual(86400);
  });

  it('only ever fetches the icon services, and follows no redirect to another host', async () => {
    serve({ duckduckgo: ico(png(64)), redirect: 'http://169.254.169.254/latest/meta-data/' });

    const response = await get('?domain=localgym.example');

    expect(response.headers.get('X-Icon-Source')).toBe('duckduckgo');
    expect(fetched).toEqual([
      'https://www.google.com/s2/favicons?domain=localgym.example&sz=128',
      'https://icons.duckduckgo.com/ip3/localgym.example.ico',
    ]);
    expect(fetched.every(isIconServiceUrl)).toBe(true);
  });

  it('asks for an international domain in its xn-- form', async () => {
    serve({ google: png(64) });

    await get(`?domain=${encodeURIComponent('Café.ca')}`);

    expect(fetched[0]).toBe('https://www.google.com/s2/favicons?domain=xn--caf-dma.ca&sz=128');
  });

  it('refuses a URL exactly as the example shows, and an IP address, a single label or size', async () => {
    const example = examples[2];
    const issues = async (query: string) =>
      (await (await get(query)).json<{ error: { details: unknown[] } }>()).error.details;

    const response = await get(new URL(example.request.url).search);

    expect(response.status).toBe(example.response.status);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': example.response.headers['Content-Type'],
      'cache-control': example.response.headers['Cache-Control'],
    });
    expect(await response.json()).toEqual(example.response.body);
    expect(await issues('?domain=127.0.0.1')).toEqual([
      { param: 'domain', issue: 'Use a domain name, not an IP address.' },
    ]);
    expect(await issues('?domain=localhost')).toEqual([
      { param: 'domain', issue: 'Use a full domain name, such as example.com.' },
    ]);
    expect(await issues('?domain=localgym.example&size=64')).toEqual([
      { param: 'size', issue: 'Unknown parameter. GET /icon takes domain.' },
    ]);
    expect(fetched).toEqual([]);
  });

  it('still answers when KV refuses to keep the icon, and never logs the domain', async () => {
    serve({ google: png(64) });
    const full = {
      getWithMetadata: env.KV.getWithMetadata.bind(env.KV),
      put: async () => {
        throw new Error('KV put() limit exceeded for the day.');
      },
    } as unknown as KVNamespace;
    const response = await get('?domain=secret-clinic.example', { KV: full });
    upstream.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    const offline = await get('?domain=secret-clinic-two.example');

    expect(response.status).toBe(200);
    expect(offline.status).toBe(404);
    const logged = logs.flatMap((spy) => spy.mock.calls.flat().map(String));
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.filter((line) => line.includes('secret-clinic'))).toEqual([]);
  });
});

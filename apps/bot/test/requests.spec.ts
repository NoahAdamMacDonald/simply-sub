import { describe, expect, it } from 'vitest';
import { OutOfRequests, Requests } from '../src/requests';

// The requests a night sends out (requests.ts). Cloudflare counts each hop of a redirect as a request of its own, and
// the nights of 2026-11-22 and 2026-11-24 stopped with "Too many subrequests" while the count said there were some left:
// each hop is counted now.

/** A web where each path in `redirects` sends the reader on, and every other answers with its own URL. */
function web(redirects: Record<string, { status: number; to: string }>) {
  const sent: { url: string; init: RequestInit | undefined }[] = [];
  const requests = new Requests(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    sent.push({ url, init });
    const hop = redirects[new URL(url).pathname];
    return hop
      ? new Response(null, { status: hop.status, headers: { Location: hop.to } })
      : new Response(url);
  });
  return { requests, sent };
}

describe('counted requests', () => {
  it('follows a redirect itself, counting each hop, with the same headers', async () => {
    const { requests, sent } = web({
      '/web/2id_/https://example.com/': {
        status: 302,
        to: '/web/20261101000000id_/https://example.com/',
      },
    });
    requests.start(10);
    const response = await requests.fetch('https://web.archive.org/web/2id_/https://example.com/', {
      headers: { 'User-Agent': 'SimplySubBot/1.0' },
    });
    expect(await response.text()).toBe(
      'https://web.archive.org/web/20261101000000id_/https://example.com/',
    );
    expect(requests.used).toBe(2);
    expect(sent.map(({ init }) => init?.redirect)).toEqual(['manual', 'manual']);
    expect(new Headers(sent[1].init?.headers).get('User-Agent')).toBe('SimplySubBot/1.0');
  });

  it('stops before a hop past the step’s allowance', async () => {
    const { requests, sent } = web({ '/old': { status: 301, to: 'https://example.com/new' } });
    requests.start(1);
    await expect(requests.fetch('https://example.com/old')).rejects.toBeInstanceOf(OutOfRequests);
    expect(sent).toHaveLength(1);
  });

  it('gives up after five redirects, answering with the last', async () => {
    const { requests } = web({ '/loop': { status: 302, to: '/loop' } });
    requests.start(40);
    const response = await requests.fetch('https://example.com/loop');
    expect(response.status).toBe(302);
    expect(requests.used).toBe(6);
  });

  it('leaves a redirect of a request with a body to its caller', async () => {
    const { requests } = web({ '/graphql': { status: 307, to: '/v4/graphql' } });
    requests.start(10);
    const response = await requests.fetch('https://api.github.com/graphql', {
      method: 'POST',
      body: '{}',
    });
    expect(response.status).toBe(307);
    expect(requests.used).toBe(1);
  });
});

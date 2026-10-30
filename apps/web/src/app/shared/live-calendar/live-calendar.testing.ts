import type { CalendarFeeds } from '@simply-sub/core';

// A stand-in for the Worker's live calendar routes (M10.2) for specs: it keeps sets and answers POST, PUT and DELETE
// /api/v1/cal as the Worker does, recording each request. *.testing.ts files are left out of the app build.

export interface CalRequest {
  method: string;
  path: string;
  body?: CalendarFeeds;
  /** The manage key sent with it. */
  key?: string;
}

export class FakeCalServer {
  readonly requests: CalRequest[] = [];
  /** Every request gets this status instead, or no answer ('offline'), until it's cleared. */
  fail: number | 'offline' | undefined;
  private readonly sets = new Map<string, { key: string; tokens: string[] }>();
  private made = 0;

  readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    await Promise.resolve();
    const path = new URL(String(input), 'https://sub.simplely.ca').pathname;
    const method = init.method ?? 'GET';
    const body =
      typeof init.body === 'string' ? (JSON.parse(init.body) as CalendarFeeds) : undefined;
    const key = new Headers(init.headers).get('Authorization')?.replace(/^Bearer /, '');
    this.requests.push({ method, path, ...(body && { body }), ...(key && { key }) });
    if (this.fail === 'offline') throw new TypeError('Failed to fetch');
    if (this.fail !== undefined) return error(this.fail);

    if (method === 'POST' && path === '/api/v1/cal' && body) {
      const id = this.secret();
      const manageKey = this.secret();
      const tokens = body.feeds.map(() => this.secret());
      this.sets.set(id, { key: manageKey, tokens });
      return Response.json(
        { data: { id, manageKey, feeds: links(tokens, body) }, meta: {} },
        { status: 201 },
      );
    }
    const id = /^\/api\/v1\/cal\/([A-Za-z0-9_-]{22})$/.exec(path)?.[1];
    const set = id === undefined ? undefined : this.sets.get(id);
    if (!set || id === undefined) return error(404);
    if (key !== set.key) return error(403);
    if (method === 'DELETE') {
      this.sets.delete(id);
      return new Response(null, { status: 204 });
    }
    if (method === 'PUT' && body) {
      set.tokens = body.feeds.map((feed) => feed.token ?? this.secret());
      return Response.json({
        data: { id, feeds: links(set.tokens, body), updatedAt: '2026-10-25T12:00:00Z' },
        meta: {},
      });
    }
    return error(404);
  };

  /** Forgets set `id`, as when it's revoked from another device or expires. */
  forget(id: string): void {
    this.sets.delete(id);
  }

  /** A secret of the Worker's form: 22 base64url characters. */
  private secret(): string {
    return `secret${String(this.made++).padStart(16, '0')}`;
  }
}

function links(tokens: readonly string[], body: CalendarFeeds) {
  return tokens.map((token, index) => ({
    token,
    url: `https://sub.simplely.ca/api/v1/cal/${token}.ics`,
    webcalUrl: `webcal://sub.simplely.ca/api/v1/cal/${token}.ics`,
    eventCount: body.feeds[index].events.length,
  }));
}

function error(status: number): Response {
  return Response.json({ error: { code: 'failed', message: 'Failed' } }, { status });
}

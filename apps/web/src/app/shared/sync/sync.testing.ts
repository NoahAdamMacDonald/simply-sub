// A stand-in for the Worker's sync routes (M10.8) for specs: it keeps chains and answers GET, PUT and DELETE
// /api/v1/sync/:chain as the Worker does (versions, If-None-Match, If-Match, the secret), recording each request.
// *.testing.ts files are left out of the app build.

export interface SyncRequest {
  method: string;
  chain: string;
  /** The version the request named: If-None-Match's or If-Match's, or `*`. */
  condition?: string;
}

interface Chain {
  secret: string;
  version: number;
  bytes: Uint8Array<ArrayBuffer>;
}

export class FakeSyncServer {
  readonly requests: SyncRequest[] = [];
  /** Every request gets this status instead, or no answer ('offline'), until it's cleared. */
  fail: number | 'offline' | undefined;
  /** Runs before the next PUT is answered, once: another device writing first. */
  beforeNextWrite?: () => Promise<void> | void;
  private readonly chains = new Map<string, Chain>();

  readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    await Promise.resolve();
    const path = new URL(String(input), 'https://sub.simplely.ca').pathname;
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    const chain = /^\/api\/v1\/sync\/([A-Za-z0-9_-]{22})$/.exec(path)?.[1] ?? '';
    const condition = headers.get('If-None-Match') ?? headers.get('If-Match') ?? undefined;
    this.requests.push({ method, chain, ...(condition && { condition }) });
    if (this.fail === 'offline') throw new TypeError('Failed to fetch');
    if (this.fail !== undefined) return new Response(null, { status: this.fail });

    const secret = headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    if (method === 'PUT') {
      const write = this.beforeNextWrite;
      this.beforeNextWrite = undefined;
      await write?.();
    }
    const stored = this.chains.get(chain);
    if (stored && stored.secret !== secret) return new Response(null, { status: 403 });

    if (method === 'GET') {
      if (!stored) return new Response(null, { status: 404 });
      const etag = `"${stored.version}"`;
      if (condition === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
      return new Response(stored.bytes, { headers: { ETag: etag } });
    }
    if (method === 'DELETE') {
      if (!stored) return new Response(null, { status: 404 });
      this.chains.delete(chain);
      return new Response(null, { status: 204 });
    }
    const bytes = new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer());
    if (condition === '*') {
      if (stored) return new Response(null, { status: 412 });
      this.chains.set(chain, { secret, version: 1, bytes });
      return written(1, 201);
    }
    if (!stored) return new Response(null, { status: 404 });
    if (condition !== `"${stored.version}"`) return new Response(null, { status: 412 });
    stored.version++;
    stored.bytes = bytes;
    return written(stored.version, 200);
  };

  /** The chain's sealed copy and version, as stored. */
  chain(id: string): { version: number; bytes: Uint8Array<ArrayBuffer> } | undefined {
    const stored = this.chains.get(id);
    return stored && { version: stored.version, bytes: stored.bytes };
  }

  /** Another device's write: a new version of the chain, with its secret. */
  store(id: string, secret: string, bytes: Uint8Array<ArrayBuffer>): void {
    const stored = this.chains.get(id);
    this.chains.set(id, { secret, version: (stored?.version ?? 0) + 1, bytes });
  }

  /** The chain deleted from another device. */
  forget(id: string): void {
    this.chains.delete(id);
  }
}

function written(version: number, status: number): Response {
  return Response.json(
    { data: { version: String(version), updatedAt: '2026-10-25T12:00:00Z' }, meta: {} },
    { status, headers: { ETag: `"${version}"` } },
  );
}

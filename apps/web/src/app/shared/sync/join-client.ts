import { joinLinkBodySchema } from '@simply-sub/core';

// Join links' calls to the API (BLUEPRINT §5.2, M10.14): POST /join keeps a sealed sync code for 10 minutes and answers
// the link's id; DELETE /join/:id takes it, once, which deletes it. The server only ever sees the sealed bytes.

/** Why a call didn't do what it asked. */
export type JoinCallProblem =
  /** No network, or no answer. */
  | 'offline'
  /** The link was used, has expired, or never was. */
  | 'gone'
  /** Too many writes this minute. */
  | 'busy'
  /** The server has stored all it takes today, or has no room. */
  | 'full'
  | 'failed';

export class JoinCallError extends Error {
  constructor(readonly problem: JoinCallProblem) {
    super(`A join link's request failed: ${problem}`);
    this.name = 'JoinCallError';
  }
}

const base = '/api/v1/join';

/** Keeps a sealed code for 10 minutes: answers the link's id and when it stops working. */
export async function postJoinCode(
  sealed: Uint8Array<ArrayBuffer>,
): Promise<{ id: string; expiresAt: string }> {
  const answer = await send(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: sealed,
  });
  return joinLinkBodySchema.parse(await answer.json()).data;
}

/** Takes a link's sealed code, which deletes it: no device can take it again. */
export async function takeJoinCode(id: string): Promise<Uint8Array<ArrayBuffer>> {
  const answer = await send(`${base}/${id}`, { method: 'DELETE' });
  return new Uint8Array(await answer.arrayBuffer());
}

/** Withdraws a link no device has taken, even as the page closes; one taken or past its time is gone already. */
export async function withdrawJoinCode(id: string): Promise<void> {
  await send(`${base}/${id}`, { method: 'DELETE', keepalive: true }).catch(() => undefined);
}

/** The answer to a request, or a JoinCallError saying why there's no good one. */
async function send(url: string, init: RequestInit): Promise<Response> {
  let answer: Response;
  try {
    answer = await fetch(url, {
      ...init,
      cache: 'no-store',
      ...(!init.keepalive && { signal: AbortSignal.timeout(30_000) }),
    });
  } catch {
    throw new JoinCallError('offline');
  }
  if (answer.ok) return answer;
  throw new JoinCallError(
    answer.status === 404
      ? 'gone'
      : answer.status === 429
        ? 'busy'
        : answer.status === 503
          ? 'full'
          : 'failed',
  );
}

import { syncWriteBodySchema } from '@simply-sub/core';
import type { SyncKeys } from '../../core/crypto/sync-crypto';

// Sync's calls to the API (BLUEPRINT §5.2, M10.8): GET reads a chain's sealed copy, PUT writes it (starting the chain
// with If-None-Match: *, or replacing the version it read with If-Match), DELETE ends it, each with the chain's auth
// secret. The server only ever sees the sealed bytes.

/** Why a call didn't do what it asked. */
export type SyncCallProblem =
  /** No network, or no answer. */
  | 'offline'
  /** The chain is gone: deleted from another device, started over, or 180 days unwritten. */
  | 'gone'
  /** Another device wrote since the version named: read, merge and write again. */
  | 'stale'
  /** Too many writes this minute. */
  | 'busy'
  /** The server has stored all it takes today, or has no room. */
  | 'full'
  /** The server refused what was sent: a copy over its limit, say. */
  | 'refused'
  | 'failed';

export class SyncCallError extends Error {
  constructor(readonly problem: SyncCallProblem) {
    super(`Sync's request failed: ${problem}`);
    this.name = 'SyncCallError';
  }
}

/** A chain's copy as read: its bytes and version, or that it hasn't changed since the version this device holds. */
export type ChainRead =
  { kind: 'copy'; bytes: Uint8Array<ArrayBuffer>; version: string } | { kind: 'unchanged' };

const base = '/api/v1/sync';

/** The chain's sealed copy; `held`, the version this device has, answers `unchanged` when it's still the latest. */
export async function readChain(keys: SyncKeys, held?: string): Promise<ChainRead> {
  const answer = await send(
    'GET',
    keys,
    held === undefined ? {} : { 'If-None-Match': `"${held}"` },
  );
  if (answer.status === 304) return { kind: 'unchanged' };
  return {
    kind: 'copy',
    bytes: new Uint8Array(await answer.arrayBuffer()),
    version: versionOf(answer),
  };
}

/** Writes the sealed copy: a new chain, or over `version`, the one this device read. Answers the new version. */
export async function writeChain(
  keys: SyncKeys,
  sealed: Uint8Array<ArrayBuffer>,
  version: string | 'new',
): Promise<string> {
  const answer = await send(
    'PUT',
    keys,
    version === 'new' ? { 'If-None-Match': '*' } : { 'If-Match': `"${version}"` },
    sealed,
  );
  return syncWriteBodySchema.parse(await answer.json()).data.version;
}

/** Ends the chain for every device. One that's gone already is as good as deleted. */
export async function deleteChain(keys: SyncKeys): Promise<void> {
  try {
    await send('DELETE', keys);
  } catch (error) {
    if (!(error instanceof SyncCallError && error.problem === 'gone')) throw error;
  }
}

/** The answer to a request, or a SyncCallError saying why there's no good one. */
async function send(
  method: 'GET' | 'PUT' | 'DELETE',
  { chainId, authSecret }: SyncKeys,
  headers: Record<string, string> = {},
  body?: Uint8Array<ArrayBuffer>,
): Promise<Response> {
  let answer: Response;
  try {
    answer = await fetch(`${base}/${chainId}`, {
      method,
      headers: {
        Authorization: `Bearer ${authSecret}`,
        ...(body !== undefined && { 'Content-Type': 'application/octet-stream' }),
        ...headers,
      },
      ...(body !== undefined && { body }),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new SyncCallError('offline');
  }
  if (answer.ok || answer.status === 304) return answer;
  throw new SyncCallError(
    answer.status === 404 || answer.status === 403
      ? 'gone'
      : answer.status === 412
        ? 'stale'
        : answer.status === 429
          ? 'busy'
          : answer.status === 503
            ? 'full'
            : answer.status === 400 || answer.status === 413
              ? 'refused'
              : 'failed',
  );
}

function versionOf(answer: Response): string {
  const version = /^"([1-9][0-9]*)"$/.exec(answer.headers.get('ETag') ?? '')?.[1];
  if (version === undefined) throw new SyncCallError('failed');
  return version;
}

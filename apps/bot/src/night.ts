import { OutOfRequests, requestsPerPart, type Requests } from './requests';
import type { Step, StepOptions } from './run';
import { kvCallsPerPart, Writes, writesPerNight } from './writes';

// A night in parts (BLUEPRINT §6.4): a Workflow instance is a part, which sends out at most requestsPerPart requests.
// Each step gets what's left of them; one that would pass it stops the part, and the night goes on in its next part, a
// new instance that runs the night again from the top. The steps earlier parts finished return what they returned,
// kept in KV, so the next part sends nothing for them and starts where the last one stopped.

/** The part's requests are spent: the night goes on in its next part, from `step`. */
export class NightContinues extends Error {
  constructor(readonly step: string) {
    super(`The night goes on in its next part, from ${step}`);
    this.name = 'NightContinues';
  }
}

/**
 * Why a step that may wait (a page check) wasn't started: the night has made its KV writes (writes.ts), or it's past
 * the parts its checks may take, which leaves the rest for the digest and the check dates. It's left for another night.
 */
export class ChecksWait extends Error {
  constructor(readonly reason: 'writes' | 'parts') {
    super(
      reason === 'writes'
        ? 'The night has made its KV writes'
        : 'The night has used its parts for checks',
    );
    this.name = 'ChecksWait';
  }
}

/** A catch that notes a failed step and goes on rethrows this: the night isn't failing, it's continuing. */
export function rethrowContinues(error: unknown): void {
  if (error instanceof NightContinues) throw error;
}

/** What earlier parts' steps returned, and what this part's return for the next: KV, by the night and step name. */
export interface Memo {
  /** A step an earlier part finished, with what it returned, or why it failed. */
  get(name: string): Promise<{ value: unknown } | { failed: string } | undefined>;
  put(name: string, value: unknown): Promise<void>;
  /** A step whose tries are used up: a later part fails it at once, rather than trying it again. */
  fail(name: string, reason: string): Promise<void>;
}

/** A step's result as the Workflow keeps it: its value and its requests, or that it ran out. */
type Kept<T> = ({ value: T } | { out: true; whole: boolean }) & {
  requests: number;
  /** Its KV writes and deletes. A step kept before they were counted has none. */
  writes?: number;
};

/** The night's limits: its KV writes (writes.ts), this part's counter and what the parts before it made; its parts. */
export interface NightWrites {
  writes: Writes;
  before: number;
  /** The most a night's steps that may wait take: writesPerNight. */
  budget?: number;
  /** Which part this is, from 1. */
  part?: number;
  /** The last part that starts a step that may wait: checkParts. */
  lastCheckPart?: number;
  /** The requests to KV past which the part starts no new step: kvCallsPerPart. */
  kvCalls?: number;
}

/**
 * The most parts a night takes (index.ts): a runaway night stops here. Since 2026-11-24 the catalog's pages need more
 * than any night can read, so the checks stop starting after checkParts, and the oldest-checked go first (run.ts).
 */
export const maxParts = 40;
/** The parts a night's checks may start in: the rest are for the Bank of Canada's rate, the tidying and the digest. */
export const checkParts = 32;

/** Runs a Workflow step: once, its result kept, retried when it throws. */
export type RunStep = <T>(name: string, task: () => Promise<T>) => Promise<T>;

/**
 * The night's steps in one part. `run` is the Workflow's step; `memo` keeps each step's result for the parts after, and
 * gives this part the earlier parts' (`read`: from the second part on), a failure too. A step that runs out of requests
 * stops the part (NightContinues), unless it had the part's whole allowance: then it never fits, and it fails like any
 * other step. A step that may wait (a page check) isn't started once the night's KV writes are spent, or past its parts for checks (ChecksWait);
 * `writes()` is the night's so far, for its next part.
 */
export function partSteps(
  run: RunStep,
  requests: Requests,
  memo: Memo & { read: boolean },
  limit = requestsPerPart,
  {
    writes,
    before,
    budget = writesPerNight,
    part = 1,
    lastCheckPart = checkParts,
    kvCalls = kvCallsPerPart,
  }: NightWrites = {
    writes: new Writes(),
    before: 0,
  },
): Step & { writes(): number } {
  /** This part's requests so far: each finished step's, and its failed tries' in this invocation. */
  let spent = 0;
  /** The night's KV writes so far: the parts' before, then this part's steps', as their results record them. */
  let written = before;
  const step = async <T>(
    name: string,
    task: () => Promise<T>,
    options: StepOptions = {},
  ): Promise<T> => {
    const done = memo.read ? await memo.get(name) : undefined;
    if (done) {
      if ('failed' in done) throw new Error(done.failed);
      return done.value as T;
    }
    if (options.mayWait && written >= budget) throw new ChecksWait('writes');
    if (options.mayWait && part > lastCheckPart) throw new ChecksWait('parts');
    // A part's requests to Cloudflare's services are counted for the instance, as its requests out are: past
    // kvCalls, the night goes on in a new part (2026-11-25), but for the part's last step.
    if (!options.always && writes.calls >= kvCalls) throw new NightContinues(name);
    const fail = async (error: unknown) => {
      await memo.fail(name, error instanceof Error ? error.message : String(error));
      return error;
    };
    let result: Kept<T>;
    try {
      result = await run<Kept<T>>(name, async () => {
        const allowance = limit - spent;
        requests.start(allowance);
        writes.start();
        try {
          const value = await task();
          await memo.put(name, value);
          return { value, requests: requests.used, writes: writes.used };
        } catch (error) {
          if (error instanceof OutOfRequests) {
            return {
              out: true,
              requests: requests.used,
              whole: allowance >= limit,
              writes: writes.used,
            };
          }
          spent += requests.used;
          written += writes.used;
          throw error;
        }
      });
    } catch (error) {
      throw await fail(error);
    }
    spent += result.requests;
    written += result.writes ?? 0;
    if ('out' in result) {
      if (result.whole) {
        throw await fail(new Error(`${name} needs more than the ${limit} requests a part has`));
      }
      throw new NightContinues(name);
    }
    return result.value;
  };
  return Object.assign(step, { writes: () => written });
}

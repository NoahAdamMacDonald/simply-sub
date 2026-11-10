import { OutOfRequests, requestsPerPart, type Requests } from './requests';
import type { Step } from './run';

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
type Kept<T> = { value: T; requests: number } | { out: true; requests: number; whole: boolean };

/** Runs a Workflow step: once, its result kept, retried when it throws. */
export type RunStep = <T>(name: string, task: () => Promise<T>) => Promise<T>;

/**
 * The night's steps in one part. `run` is the Workflow's step; `memo` keeps each step's result for the parts after, and
 * gives this part the earlier parts' (`read`: from the second part on), a failure too. A step that runs out of requests
 * stops the part (NightContinues), unless it had the part's whole allowance: then it never fits, and it fails like any
 * other step.
 */
export function partSteps(
  run: RunStep,
  requests: Requests,
  memo: Memo & { read: boolean },
  limit = requestsPerPart,
): Step {
  /** This part's requests so far: each finished step's, and its failed tries' in this invocation. */
  let spent = 0;
  return async <T>(name: string, task: () => Promise<T>): Promise<T> => {
    const done = memo.read ? await memo.get(name) : undefined;
    if (done) {
      if ('failed' in done) throw new Error(done.failed);
      return done.value as T;
    }
    const fail = async (error: unknown) => {
      await memo.fail(name, error instanceof Error ? error.message : String(error));
      return error;
    };
    let result: Kept<T>;
    try {
      result = await run<Kept<T>>(name, async () => {
        const allowance = limit - spent;
        requests.start(allowance);
        try {
          const value = await task();
          await memo.put(name, value);
          return { value, requests: requests.used };
        } catch (error) {
          if (error instanceof OutOfRequests) {
            return { out: true, requests: requests.used, whole: allowance >= limit };
          }
          spent += requests.used;
          throw error;
        }
      });
    } catch (error) {
      throw await fail(error);
    }
    spent += result.requests;
    if ('out' in result) {
      if (result.whole) {
        throw await fail(new Error(`${name} needs more than the ${limit} requests a part has`));
      }
      throw new NightContinues(name);
    }
    return result.value;
  };
}

// The requests a night sends out (BLUEPRINT §6.4): on the free plan a Workflow instance may make 50 to the internet
// (Cloudflare's own services, D1, KV, Workers AI and Browser Rendering, have 1,000), and the nights of 2026-11-07 to
// 2026-11-09 ran out ("Too many subrequests by single Worker invocation") after robots.txt, every check after failing.
// So every request out is counted, step by step, and the night goes on in a new instance before it would pass them.

/**
 * What one part of a night (a Workflow instance) may send out: the free plan's 50, less a margin for the tries of a
 * step that failed, whose requests no result records.
 */
export const requestsPerPart = 40;

/** Thrown before a request that would pass the step's allowance, so that request is never sent. */
export class OutOfRequests extends Error {
  constructor() {
    super('This part of the night has no requests left');
    this.name = 'OutOfRequests';
  }
}

/** A catch that turns a failed request into a result rethrows this one: running out isn't the page's fault. */
export function rethrowOutOfRequests(error: unknown): void {
  if (error instanceof OutOfRequests) throw error;
}

/** Counts the requests a step sends out, refusing the first past its allowance. */
export class Requests {
  private allowance = Number.POSITIVE_INFINITY;
  /** The requests the step running now has sent. */
  used = 0;

  constructor(private readonly send: typeof fetch = (input, init) => fetch(input, init)) {}

  /** A step starts: it may send `allowance` more. */
  start(allowance: number): void {
    this.allowance = allowance;
    this.used = 0;
  }

  /** fetch, counted: throws OutOfRequests instead of sending one past the step's allowance. */
  readonly fetch: typeof fetch = (input, init) => {
    if (this.used >= this.allowance) throw new OutOfRequests();
    this.used++;
    // Called on its own: workerd refuses the global fetch called as an object's method ("Illegal invocation").
    const send = this.send;
    return send(input, init);
  };
}

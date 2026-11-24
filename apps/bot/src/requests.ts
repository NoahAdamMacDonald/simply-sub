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

  /**
   * fetch, counted: throws OutOfRequests instead of sending one past the step's allowance. Cloudflare counts each hop
   * of a redirect as a request of its own (the Internet Archive's copies always redirect), so redirects are followed
   * here, each hop counted, up to maxRedirects.
   */
  readonly fetch: typeof fetch = async (input, init) => {
    // Called on its own: workerd refuses the global fetch called as an object's method ("Illegal invocation").
    const send = this.send;
    const headers = init?.headers ?? (input instanceof Request ? input.headers : undefined);
    let response = await send(input, { ...this.counted(init), redirect: 'manual' });
    let url = input instanceof Request ? input.url : String(input);
    for (let hop = 0; hop < maxRedirects; hop++) {
      const location = redirectsTo(response);
      // A redirect that keeps its method and body (307, 308) can't be sent again: a GET has none to keep.
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (location === undefined || (method !== 'GET' && method !== 'HEAD')) return response;
      url = new URL(location, response.url || url).href;
      await response.body?.cancel();
      response = await send(url, {
        ...this.counted({
          method,
          ...(headers && { headers }),
          ...(init?.signal && { signal: init.signal }),
        }),
        redirect: 'manual',
      });
    }
    return response;
  };

  /** Counts a request about to be sent, or throws OutOfRequests before one past the allowance. */
  private counted(init: RequestInit | undefined): RequestInit {
    if (this.used >= this.allowance) throw new OutOfRequests();
    this.used++;
    return init ?? {};
  }
}

/** The most redirects a request follows, as browsers stop at about 20 but no page of ours needs more than a few. */
const maxRedirects = 5;

/** Where a redirect goes, or undefined for an answer that isn't one. */
function redirectsTo(response: Response): string | undefined {
  if (![301, 302, 303, 307, 308].includes(response.status)) return undefined;
  return response.headers.get('Location') ?? undefined;
}

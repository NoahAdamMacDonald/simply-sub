// Starts the optimizer's Web Worker under the production CSP (apps/api/public/_headers). Trusted Types make a Worker's
// URL a script sink, so a plain URL is refused: it goes through a policy of its own, `simply-sub#worker`, which the
// CSP allows and which only takes this origin's bundled worker files. Angular's build bundles a worker only for the
// exact form `new Worker(new URL('./x.worker', import.meta.url))`, so `Worker` here is a subclass of the browser's that
// passes its URL through the policy. No blob: URL and no eval.

/** What this needs of the browser's Trusted Types: TypeScript's DOM types don't have them. */
interface TrustedTypes {
  createPolicy(
    name: string,
    rules: { createScriptURL(input: string): string },
  ): { createScriptURL(input: string): unknown };
}

/** The bundled worker files: worker-<hash>.js and the chunks they share, at this origin. */
const workerFile = /\/worker-(?:chunk-)?[A-Z0-9]{8}\.[cm]?js$/;

let policy: ReturnType<TrustedTypes['createPolicy']> | undefined;

/** The URL as Trusted Types want it, where the browser has them; as it is elsewhere. */
function trustedWorkerUrl(url: URL): string {
  const trustedTypes = (globalThis as { trustedTypes?: TrustedTypes }).trustedTypes;
  if (!trustedTypes) return url.href;
  policy ??= trustedTypes.createPolicy('simply-sub#worker', {
    createScriptURL(input) {
      const parsed = new URL(input, location.href);
      if (parsed.origin !== location.origin || !workerFile.test(parsed.pathname)) {
        throw new TypeError('Not a worker file of this app');
      }
      return parsed.href;
    },
  });
  // A TrustedScriptURL, which the browser's Worker takes where a string is typed.
  return policy.createScriptURL(url.href) as string;
}

/** The optimizer's worker, or undefined where there are no Web Workers (tests). */
export function startOptimizerWorker(): globalThis.Worker | undefined {
  if (typeof globalThis.Worker !== 'function') return undefined;
  const Worker = class extends globalThis.Worker {
    constructor(url: URL, options?: WorkerOptions) {
      super(trustedWorkerUrl(url), options);
    }
  };
  return new Worker(new URL('./optimizer.worker', import.meta.url), { type: 'module' });
}

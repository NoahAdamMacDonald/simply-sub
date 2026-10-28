// The optimizer's Web Worker (PROJECT-PLAN P14): it runs core's optimize off the main thread for lists big enough to
// take longer than about 50 ms. It's bundled on its own (worker-*.js) and runs under the same CSP, Trusted Types
// included: it reaches no script sink, and Zod mustn't try `new Function` here either.
import '../../../zod-setup';
import { optimize } from '@simply-sub/core';
import type { OptimizerRequest, OptimizerResponse } from './optimizer-messages';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<OptimizerRequest>) => void) | null;
  postMessage(message: OptimizerResponse): void;
};

scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ id: data.id, result: optimize(data.input) });
  } catch (error) {
    // The message alone: it names the code's mistake, never the list's data.
    scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'Failed' });
  }
};

import type { OptimizerInput, OptimizerResult } from '@simply-sub/core';

// What the page and the optimizer's Web Worker say to each other: a list to optimize, and what came of it.

export interface OptimizerRequest {
  id: number;
  input: OptimizerInput;
}

export type OptimizerResponse =
  { id: number; result: OptimizerResult } | { id: number; error: string };

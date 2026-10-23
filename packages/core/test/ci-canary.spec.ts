import { describe, expect, it } from 'vitest';

// M0.10 acceptance check: this PR must be blocked from merging. Never merge it.
describe('CI canary', () => {
  it('fails on purpose', () => {
    expect(1 + 1).toBe(3);
  });
});

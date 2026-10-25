import './zod-setup';

describe('zod-setup', () => {
  it("turns off Zod's compiled parsers, which Trusted Types would report", async () => {
    const { config } = await import('zod/v4/core');

    expect(config().jitless).toBe(true);
  });
});

import { defineConfig } from 'vitest/config';

// The bot's logic is pure functions and an orchestration that takes its services as arguments, so its tests run on
// Node with fakes: a page, an AI answer, GitHub. Only src/index.ts touches workerd's own modules, and no test imports it.
export default defineConfig({
  // So the bot can import @simply-sub/core through the tsconfig.base.json alias.
  resolve: { tsconfigPaths: true },
});

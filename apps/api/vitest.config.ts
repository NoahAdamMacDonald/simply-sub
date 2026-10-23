import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Route tests run inside workerd with the bindings from wrangler.jsonc (BLUEPRINT §13.3).
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  // So the Worker can import @simply-sub/core through the tsconfig.base.json alias.
  resolve: { tsconfigPaths: true },
});

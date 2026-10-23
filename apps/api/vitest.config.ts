import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Route tests run inside workerd with the bindings from wrangler.jsonc (BLUEPRINT §13.3). Each test
// file gets a local D1 with the migrations applied (test/apply-migrations.ts).
export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    // So the Worker can import @simply-sub/core through the tsconfig.base.json alias.
    resolve: { tsconfigPaths: true },
    test: { setupFiles: ['./test/apply-migrations.ts'] },
  };
});

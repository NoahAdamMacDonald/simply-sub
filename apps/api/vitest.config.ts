import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { readdir, readFile } from 'node:fs/promises';
import { defineConfig } from 'vitest/config';
import { parse } from 'yaml';

// Route tests run inside workerd with the bindings from wrangler.jsonc (BLUEPRINT §13.3). Each test
// file gets a local D1 for the catalog and one for user data, each with its migrations applied
// (test/apply-migrations.ts).
export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  const userMigrations = await readD1Migrations('./migrations-user');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_USER_MIGRATIONS: userMigrations,
            TEST_CATALOG: await readCatalog(),
            // For test/static-headers.spec.ts, where the CSP must hash index.html's inline script, and
            // test/web-manifest.spec.ts, where the manifest's colours are the tokens' (M10.6).
            TEST_STATIC: {
              headers: await readFile(new URL('public/_headers', import.meta.url), 'utf8'),
              indexHtml: await readFile(new URL('../web/src/index.html', import.meta.url), 'utf8'),
              manifest: await readFile(
                new URL('../web/public/manifest.webmanifest', import.meta.url),
                'utf8',
              ),
              tokens: await readFile(
                new URL('../web/src/styles/_tokens.scss', import.meta.url),
                'utf8',
              ),
              appIcons: await readdir(new URL('../web/public/app-icons', import.meta.url)),
            },
          },
          // public/ holds the web build only after `npm run build`, which CI runs after the tests.
          // These stand in for the files data:build writes: the Worker passes them on unread.
          assets: { directory: './test/fixtures/assets' },
        },
      }),
    ],
    // So the Worker can import @simply-sub/core through the tsconfig.base.json alias.
    resolve: { tsconfigPaths: true },
    test: { setupFiles: ['./test/apply-migrations.ts'] },
  };
});

/**
 * The real catalog for the seed tests (test/seed.spec.ts): data/'s YAML files, parsed as YAML 1.2,
 * and the logos' file names. workerd can't read files, and a binding has to be JSON.
 */
async function readCatalog() {
  const root = new URL('../../data/', import.meta.url);
  const names = (await readdir(root, { recursive: true }))
    .map((name) => name.replaceAll('\\', '/'))
    .sort();
  return {
    files: await Promise.all(
      names
        .filter((name) => /\.ya?ml$/.test(name))
        .map(async (name) => ({
          file: `data/${name}`,
          data: parse(await readFile(new URL(name, root), 'utf8')) as unknown,
        })),
    ),
    logos: names.filter((name) => /^logos\/.+\.png$/.test(name)).map((name) => `data/${name}`),
  };
}

import type { D1Migration } from 'cloudflare:test';

// Bindings that exist only in tests (vitest.config.ts).
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      /** data/'s YAML files, parsed, and the logos' file names. */
      TEST_CATALOG: { files: { file: string; data: unknown }[]; logos: string[] };
      /** public/_headers and the web app's src/index.html, as text. */
      TEST_STATIC: { headers: string; indexHtml: string };
    }
  }
}

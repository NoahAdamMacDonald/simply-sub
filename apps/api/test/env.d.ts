import type { D1Migration } from 'cloudflare:test';

// Bindings that exist only in tests (vitest.config.ts).
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      /** migrations-user/'s, for USER_DB. */
      TEST_USER_MIGRATIONS: D1Migration[];
      /** data/'s YAML files, parsed, and the logos' file names. */
      TEST_CATALOG: { files: { file: string; data: unknown }[]; logos: string[] };
      /**
       * public/_headers, and the web app's src/index.html, manifest and colour tokens, as text, with the names of
       * its app icons.
       */
      TEST_STATIC: {
        headers: string;
        indexHtml: string;
        manifest: string;
        tokens: string;
        appIcons: string[];
      };
    }
  }
}

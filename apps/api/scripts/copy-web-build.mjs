// Copies the Angular production build into the Worker's static assets (BLUEPRINT §7.3):
//   apps/web/dist/web/browser/*      → apps/api/public/simply/sub/
//   apps/web/dist/web/browser/index.html → apps/api/public/index.html, which the SPA fallback serves
//                                      for unknown paths. Its <base href="/simply/sub/"> still loads
//                                      the right files.
// With --optional, a missing web build only creates public/, so `wrangler dev` can serve the API.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const build = fileURLToPath(new URL('../../web/dist/web/browser/', import.meta.url));
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const appDir = fileURLToPath(new URL('../public/simply/sub/', import.meta.url));
const optional = process.argv.includes('--optional');

mkdirSync(publicDir, { recursive: true });

if (!existsSync(`${build}index.html`)) {
  if (optional) {
    console.warn(
      'No web build in apps/web/dist yet: serving the API only. Run `npm run build` first.',
    );
    process.exit(0);
  }
  console.error('No web build in apps/web/dist/web/browser. Build the app first (npm run build).');
  process.exit(1);
}

const index = readFileSync(`${build}index.html`, 'utf8');
if (!/<base href="\/simply\/sub\/"/.test(index)) {
  console.error(
    'apps/web/dist holds a development build. Run the production build (npm run build).',
  );
  process.exit(1);
}

// Replace the previous copy, but leave anything else in public/ (such as _headers) alone.
rmSync(fileURLToPath(new URL('../public/simply/', import.meta.url)), {
  recursive: true,
  force: true,
});
cpSync(build, appDir, { recursive: true });
cpSync(`${build}index.html`, `${publicDir}index.html`);
console.log('Copied the web build to apps/api/public/simply/sub/.');

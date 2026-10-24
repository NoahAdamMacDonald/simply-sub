// Copies the Angular production build into the Worker's static assets (BLUEPRINT §7.3):
//   apps/web/dist/web/browser/* → apps/api/public/, served from the root of https://sub.simplely.ca.
// The SPA fallback serves public/index.html for unknown paths, so deep links load the app.
// With --optional, a missing web build only creates public/, so `wrangler dev` can serve the API.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const build = fileURLToPath(new URL('../../web/dist/web/browser/', import.meta.url));
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const optional = process.argv.includes('--optional');
/** Tracked files in public/ that aren't part of the web build (BLUEPRINT §7.6). */
const keep = new Set(['_headers', '_redirects']);

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

// A production build names its bundle with a content hash (main-6XMYCLII.js); a development build doesn't.
const index = readFileSync(`${build}index.html`, 'utf8');
if (!/<script src="main-[\w-]+\.js"/.test(index)) {
  console.error(
    'apps/web/dist holds a development build. Run the production build (npm run build).',
  );
  process.exit(1);
}

// Replace the previous copy, but leave the tracked files in public/ alone.
for (const entry of readdirSync(publicDir)) {
  if (!keep.has(entry)) {
    rmSync(`${publicDir}${entry}`, { recursive: true, force: true });
  }
}
cpSync(build, publicDir, { recursive: true });
console.log('Copied the web build to apps/api/public/.');

// The production build (`npm run build` here), with the version Settings shows (PROJECT-PLAN M10.6): the commit being
// built, which Workers Builds gives as WORKERS_CI_COMMIT_SHA, or this checkout's, and the day. Other arguments go on to
// `ng build`, such as --output-path for a second build that brings the update prompt.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function checkoutCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

const commit = process.env.WORKERS_CI_COMMIT_SHA || checkoutCommit();
// Strings, each a JavaScript string literal (core/pwa/app-version.ts reads them).
const defines = {
  ...(commit && { ngAppCommit: commit.slice(0, 7) }),
  ngAppBuiltOn: new Date().toISOString().slice(0, 10),
};
execFileSync(
  process.execPath,
  [
    require.resolve('@angular/cli/bin/ng.js'),
    'build',
    ...Object.entries(defines).map(([name, value]) => `--define=${name}=${JSON.stringify(value)}`),
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
);

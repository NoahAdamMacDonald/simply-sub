// Brings the D1 catalog cache up to date with the build, writing only the rows that changed (BLUEPRINT §5.3, §6.3):
//   tsx scripts/seed-d1.ts --remote | --local [--full]
// It reads what D1 holds with `wrangler d1 execute --json`, then the rows of the providers that changed, writes the
// statements for what differs to apps/api/dist/seed.sql, and runs them with `wrangler d1 execute --file`, which leaves
// D1 as it was if a statement fails. A code-only deploy finds nothing to change and writes no rows; --full replaces
// everything. On the remote D1 it keeps to the catalog's daily share of rows written (core's seedDailyWrites, M11.8):
// over it, whole providers wait for the next seed, and the catalog row says how many. It seeds from the catalog.json
// that `npm run data:build` wrote, once the migrations are applied: apps/api's `npm run db:seed:remote` (part of
// `npm run deploy`, BLUEPRINT §7.6) and `npm run db:seed:local` (§7.5) run both.
import {
  catalogSnapshotSchema,
  planSeed,
  providersToRead,
  readSeedState,
  readStoredRows,
  seedDailyWrites,
  seedStateQueries,
  storedRowQueries,
  toIsoDate,
  type CatalogSnapshot,
} from '@simply-sub/core';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogFile, plural, repoRoot } from './lib/catalog-files';
import { providerHashes as hashesOf } from './lib/snapshot';

const database = 'simply-sub-catalog';
const seedFile = 'apps/api/dist/seed.sql';
const options = ['--remote', '--local', '--full'];

const args = process.argv.slice(2);
const targets = args.filter((arg) => arg === '--remote' || arg === '--local');
if (targets.length !== 1 || args.some((arg) => !options.includes(arg))) {
  console.error('Usage: tsx scripts/seed-d1.ts --remote | --local [--full]');
  process.exit(1);
}
const [target] = targets;
const where = target.slice(2);
const full = args.includes('--full');

const snapshot = await readSnapshot();
const providerHashes = hashesOf(snapshot);
const current = full ? undefined : readSeedState(queryD1(seedStateQueries.join('; ')));
// The rows of the providers that changed or went, which the seed compares with the build's.
const ids = current ? providersToRead(snapshot, { providerHashes, current }) : [];
const rows =
  ids.length > 0 ? readStoredRows(ids, queryD1(storedRowQueries(ids).join('; '))) : undefined;
// The account's daily rows are the remote D1's; a local one has no limit.
const budget =
  target === '--remote' ? { today: toIsoDate(new Date()), daily: seedDailyWrites } : undefined;
const { sql, writes, waiting } = planSeed(snapshot, { providerHashes, current, rows, budget });
const path = fileURLToPath(new URL(seedFile, repoRoot));
await mkdir(dirname(path), { recursive: true });
await writeFile(path, sql);

const version = snapshot.meta.catalogVersion;
const left =
  waiting.length > 0
    ? ` ${plural(waiting.length, 'provider or bundle')} wait for the next seed: ${waiting.join(', ')}.`
    : '';
if (sql === '') {
  console.log(
    waiting.length > 0
      ? `The ${where} D1's rows for today are spent.${left}`
      : `The ${where} D1 already holds catalog ${version}: nothing to write.`,
  );
} else {
  const statements = sql.trimEnd().split('\n').length;
  const from = current?.catalog
    ? `the changes from catalog ${current.catalog.version}`
    : 'everything (a full seed)';
  console.log(
    `Seeding the ${where} D1 with catalog ${version}: ${from}, ${plural(statements, 'statement')} in ${seedFile}, about ${plural(writes, 'row')} written.${left}`,
  );
  const [result] = wranglerJson(['--file', 'dist/seed.sql', '--yes']);
  // A remote import reports what D1 bills; a local run reports no counts.
  const written = (result as { meta?: { rows_written?: number } } | undefined)?.meta?.rows_written;
  console.log(written === undefined ? 'Done.' : `Done: ${plural(written, 'row')} written.`);
}

/** The catalog snapshot the build wrote, as written: parsing it would reorder its keys, which the json columns keep. */
async function readSnapshot(): Promise<CatalogSnapshot> {
  const text = await readFile(new URL(catalogFile, repoRoot), 'utf8').catch(() => {
    console.error(`No ${catalogFile}: run npm run data:build first.`);
    process.exit(1);
  });
  const json: unknown = JSON.parse(text);
  const checked = catalogSnapshotSchema.safeParse(json);
  if (!checked.success) {
    console.error(`${catalogFile} isn't a catalog snapshot: run npm run data:build again.`);
    process.exit(1);
  }
  return json as CatalogSnapshot;
}

/** Each statement's rows, from `wrangler d1 execute --command`. */
function queryD1(command: string): unknown[] {
  return wranglerJson(['--command', command]).map(
    (statement) => (statement as { results?: unknown }).results,
  );
}

/**
 * Runs `wrangler d1 execute --json` on the target D1 with the repo's wrangler, in apps/api, where wrangler.jsonc and
 * the local D1 (.wrangler/state) are, and returns its result for each statement. Stops the script if it fails.
 */
function wranglerJson(executeArgs: string[]): unknown[] {
  const bin = join(
    dirname(createRequire(import.meta.url).resolve('wrangler/package.json')),
    'bin/wrangler.js',
  );
  const result = spawnSync(
    process.execPath,
    [bin, 'd1', 'execute', database, target, '--json', ...executeArgs],
    {
      cwd: fileURLToPath(new URL('apps/api/', repoRoot)),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const output = result.status === 0 ? parsedJson(result.stdout) : undefined;
  if (!Array.isArray(output)) {
    console.error(
      `wrangler d1 execute failed on the ${where} D1:\n${result.stdout}${result.stderr}`,
    );
    process.exit(result.status || 1);
  }
  return output;
}

/**
 * wrangler's JSON, from the first line that starts it: a remote --file run prints its upload progress to stdout
 * first, even with --json.
 */
function parsedJson(text: string): unknown {
  const start = text.search(/^[[{]/m);
  try {
    return start < 0 ? undefined : JSON.parse(text.slice(start));
  } catch {
    return undefined;
  }
}

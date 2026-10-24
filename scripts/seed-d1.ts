// Brings the D1 catalog cache up to date with the build, writing only what changed (BLUEPRINT §5.3, §6.3):
//   tsx scripts/seed-d1.ts --remote | --local [--full]
// It reads what D1 holds with `wrangler d1 execute --json`, writes the statements for what differs to
// apps/api/dist/seed.sql, and runs them with `wrangler d1 execute --file`, which leaves D1 as it was if a statement
// fails. A code-only deploy finds nothing to change and writes no rows; --full replaces everything. It seeds from the
// catalog.json that `npm run data:build` wrote, once the migrations are applied: apps/api's `npm run db:seed:remote`
// (part of `npm run deploy`, BLUEPRINT §7.6) and `npm run db:seed:local` (§7.5) run both.
import {
  buildSeedSql,
  catalogSnapshotSchema,
  readSeedState,
  seedStateQueries,
  type CatalogSnapshot,
} from '@simply-sub/core';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogFile, plural, repoRoot } from './lib/catalog-files';

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
const providerHashes = new Map(
  snapshot.data.providers.map((provider) => [
    provider.id,
    createHash('sha256').update(JSON.stringify(provider)).digest('hex'),
  ]),
);
const current = full ? undefined : readSeedState(queryD1(seedStateQueries.join('; ')));
const sql = buildSeedSql(snapshot, { providerHashes, current });
const path = fileURLToPath(new URL(seedFile, repoRoot));
await mkdir(dirname(path), { recursive: true });
await writeFile(path, sql);

const version = snapshot.meta.catalogVersion;
if (sql === '') {
  console.log(`The ${where} D1 already holds catalog ${version}: nothing to write.`);
} else {
  const statements = sql.trimEnd().split('\n').length;
  const from = current?.catalog
    ? `the changes from catalog ${current.catalog.version}`
    : 'everything (a full seed)';
  console.log(
    `Seeding the ${where} D1 with catalog ${version}: ${from}, ${plural(statements, 'statement')} in ${seedFile}.`,
  );
  const [result] = wranglerJson(['--file', 'dist/seed.sql', '--yes']);
  // A remote import reports what D1 bills; a local run reports no counts.
  const rows = (result as { meta?: { rows_written?: number } } | undefined)?.meta?.rows_written;
  console.log(rows === undefined ? 'Done.' : `Done: ${plural(rows, 'row')} written.`);
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

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

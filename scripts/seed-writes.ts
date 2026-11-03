// What seeding this branch's catalog would write to D1 (M11.8, BLUEPRINT §5.3), estimated for each pull request in CI:
// core's seed, run against main's catalog at the merge base (what D1 holds), built the way data:build builds it, and
// without asking D1. It never fails: the seed's daily budget (core's seedDailyWrites) holds back what doesn't fit, a
// whole provider at a time, so a large batch only takes more days to reach D1. In GitHub Actions the line is a notice
// on the pull request.
//   npm run data:writes
import {
  planSeed,
  seedDailyWrites,
  seedStateOf,
  storedRowsOf,
  toIsoDate,
  type CatalogSnapshot,
} from '@simply-sub/core';
import { checkCatalog, countErrors, plural } from './lib/catalog-files';
import { filesAt, mergeBase } from './lib/published-ids';
import { buildSnapshot, providerHashes } from './lib/snapshot';

const generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const base = mergeBase();
if ('skipped' in base) {
  say(`No estimate of D1's writes: ${base.skipped}.`);
  process.exit(0);
}
const { sources, issues } = await checkCatalog();
if (countErrors(issues) > 0) {
  say("No estimate of D1's writes: the catalog has errors (npm run data:validate).");
  process.exit(0);
}

let main: CatalogSnapshot;
try {
  main = buildSnapshot(filesAt(base.commit, { logos: true }), generatedAt).snapshot;
} catch (error) {
  say(
    `No estimate of D1's writes: main's catalog doesn't read with this branch's schemas (${(error as Error).message.split('\n')[0]}).`,
  );
  process.exit(0);
}
const branch = buildSnapshot(sources, generatedAt).snapshot;
const mainHashes = providerHashes(main);
const options = {
  providerHashes: providerHashes(branch),
  current: seedStateOf(main, mainHashes),
  rows: storedRowsOf(main, mainHashes),
};
const all = planSeed(branch, options);
const today = planSeed(branch, {
  ...options,
  budget: { today: toIsoDate(new Date()), daily: seedDailyWrites },
});

const at = base.commit.slice(0, 7);
if (all.writes === 0) {
  say(`Seeding this catalog writes nothing to D1: its rows are main's (${at}).`);
} else {
  const providers = new Set(
    branch.data.providers
      .filter((provider) => mainHashes.get(provider.id) !== options.providerHashes.get(provider.id))
      .map((provider) => provider.id),
  );
  const over =
    today.waiting.length > 0
      ? ` That's over a day's ${seedDailyWrites.toLocaleString('en-CA')}: ${plural(today.waiting.length, 'provider or bundle')} would wait for the next days' seeds.`
      : ` The catalog may write ${seedDailyWrites.toLocaleString('en-CA')} a day.`;
  say(
    `Seeding this catalog over main's (${at}) writes about ${plural(all.writes, 'row')} to D1, for ${plural(providers.size, 'changed provider')}.${over}`,
  );
}

/** Prints `text`, as a notice on the pull request in GitHub Actions. */
function say(text: string): void {
  console.log(
    process.env['GITHUB_ACTIONS'] === 'true' ? `::notice title=D1 writes::${text}` : text,
  );
}

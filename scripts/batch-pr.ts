// One command for a batch of new providers (BLUEPRINT §6.5 ⑥, M3.5): finds each one's pages, reads them in the browser,
// has them extracted (Workers AI, or a session's model answering the requests it writes), drafts each provider file,
// fetches each new provider's logo the way npm run data:icons does, checks the catalog, marks the queue, and opens one
// pull request with a table to review them by. It never merges.
//
//   npm run data:batch -- --next 10                    the next ten queued services
//   npm run data:batch -- bitdefender claude            these queue entries
//   options: --model workers-ai    Workers AI answers (CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in .env); without
//                                  it, the command stops after writing each request, and runs again once each
//                                  .pipeline/<id>/answer.json is there
//            --base <branch>       the branch the pull request goes into (main by default)
//            --leave-out-broken    leave out a draft data:validate rejects, instead of stopping
//            --dry-run             everything but the branch, the commit and the pull request
import {
  batchIdsIn,
  batchReview,
  nextQueued,
  queueFileSchema,
  readIconImage,
  toIsoDate,
  type BatchProvider,
  type Evidence,
  type ExtractionIssue,
  type ProposedFeature,
  type QueueEntry,
} from '@simply-sub/core';
import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { format, resolveConfig } from 'prettier';
import { isSeq, parseDocument } from 'yaml';
import { checkCatalog, formatIssue, plural } from './lib/catalog-files';
import {
  absolute,
  readJson,
  workFile,
  type FoundUrls,
  type PageRecord,
} from './lib/pipeline-files';

const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const model = option('--model');
const base = option('--base') ?? 'main';
const dryRun = args.includes('--dry-run');
const today = toIsoDate(new Date());

const queue = queueFileSchema.parse(
  parseDocument(await readFile(absolute('data/queue.yaml'), 'utf8')).toJS() ?? [],
);
const pending = openBatches();
const rejected = closedBatches();
const ids = args.filter(
  (arg, index) =>
    !arg.startsWith('--') && !['--model', '--base', '--next'].includes(args[index - 1] ?? ''),
);
const batch: QueueEntry[] = args.includes('--next')
  ? nextQueued(queue, Number(option('--next')), new Set([...pending, ...rejected]))
  : ids.map(
      (id) => queue.find((entry) => entry.id === id) ?? fail(`"${id}" isn't in data/queue.yaml.`),
    );
if (batch.length === 0) fail('Nothing to do: name queue entries, or use --next <count>.');
for (const entry of batch) {
  if (entry.status !== 'queued') fail(`${entry.id} is ${entry.status} in the queue, not queued.`);
  if (pending.includes(entry.id)) fail(`${entry.id} is in an open batch pull request already.`);
}
console.log(`The batch: ${batch.map((entry) => entry.id).join(', ')}.`);

// Find and read each one's pages, once: a step that has run keeps its files in .pipeline/<id>/.
for (const entry of batch) {
  if (!(await exists(workFile(entry.id, 'urls.json'))))
    run('find-urls.ts', [entry.id, '--browser']);
  if (!(await exists(workFile(entry.id, 'pages')))) run('render-pages.ts', [entry.id]);
}
const unanswered: string[] = [];
for (const entry of batch) {
  if (await exists(workFile(entry.id, 'answer.json'))) continue;
  if (model === 'workers-ai') run('extract-plans.ts', [entry.id, '--model', 'workers-ai']);
  else {
    run('extract-plans.ts', [entry.id, '--prepare']);
    unanswered.push(entry.id);
  }
}
if (unanswered.length > 0) {
  console.log(
    `\nAnswer each request in its answer.json (${unanswered.map((id) => workFile(id, 'extraction.md')).join(', ')}), then run this again.`,
  );
  process.exit(0);
}

// Draft each provider, then fetch the new ones' logos.
const results: BatchProvider[] = [];
for (const entry of batch) {
  const found = await readJson<FoundUrls>(workFile(entry.id, 'urls.json'));
  const pages = await pagesRead(entry.id);
  if (pages.length === 0) {
    results.push(left(entry, 'unreadable', unreadableNote(found)));
    continue;
  }
  run('extract-plans.ts', [entry.id], true);
  const report = await readJson<{
    outOfScope?: string;
    issues: ExtractionIssue[];
    proposedFeatures: ProposedFeature[];
    evidence: Evidence[];
  }>(workFile(entry.id, 'report.json'));
  if (report?.outOfScope) {
    results.push(left(entry, 'out-of-scope', report.outOfScope));
    continue;
  }
  if (!(await exists(`data/providers/${entry.id}.yaml`))) {
    // No page that could be read shows its plans (Crunchyroll's are only on a page that shows the bot an error):
    // unreadable, with the answer's own words for why; anything else is a draft to fix.
    const answer = await readJson<{ notOnPages?: string[] }>(workFile(entry.id, 'answer.json'));
    const unpriced = report?.issues.some((issue) =>
      issue.reason.startsWith('No plan with a checked price'),
    );
    const why = answer?.notOnPages?.[0];
    results.push(
      unpriced && why
        ? left(entry, 'unreadable', why)
        : left(entry, 'needs-fix', 'Nothing held up: see .pipeline/<id>/report.json'),
    );
    continue;
  }
  const provider = parseDocument(
    await readFile(absolute(`data/providers/${entry.id}.yaml`), 'utf8'),
  ).toJS();
  results.push({
    id: entry.id,
    name: entry.name,
    website: entry.website,
    status: 'drafted',
    provider,
    pages,
    issues: report?.issues ?? [],
    proposedFeatures: report?.proposedFeatures ?? [],
    evidence: report?.evidence ?? [],
  });
}
const drafted = results.filter((result) => result.status === 'drafted');
// The new providers' logos, and the new resellers' (data/resellers.yaml without a logo yet).
const resellerIds = await resellersWithoutLogo();
if (drafted.length > 0)
  run('fetch-icons.ts', [...drafted.map((result) => result.id), ...resellerIds], true);
for (const result of drafted) result.logo = await logoOf(result.id);

// The catalog must pass data:validate: a broken draft stops the batch, or is left out with --leave-out-broken.
const { issues } = await checkCatalog();
for (const result of drafted) {
  const errors = issues.filter(
    ({ issue }) => issue.file === `data/providers/${result.id}.yaml` && issue.severity === 'error',
  );
  if (errors.length === 0) continue;
  for (const error of errors) console.log(`Error: ${formatIssue(error)}`);
  if (!args.includes('--leave-out-broken')) {
    fail(
      `${result.id}'s draft has ${plural(errors.length, 'error')}: fix it (or answer.json) and run this again.`,
    );
  }
  await rename(
    absolute(`data/providers/${result.id}.yaml`),
    absolute(workFile(result.id, 'draft.yaml')),
  );
  Object.assign(result, { status: 'needs-fix', note: errors.map(formatIssue).join('; ') });
}

// The queue first: save-baselines checks the whole catalog, and a drafted provider's entry must say done by then.
await markQueue(results);

// Each new provider's pages become baselines for the nightly bot (M3.6), from the pages the batch read.
const keptIds = results.filter((result) => result.status === 'drafted').map((result) => result.id);
if (keptIds.length > 0) run('save-baselines.ts', keptIds);

const body = batchReview(results, {
  date: today,
  extractor: model === 'workers-ai' ? 'Workers AI' : 'a session’s model (Claude)',
});
await writeFile(absolute('.pipeline/batch-pr.md'), body);
const kept = results.filter((result) => result.status === 'drafted');
console.log(
  `\n${plural(kept.length, 'provider')} drafted, ${plural(results.length - kept.length, 'left out')}. The pull request's text is in .pipeline/batch-pr.md.`,
);
if (dryRun) process.exit(0);

const branch = `catalog/batch-${today}-${batch[0].id}`;
const files = [
  'data/queue.yaml',
  'data/resellers.yaml',
  ...resellerIds.flatMap((id) => [`data/logos/${id}.png`]),
  ...kept.flatMap((result) => [
    `data/providers/${result.id}.yaml`,
    ...(result.logo ? [`data/logos/${result.id}.png`] : []),
  ]),
];
git(['switch', '-c', branch]);
git(['add', ...files, 'data/baselines']);
git([
  'commit',
  '-m',
  `feat(catalog): ${kept.map((result) => result.name).join(', ') || 'the queue'} (discovery batch of ${today})`,
  '-m',
  'Drafted by the discovery pipeline (BLUEPRINT §6.5): every fact quoted from the provider’s own pages.',
]);
git(['push', '-u', 'origin', branch]);
const pr = spawnSync(
  'gh',
  [
    'pr',
    'create',
    '--base',
    base,
    '--head',
    branch,
    '--title',
    `Catalog: ${kept.map((result) => result.name).join(', ')}`,
    '--body-file',
    absolute('.pipeline/batch-pr.md'),
  ],
  { stdio: 'inherit' },
);
process.exitCode = pr.status ?? 1;

/** Runs a pipeline script with tsx, stopping on failure unless `tolerate`. */
function run(script: string, scriptArgs: string[], tolerate = false): void {
  const tsx = createRequire(import.meta.url).resolve('tsx/cli');
  const result = spawnSync(process.execPath, [tsx, `scripts/${script}`, ...scriptArgs], {
    stdio: 'inherit',
    cwd: absolute('.'),
  });
  if (result.status !== 0 && !tolerate) fail(`${script} ${scriptArgs.join(' ')} failed.`);
}

function git(gitArgs: string[]): void {
  const result = spawnSync('git', gitArgs, { stdio: 'inherit', cwd: absolute('.') });
  if (result.status !== 0) fail(`git ${gitArgs[0]} failed.`);
}

/** The queue ids of the open batch pull requests, which no new batch takes. */
function openBatches(): string[] {
  return batchPulls('open').flatMap((pull) => batchIdsIn(pull.body));
}

/** The queue ids of batch pull requests closed without merging: rejected, unless merged since. */
function closedBatches(): string[] {
  return batchPulls('closed')
    .filter((pull) => !pull.mergedAt)
    .flatMap((pull) => batchIdsIn(pull.body));
}

function batchPulls(state: 'open' | 'closed'): { body: string; mergedAt?: string | null }[] {
  const result = spawnSync(
    'gh',
    [
      'pr',
      'list',
      '--state',
      state,
      '--search',
      'head:catalog/batch-',
      '--json',
      'body,mergedAt',
      '--limit',
      '100',
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) return [];
  try {
    return JSON.parse(result.stdout) as { body: string; mergedAt?: string | null }[];
  } catch {
    return [];
  }
}

async function pagesRead(id: string): Promise<{ kind: PageRecord['kind']; url: string }[]> {
  const found = await readJson<FoundUrls>(workFile(id, 'urls.json'));
  const pages: { kind: PageRecord['kind']; url: string }[] = [];
  for (const kind of Object.keys(found?.pages ?? {})) {
    const record = await readJson<PageRecord | { error: string }>(
      workFile(id, `pages/${kind}.json`),
    );
    if (record && !('error' in record)) pages.push({ kind: record.kind, url: record.finalUrl });
  }
  return pages;
}

function unreadableNote(found: FoundUrls | undefined): string {
  const reasons = new Set(
    found?.reports.flatMap((report) => report.tried.map((tried) => tried.result)) ?? [],
  );
  const blocked = [...reasons].find((reason) => /robots|403|bot check|error page/i.test(reason));
  return blocked ?? 'No page of it could be read';
}

function left(entry: QueueEntry, status: BatchProvider['status'], note: string): BatchProvider {
  return {
    id: entry.id,
    name: entry.name,
    website: entry.website,
    status,
    note,
    pages: [],
    issues: [],
    proposedFeatures: [],
    evidence: [],
  };
}

async function logoOf(id: string): Promise<string | undefined> {
  try {
    const image = readIconImage(new Uint8Array(await readFile(absolute(`data/logos/${id}.png`))));
    return image ? `${image.width}×${image.height} PNG (data/logos/${id}.png)` : undefined;
  } catch {
    return undefined;
  }
}

/** Each entry's new status in data/queue.yaml, keeping its comments: done, or left out with why. */
async function markQueue(batchResults: readonly BatchProvider[]): Promise<void> {
  const file = absolute('data/queue.yaml');
  const document = parseDocument(await readFile(file, 'utf8'));
  const list = document.contents;
  if (!isSeq(list)) fail('data/queue.yaml must be a list');
  for (const result of batchResults) {
    // A draft to fix stays queued: the next run takes it again.
    if (result.status === 'needs-fix') continue;
    const index = list.items.findIndex((_, at) => document.getIn([at, 'id']) === result.id);
    if (index < 0) continue;
    document.setIn([index, 'status'], result.status === 'drafted' ? 'done' : result.status);
    document.setIn([index, 'date'], today);
    if (result.note) document.setIn([index, 'note'], result.note.slice(0, 200));
  }
  await mkdir(absolute('.pipeline'), { recursive: true });
  const text = document.toString({ lineWidth: 0 });
  await writeFile(file, await format(text, { ...(await resolveConfig(file)), filepath: file }));
}

/** The resellers that have no logo yet: the batch's new shops. */
async function resellersWithoutLogo(): Promise<string[]> {
  const list = parseDocument(await readFile(absolute('data/resellers.yaml'), 'utf8')).toJS() as
    { id: string }[] | null;
  const missing: string[] = [];
  for (const { id } of list ?? []) {
    if (!(await exists(`data/logos/${id}.png`))) missing.push(id);
  }
  return missing;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(absolute(path));
    return true;
  } catch {
    return false;
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

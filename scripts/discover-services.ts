// Adds services from Wikidata to the discovery queue, data/queue.yaml (BLUEPRINT §6.5, M3.1). For each class in
// core's wikidataClasses (video streaming service, VPN service, password manager…) it asks Wikidata's query service
// for the instances that have an official website (P856), then adds the ones that aren't in the catalog or the queue
// yet to the end of the queue, the most written-about first. Entries already there keep their place, status and
// comments; your own services stay first.
//
//   npm run data:queue                         up to 40 services per class, each with 8 Wikipedia articles or more
//   npm run data:queue -- --limit 100          up to 100 per class
//   npm run data:queue -- --min-sitelinks 3    lesser-known services too
//   npm run data:queue -- --dry-run            print what it would add, and write nothing
import {
  combineCandidates,
  mergeCandidates,
  providerSiteKeys,
  queueFileSchema,
  readWikidataResults,
  wikidataClasses,
  wikidataEndpoint,
  wikidataQuery,
  type QueueCandidate,
  type QueueEntry,
} from '@simply-sub/core';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { isSeq, parseDocument, type Document } from 'yaml';
import { loadCatalogFiles, plural, repoRoot } from './lib/catalog-files';

const queueFile = 'data/queue.yaml';
// Wikimedia asks for a User-Agent that names the client and how to reach its owner.
const userAgent = 'SimplySubBot/1.0 (+https://sub.simplely.ca/)';
const timeoutMs = 60_000;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limit = wholeNumber('--limit', 40, 1);
const minSitelinks = wholeNumber('--min-sitelinks', 8, 0);

const path = fileURLToPath(new URL(queueFile, repoRoot));
const document = await readQueue(path);
const queue = queueFileSchema.safeParse(document.toJS() ?? []);
if (!queue.success) {
  fail(`${queueFile} doesn't match its schema: run npm run data:validate`);
}

const { sources } = await loadCatalogFiles();
const providers = sources.flatMap((source) =>
  /^data\/providers\/[^/]+\.yaml$/.test(source.file) && 'data' in source
    ? [source.data as { id: string; website: string; domains?: string[] }]
    : [],
);
const catalog = {
  ids: providers.map((provider) => provider.id),
  sites: providers.flatMap((provider) => providerSiteKeys(provider)),
};

const perClass: QueueCandidate[][] = [];
for (const wikidataClass of wikidataClasses) {
  const found = await ask(
    wikidataQuery(wikidataClass.qid, Math.min(limit, wikidataClass.limit ?? limit), minSitelinks),
    wikidataClass.category,
  );
  console.log(`${wikidataClass.name} (${wikidataClass.qid}): ${plural(found.length, 'service')}`);
  perClass.push(found);
  // The query service allows a minute of query time a minute per client: one question at a time is plenty.
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
const { added, skipped } = mergeCandidates(queue.data, combineCandidates(perClass), catalog);

for (const { candidate } of skipped.filter(({ reason }) => reason === 'id-taken')) {
  console.log(
    `Left out ${candidate.name} (${candidate.website}): another service has the id "${candidate.id}". Add it by hand with an id of its own.`,
  );
}
const counts = new Map<string, number>();
for (const entry of added) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
console.log(
  `${dryRun ? 'Would add' : 'Added'} ${plural(added.length, 'service')}${counts.size > 0 ? ` (${[...counts].map(([category, count]) => `${category} ${count}`).join(', ')})` : ''}; ${skipped.filter(({ reason }) => reason === 'in-catalog').length} already in the catalog, ${skipped.filter(({ reason }) => reason === 'in-queue').length} already in the queue.`,
);
if (dryRun) {
  for (const entry of added) {
    console.log(
      `  ${entry.id}: ${entry.name} ${entry.website} (${entry.sitelinks ?? 0} sitelinks)`,
    );
  }
} else if (added.length > 0) {
  await writeQueue(path, document, added, !queue.data.some((entry) => entry.source === 'wikidata'));
  console.log(`Wrote ${queueFile}. Check it, then run npm run data:validate.`);
}

/** One class's instances, from the query service. */
async function ask(query: string, category: string): Promise<QueueCandidate[]> {
  const url = `${wikidataEndpoint}?format=json&query=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': userAgent, Accept: 'application/sparql-results+json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    fail(`Wikidata's query service answered ${response.status}. Try again later.`);
  }
  return readWikidataResults(await response.json(), category);
}

async function readQueue(file: string): Promise<Document> {
  const text = await readFile(file, 'utf8').catch(() => undefined);
  const document = parseDocument(text ?? '[]\n');
  if (document.errors.length > 0) {
    fail(`${queueFile} isn't valid YAML: run npm run data:validate`);
  }
  return document;
}

/**
 * Appends `entries` to the queue's list, keeping what's written above them, formatted as Prettier formats it. The
 * first Wikidata entries get a comment that says where the rest come from.
 */
async function writeQueue(
  file: string,
  document: Document,
  entries: QueueEntry[],
  first: boolean,
): Promise<void> {
  const list = document.contents;
  if (!isSeq(list)) {
    fail(`${queueFile} must be a list of services`);
  }
  // Block style, as people write the rest of the file.
  list.flow = false;
  entries.forEach((entry, index) => {
    const node = document.createNode(entry);
    if (first && index === 0) {
      node.commentBefore = ' Wikidata (npm run data:queue), the most written-about first.';
      node.spaceBefore = true;
    }
    list.items.push(node);
  });
  const text = document.toString({ lineWidth: 0 });
  await writeFile(file, await format(text, { ...(await resolveConfig(file)), filepath: file }));
}

/** The whole number after `flag`, or `fallback` without the flag. */
function wholeNumber(flag: string, fallback: number, min: number): number {
  if (!args.includes(flag)) return fallback;
  const text = args[args.indexOf(flag) + 1];
  const value = Number(text);
  if (!Number.isInteger(value) || value < min) {
    fail(`${flag} takes a whole number of at least ${min}, not "${text}"`);
  }
  return value;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

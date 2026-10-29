import * as z from 'zod';
import { addDuplicateIssues } from '../catalog/checks';
import { httpsUrlSchema, isoDateSchema, slugSchema, textSchema } from '../catalog/formats';
import { yamlScalar } from './draft-yaml';
import { bareHost, parseWebAddress } from './web-address';

// The discovery queue, data/queue.yaml (BLUEPRINT §6.5, M3.1): the services the pipeline adds next, in order. The
// user's own services come first (§6.6), then Wikidata's, the most written-about first. An entry's status says where
// it is, so nothing is retried every night: queued until a batch adds it, done once it's in the catalog, or why it
// was left out.

export const queueStatusSchema = z
  .enum(['queued', 'done', 'rejected', 'unreadable', 'out-of-scope'])
  .describe(
    'queued: a batch takes it next. done: it has a provider file. rejected: a person said no. unreadable: its pages couldn’t be read (a bot check, a geo-block). out-of-scope: not a personal or family subscription (business only, free, closed)',
  );
export type QueueStatus = z.infer<typeof queueStatusSchema>;

/** Statuses that say why a service was left out, which need a note. */
const explained: readonly QueueStatus[] = ['rejected', 'unreadable', 'out-of-scope'];

export const queueEntrySchema = z
  .strictObject({
    id: slugSchema.describe(
      'The provider id it gets, and its file name once added (xbox-game-pass)',
    ),
    name: textSchema.describe('Its name, as the provider writes it'),
    website: httpsUrlSchema.describe('Its home page, where the pipeline starts looking'),
    category: slugSchema.describe('A service category id from categories.yaml'),
    source: z
      .enum(['own', 'wikidata', 'manual'])
      .describe(
        'own: one of your own services, first in the queue. wikidata: found by npm run data:queue. manual: added by hand',
      ),
    wikidata: z
      .string()
      .regex(/^Q[1-9]\d*$/, 'Use a Wikidata item id (Q907311)')
      .describe('Its Wikidata item, when it came from there')
      .optional(),
    sitelinks: z
      .int()
      .nonnegative()
      .describe('How many Wikipedia articles it has: the queue puts the most written-about first')
      .optional(),
    status: queueStatusSchema,
    date: isoDateSchema.describe('When its status last changed').optional(),
    note: textSchema
      .describe(
        'Why it was rejected, couldn’t be read or is out of scope, or anything else to know',
      )
      .optional(),
  })
  .superRefine((entry, ctx) => {
    if (explained.includes(entry.status) && entry.note === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: `Say why it's ${entry.status} in a note, so nobody adds it again`,
        path: ['status'],
      });
    }
  });
export type QueueEntry = z.infer<typeof queueEntrySchema>;

export const queueFileSchema = z
  .array(queueEntrySchema)
  .superRefine((entries, ctx) => {
    addDuplicateIssues(
      ctx,
      entries.map((entry) => entry.id),
      (index) => [index, 'id'],
    );
    addDuplicateIssues(
      ctx,
      entries.map((entry) => siteKey(entry.website) ?? entry.website),
      (index) => [index, 'website'],
    );
  })
  .meta({
    title: 'Simply Sub discovery queue',
    description:
      'data/queue.yaml: the services the discovery pipeline adds next, in order, and what became of each (BLUEPRINT §6.5)',
  });

/**
 * What identifies a website: its host without `www.` and its path, in lower case, without a trailing slash or a
 * query (`netflix.com`, `xbox.com/xbox-game-pass`). Undefined for something that isn't a URL. Two services can share
 * a host (apple.com/music and apple.com/apple-tv-plus), so the path counts.
 */
export function siteKey(url: string): string | undefined {
  const address = parseWebAddress(url);
  if (!address) return undefined;
  return `${bareHost(address.host)}${address.path.toLowerCase().replace(/\/+$/, '')}`;
}

/** The sites a catalog provider is on: its website and its other domains. */
export function providerSiteKeys(provider: {
  website: string;
  domains?: readonly string[];
}): string[] {
  const keys = [
    siteKey(provider.website),
    ...(provider.domains ?? []).map((domain) => siteKey(`https://${domain}`)),
  ];
  return keys.filter((key): key is string => key !== undefined);
}

/**
 * Whether `website` is one of these sites, or a page on one: `netflix.com` covers `netflix.com/ca`, and a provider on
 * `proton.me` covers Proton Mail's `proton.me/mail`.
 */
export function onSites(website: string, keys: readonly string[]): boolean {
  const key = siteKey(website);
  return key !== undefined && keys.some((site) => key === site || key.startsWith(`${site}/`));
}

/**
 * data/queue.yaml's text with an entry's new status, the day it changed and, for one left out, why: its other lines
 * and the file's comments as they were, in the layout Prettier keeps. Undefined when the entry isn't there.
 */
export function withQueueStatus(
  text: string,
  id: string,
  change: { status: QueueStatus; date: string; note?: string },
): string | undefined {
  const lines = text.split('\n');
  const start = lines.indexOf(`- id: ${id}`);
  if (start < 0) return undefined;
  let end = start + 1;
  while (end < lines.length && lines[end].startsWith('  ')) end++;
  const entry = lines.slice(start, end).filter((line) => !/^ {2}(?:status|date|note):/.test(line));
  entry.push(`  status: ${change.status}`, `  date: ${change.date}`);
  if (change.note !== undefined) entry.push(`  note: ${yamlScalar(change.note)}`);
  lines.splice(start, end - start, ...entry);
  return lines.join('\n');
}

/** The first `count` queued entries, in the queue's order, leaving out `skip` (ids already in an open pull request). */
export function nextQueued(
  queue: readonly QueueEntry[],
  count: number,
  skip: ReadonlySet<string> = new Set(),
): QueueEntry[] {
  return queue.filter((entry) => entry.status === 'queued' && !skip.has(entry.id)).slice(0, count);
}

/** A service found somewhere (Wikidata), before it's in the queue. */
export interface QueueCandidate {
  id: string;
  name: string;
  website: string;
  category: string;
  wikidata?: string;
  sitelinks?: number;
}

export interface QueueMerge {
  /** The queue's new entries, in the order they were added. */
  added: QueueEntry[];
  /** Candidates left out, with why. */
  skipped: { candidate: QueueCandidate; reason: 'in-catalog' | 'in-queue' | 'id-taken' }[];
}

/**
 * The candidates that join the end of the queue, queued, in their order: not the catalog's providers (on a provider's
 * site, as Proton Mail's proton.me/mail is), and not already in the queue (the same Wikidata item or the same site:
 * YouTube Premium's youtube.com/premium is another service than YouTube's youtube.com). A candidate whose id another
 * service has is left out rather than renamed, so a person decides.
 */
export function mergeCandidates(
  queue: readonly QueueEntry[],
  candidates: readonly QueueCandidate[],
  catalog: { ids: readonly string[]; sites: readonly string[] },
): QueueMerge {
  const ids = new Set([...catalog.ids, ...queue.map((entry) => entry.id)]);
  const items = new Set(queue.flatMap((entry) => (entry.wikidata ? [entry.wikidata] : [])));
  const sites = new Set(
    queue.flatMap((entry) => {
      const key = siteKey(entry.website);
      return key === undefined ? [] : [key];
    }),
  );
  const added: QueueEntry[] = [];
  const skipped: QueueMerge['skipped'] = [];
  for (const candidate of candidates) {
    if (onSites(candidate.website, catalog.sites) || catalog.ids.includes(candidate.id)) {
      skipped.push({ candidate, reason: 'in-catalog' });
    } else if (
      (candidate.wikidata !== undefined && items.has(candidate.wikidata)) ||
      sites.has(siteKey(candidate.website) ?? candidate.website)
    ) {
      skipped.push({ candidate, reason: 'in-queue' });
    } else if (ids.has(candidate.id)) {
      skipped.push({ candidate, reason: 'id-taken' });
    } else {
      added.push({
        id: candidate.id,
        name: candidate.name,
        website: candidate.website,
        category: candidate.category,
        source: 'wikidata',
        ...(candidate.wikidata !== undefined && { wikidata: candidate.wikidata }),
        ...(candidate.sitelinks !== undefined && { sitelinks: candidate.sitelinks }),
        status: 'queued',
      });
      ids.add(candidate.id);
      if (candidate.wikidata !== undefined) items.add(candidate.wikidata);
      sites.add(siteKey(candidate.website) ?? candidate.website);
    }
  }
  return { added, skipped };
}

/**
 * A provider id from a service's name: lower case, accents dropped, `+` as "plus" and `&` as "and", other characters
 * as hyphens (Disney+ → disney-plus). Empty when nothing is left.
 */
export function idFromName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/\+/g, ' plus ')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

import {
  baselineLines,
  baselinePath,
  batchReview,
  citedPages,
  draftFromAnswer,
  draftYaml,
  draftYamlList,
  extractionParts,
  featuresFileSchema,
  findKind,
  mergeAnswers,
  nextQueued,
  pageKinds,
  policyTopicsFileSchema,
  providerSchema,
  queueFileSchema,
  readModelAnswer,
  resellersFileSchema,
  surveySite,
  withQueueStatus,
  writeBaseline,
  type Automation,
  type BaselineMethod,
  type BatchProvider,
  type ExtractionAnswer,
  type ExtractionContext,
  type ExtractionPart,
  type Feature,
  type FindIo,
  type IsoDate,
  type KindReport,
  type PageKind,
  type PolicyTopic,
  type QueueEntry,
  type Reseller,
  type Robots,
  type SearchBudget,
  type SiteSurvey,
} from '@simply-sub/core';
import { parse } from 'yaml';
import type { RepositoryState } from './github';
import { findIcon, toBase64, type Download } from './icons';
import type { FileChange, Proposal } from './proposal';
import type { Step } from './run';
import type { BotState } from './state';
import type { Budget } from './types';

// The discovery in the bot (BLUEPRINT §6.5, M3.11): what `npm run data:batch -- --next <n> --model workers-ai` does on a
// computer, a step at a time in the night's Workflow, with what the night's checks and digest left. When
// data/automation.yaml's discovery cadence says so, it takes the next `batch.discovery` queued services (none in an
// open batch pull request, or a closed one that rejected it), and for each, over as many nights as its Neurons and
// browser pages take, finds its pages (a survey of its sites, then a step per kind, searching last), reads those only
// a browser shows, has Workers AI extract it part by part, and drafts its file with core's checks: every quote on its
// page word for word. Each service's work waits in KV between nights. Once all are done, one pull request on a
// `catalog/batch-` branch has the drafts, their logos and baselines, any new resellers and the queue's new statuses,
// with the review table. It never merges.

/** The batch under way: the queue entries it took, and the night it took them. */
export interface DiscoveryBatch {
  started: IsoDate;
  entries: Pick<QueueEntry, 'id' | 'name' | 'website' | 'category'>[];
}

/** A page of a service's, as found and read. */
export interface DiscoveredPage {
  kind: PageKind;
  url: string;
  /** Its text; none yet for a page only a browser shows, until Browser Rendering reads it. */
  text?: string;
  method: BaselineMethod;
}

/** A service's work so far, kept in KV between nights. */
export interface ServiceWork {
  pages?: DiscoveredPage[];
  /** Why pages couldn't be read (robots.txt, a 403, a bot check), for the note of one left out. */
  unread?: string[];
  /** Workers AI's answer to each part of the extraction: null for one that didn't match the schema. */
  answers?: (ExtractionAnswer | null)[];
  /** Nights one of its steps failed for good. */
  failures?: number;
  result?: ServiceResult;
}

/** A service done: drafted, with its files, or left out, with why. */
export interface ServiceResult {
  review: BatchProvider;
  /** Its provider file, logo and baselines. */
  files: FileChange[];
  /** Shops data/resellers.yaml doesn't list yet, with their logos. */
  resellers: Reseller[];
  resellerLogos: FileChange[];
}

/** How the discovery reads the web: core's search I/O, a browser, downloads for logos. */
export interface DiscoveryWeb extends FindIo {
  /** The text of a page the step read, by its final URL. */
  textOf(url: string): string | undefined;
  /** A page's text as a browser shows it (Browser Rendering). */
  browser(url: string): Promise<{ text: string } | { error: string }>;
  download: Download;
  /** Every host's robots.txt rules it knows, for the next step. */
  robots(): Record<string, Robots>;
}

export interface DiscoveryServices {
  state: BotState;
  /** A text file as the commit has it. */
  text(path: string, commit: string): Promise<string>;
  /** The queue ids in open batch pull requests, and in closed ones that weren't merged (rejected). */
  batchPulls(): Promise<{ open: string[]; closed: string[] }>;
  /** The web, with these robots.txt rules known, searching within these budgets this month. */
  web(
    robots: Readonly<Record<string, Robots>>,
    search: { budgets: SearchBudget[]; month: string },
  ): DiscoveryWeb;
  /** Workers AI's answer to one part of an extraction. */
  extract(system: string, user: string): Promise<unknown>;
  propose(state: RepositoryState, proposal: Proposal, branch: string): Promise<string>;
}

export interface DiscoveryInput {
  today: IsoDate;
  settings: Automation;
  repository: RepositoryState;
  budget: Budget;
  /** Whether a new batch is due by data/automation.yaml's discovery cadence. */
  due: boolean;
  searchBudgets: SearchBudget[];
}

export interface DiscoveryOutcome {
  budget: Budget;
  /** Whether a batch was looked for tonight, so the cadence counts from tonight. */
  took: boolean;
  pullRequest?: string;
}

/** The registries a draft is checked against, as main has them. */
interface Registries {
  features: Feature[];
  topics: PolicyTopic[];
  resellers: Reseller[];
}

/** About how many Neurons an extraction part takes: four characters a token, and the longest answer. */
const neuronsPerMillion = { input: 26_668, output: 204_805 };
export const extractionAnswerTokens = 4096;
/** How many nights a service's step may fail for good before it's left for a person. */
const maxFailures = 2;

/** The batch the discovery takes, from the queue as main has it, or undefined when nothing is queued. */
export function takeBatch(
  queueText: string,
  skip: ReadonlySet<string>,
  count: number,
  today: IsoDate,
): DiscoveryBatch | undefined {
  const queue = queueFileSchema.parse(parse(queueText) ?? []);
  const entries = nextQueued(queue, count, skip).map(({ id, name, website, category }) => ({
    id,
    name,
    website,
    category,
  }));
  return entries.length > 0 ? { started: today, entries } : undefined;
}

/** A night's discovery, after the checks and the digest. */
export async function discover(
  input: DiscoveryInput,
  step: Step,
  services: DiscoveryServices,
): Promise<DiscoveryOutcome> {
  const { today, settings, repository } = input;
  let budget = input.budget;
  const taken = await step('read the discovery batch', async () => {
    const current = await services.state.discovery();
    if (current) return { batch: current, took: false };
    if (!input.due) return { batch: null, took: false };
    const pulls = await services.batchPulls();
    const batch = takeBatch(
      await services.text('data/queue.yaml', repository.commit),
      new Set([...pulls.open, ...pulls.closed]),
      settings.batch.discovery,
      today,
    );
    if (batch) await services.state.saveDiscovery(batch);
    return { batch: batch ?? null, took: true };
  });
  const { batch, took } = taken;
  if (!batch) return { budget, took };

  const registries = await step('read the registries', async () => ({
    features: featuresFileSchema.parse(
      parse(await services.text('data/features.yaml', repository.commit)),
    ),
    topics: policyTopicsFileSchema.parse(
      parse(await services.text('data/policy-topics.yaml', repository.commit)) ?? [],
    ),
    resellers: resellersFileSchema.parse(
      parse(await services.text('data/resellers.yaml', repository.commit)) ?? [],
    ),
  }));
  const search = { budgets: input.searchBudgets, month: today.slice(0, 7) };
  for (const entry of batch.entries) {
    try {
      budget = await advance(entry, { today, budget, registries, search }, step, services);
    } catch {
      // Its retries are used up: tonight goes on without it, and after a second such night a person takes it.
      await step(`note ${entry.id}'s failure`, async () => {
        const work = (await services.state.work(entry.id)) ?? {};
        const failures = (work.failures ?? 0) + 1;
        await services.state.saveWork(entry.id, {
          ...work,
          failures,
          ...(failures >= maxFailures && {
            result: leftOut(
              entry,
              'needs-fix',
              'The bot’s steps for it failed two nights: npm run data:batch reads it on a computer',
            ),
          }),
        });
      });
    }
  }

  const ready = await step('check the batch', async () => {
    for (const entry of batch.entries) {
      if (!(await services.state.work(entry.id))?.result) return false;
    }
    return true;
  });
  if (!ready) return { budget, took };
  const pullRequest = await step('propose the batch', async () => {
    const results: ServiceResult[] = [];
    for (const entry of batch.entries) {
      const result = (await services.state.work(entry.id))?.result;
      if (result) results.push(result);
    }
    const made = batchProposal(results, {
      today,
      queue: await services.text('data/queue.yaml', repository.commit),
      resellers: await services.text('data/resellers.yaml', repository.commit),
    });
    const url = await services.propose(
      repository,
      made,
      `catalog/batch-${batch.started}-${batch.entries[0].id}`,
    );
    for (const entry of batch.entries) await services.state.saveWork(entry.id, undefined);
    await services.state.saveDiscovery(undefined);
    return url;
  });
  return { budget, took, pullRequest };
}

type Entry = DiscoveryBatch['entries'][number];

interface Night {
  today: IsoDate;
  budget: Budget;
  registries: Registries;
  search: { budgets: SearchBudget[]; month: string };
}

/** Takes a service as far as tonight allows, a stage at a time; returns what's left of tonight's budget. */
async function advance(
  entry: Entry,
  night: Night,
  step: Step,
  services: DiscoveryServices,
): Promise<Budget> {
  let { budget } = night;
  const site = { name: entry.name, website: entry.website };
  for (let round = 1; round <= 5; round++) {
    const stage = await step(`look at ${entry.id} (${round})`, async () =>
      stageOf((await services.state.work(entry.id)) ?? {}, entry, night),
    );
    switch (stage.name) {
      case 'done':
        return budget;
      case 'find': {
        // A survey of its sites (links, sitemaps), then a step for each kind of page, each within a step's requests.
        const surveyed = await step(`survey ${entry.id}'s site`, async () => {
          const web = services.web({}, night.search);
          const survey = await surveySite(site, web, { sitemaps: true });
          return { survey, robots: web.robots() };
        });
        let robots = surveyed.robots;
        const found: { report: KindReport; text?: string }[] = [];
        for (const kind of pageKinds) {
          const result = await step(`find ${entry.id}'s ${kind} page`, async () =>
            findOne(kind, site, surveyed.survey, services.web(robots, night.search)),
          );
          robots = result.robots;
          found.push(result);
        }
        await step(`keep ${entry.id}'s pages`, async () => {
          await services.state.saveWork(entry.id, pagesFound(found));
        });
        break;
      }
      case 'render': {
        if (budget.browserPages <= 0) return budget;
        const page = stage.url;
        budget = { ...budget, browserPages: budget.browserPages - 1 };
        await step(`render ${entry.id}'s ${stage.kind} page`, async () => {
          const read = await services.web({}, night.search).browser(page);
          const work = (await services.state.work(entry.id)) ?? {};
          await services.state.saveWork(entry.id, rendered(work, page, read));
        });
        break;
      }
      case 'extract': {
        for (let part = stage.answered; part < stage.parts; part++) {
          if (stage.cost[part] > budget.neurons) return budget;
          budget = { ...budget, neurons: budget.neurons - stage.cost[part] };
          await step(`extract ${entry.id}, part ${part + 1} of ${stage.parts}`, async () => {
            const work = (await services.state.work(entry.id)) ?? {};
            const request = extractionParts(contextOf(entry, work, night))[part];
            const answer =
              readModelAnswer(await services.extract(request.system, request.user)) ?? null;
            const answers = [...(work.answers ?? [])];
            answers[part] = answer;
            await services.state.saveWork(entry.id, { ...work, answers });
          });
        }
        break;
      }
      case 'draft':
        await step(`draft ${entry.id}`, async () => {
          const work = (await services.state.work(entry.id)) ?? {};
          const result = await drafted(entry, work, night, services.web({}, night.search).download);
          await services.state.saveWork(entry.id, { ...work, result });
        });
        break;
    }
  }
  return budget;
}

type Stage =
  | { name: 'done' }
  | { name: 'find' }
  | { name: 'render'; kind: PageKind; url: string }
  | { name: 'extract'; parts: number; answered: number; cost: number[] }
  | { name: 'draft' };

/** Where a service's work is: plain data, the step's result. */
function stageOf(work: ServiceWork, entry: Entry, night: Night): Stage {
  if (work.result) return { name: 'done' };
  if (!work.pages) return { name: 'find' };
  const unread = work.pages.find((page) => page.text === undefined);
  if (unread) return { name: 'render', kind: unread.kind, url: unread.url };
  if (work.pages.length === 0) return { name: 'draft' };
  const parts = extractionParts(contextOf(entry, work, night));
  const answered = work.answers?.length ?? 0;
  if (answered < parts.length) {
    return { name: 'extract', parts: parts.length, answered, cost: parts.map(neuronsOf) };
  }
  return { name: 'draft' };
}

function neuronsOf(part: ExtractionPart): number {
  return Math.ceil(
    (((part.system.length + part.user.length) / 4) * neuronsPerMillion.input +
      extractionAnswerTokens * neuronsPerMillion.output) /
      1_000_000,
  );
}

/** One kind's page: the search's report, and the page's text when its words fit. */
async function findOne(
  kind: PageKind,
  site: { name: string; website: string },
  survey: SiteSurvey,
  web: DiscoveryWeb,
): Promise<{ report: KindReport; text?: string; robots: Record<string, Robots> }> {
  const report = await findKind(kind, site, survey, web);
  const text = report.found?.fit === 'yes' ? web.textOf(report.found.url) : undefined;
  return { report, ...(text !== undefined && { text }), robots: web.robots() };
}

/** What the kinds' searches found: a page for each URL (its first kind), and why others couldn't be read. */
function pagesFound(found: readonly { report: KindReport; text?: string }[]): ServiceWork {
  const pages: DiscoveredPage[] = [];
  for (const { report, text } of found) {
    const page = report.found;
    if (!page || pages.some((known) => known.url === page.url)) continue;
    pages.push({
      kind: page.kind,
      url: page.url,
      ...(text !== undefined && { text }),
      method: text !== undefined ? 'fetch' : 'browser',
    });
  }
  const unread = [
    ...new Set(
      found.flatMap(({ report }) =>
        report.tried
          .map((tried) => tried.result)
          .filter((result) => /robots|403|bot check|error page/i.test(result)),
      ),
    ),
  ];
  return { pages, ...(unread.length > 0 && { unread }) };
}

/** A page's text from Browser Rendering, or the page left out with why. */
function rendered(
  work: ServiceWork,
  url: string,
  read: { text: string } | { error: string },
): ServiceWork {
  const pages = work.pages ?? [];
  if ('error' in read) {
    return {
      ...work,
      pages: pages.filter((page) => page.url !== url),
      unread: [...(work.unread ?? []), `${url}: ${read.error}`],
    };
  }
  return {
    ...work,
    pages: pages.map((page) =>
      page.url === url ? { ...page, text: read.text, method: 'browser' } : page,
    ),
  };
}

function contextOf(entry: Entry, work: ServiceWork, night: Night): ExtractionContext {
  return {
    provider: { id: entry.id, name: entry.name, website: entry.website, category: entry.category },
    pages: (work.pages ?? []).flatMap((page) =>
      page.text === undefined
        ? []
        : [{ name: page.kind, kind: page.kind, url: page.url, text: page.text }],
    ),
    features: night.registries.features,
    topics: night.registries.topics,
    resellers: night.registries.resellers,
    today: night.today,
  };
}

/** The service's draft from Workers AI's answers, checked as data:validate's schema checks it, or why it's left out. */
async function drafted(
  entry: Entry,
  work: ServiceWork,
  night: Night,
  download: Download,
): Promise<ServiceResult> {
  const pages = (work.pages ?? []).filter((page) => page.text !== undefined);
  if (pages.length === 0) {
    return leftOut(entry, 'unreadable', work.unread?.[0] ?? 'No page of it could be read');
  }
  const answers = (work.answers ?? []).filter(
    (answer): answer is ExtractionAnswer => answer !== null,
  );
  const draft = draftFromAnswer(mergeAnswers(answers), contextOf(entry, work, night));
  const review = (status: BatchProvider['status'], note?: string): BatchProvider => ({
    ...leftOut(entry, status, note ?? '').review,
    ...(note === undefined && { note: undefined }),
    pages: pages.map((page) => ({ kind: page.kind, url: page.url })),
    issues: draft.issues,
    proposedFeatures: draft.proposedFeatures,
    evidence: draft.evidence,
  });
  if (draft.outOfScope) return { ...empty, review: review('out-of-scope', draft.outOfScope) };
  if (!draft.provider) {
    const unpriced = draft.issues.some((issue) =>
      issue.reason.startsWith('No plan with a checked price'),
    );
    const why = answers.flatMap((answer) => answer.notOnPages ?? [])[0];
    return {
      ...empty,
      review:
        unpriced && why
          ? review('unreadable', why)
          : review('needs-fix', 'Nothing held up: no plan with a price its page shows'),
    };
  }
  const text = draftYaml(draft.provider, { header: draft.comments });
  const checked = providerSchema.safeParse(parse(text));
  if (!checked.success) {
    const problems = checked.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    return {
      ...empty,
      review: review('needs-fix', `Its draft doesn’t pass the schema: ${problems.join('; ')}`),
    };
  }
  const files: FileChange[] = [{ path: `data/providers/${entry.id}.yaml`, text }];
  const logo = await findIcon(entry.website, download);
  if (logo) files.push({ path: `data/logos/${entry.id}.png`, base64: toBase64(logo.png) });
  // Its pages' baselines, from the text it was drafted from, so the nightly checks compare against what was read.
  for (const cited of citedPages([checked.data], [])) {
    const page = pages.find((candidate) => candidate.url === cited.url);
    if (!page?.text) continue;
    files.push({
      path: baselinePath(page.url),
      text: writeBaseline({
        url: page.url,
        method: page.method,
        saved: night.today,
        lines: baselineLines(page.text),
      }),
    });
  }
  const resellerLogos: FileChange[] = [];
  for (const shop of draft.newResellers) {
    const icon = await findIcon(shop.website, download);
    if (icon) resellerLogos.push({ path: `data/logos/${shop.id}.png`, base64: toBase64(icon.png) });
  }
  return {
    review: {
      ...review('drafted'),
      provider: draft.provider,
      ...(logo && { logo: `${logo.width}×${logo.width} PNG (data/logos/${entry.id}.png)` }),
    },
    files,
    resellers: draft.newResellers,
    resellerLogos,
  };
}

const empty = { files: [], resellers: [], resellerLogos: [] };

function leftOut(entry: Entry, status: BatchProvider['status'], note: string): ServiceResult {
  return {
    ...empty,
    review: {
      id: entry.id,
      name: entry.name,
      website: entry.website,
      status,
      note,
      pages: [],
      issues: [],
      proposedFeatures: [],
      evidence: [],
    },
  };
}

/** The batch's pull request: each draft's files, the new resellers, the queue's new statuses and the review table. */
export function batchProposal(
  results: readonly ServiceResult[],
  main: { today: IsoDate; queue: string; resellers: string },
): Proposal {
  const changes: FileChange[] = results.flatMap((result) => [
    ...result.files,
    ...result.resellerLogos,
  ]);
  let queue = main.queue;
  for (const { review } of results) {
    // A draft to fix stays queued: a person, or a later batch, takes it again.
    if (review.status === 'needs-fix') continue;
    queue =
      withQueueStatus(queue, review.id, {
        status: review.status === 'drafted' ? 'done' : review.status,
        date: main.today,
        ...(review.status !== 'drafted' && review.note && { note: review.note.slice(0, 200) }),
      }) ?? queue;
  }
  if (queue !== main.queue) changes.push({ path: 'data/queue.yaml', text: queue });
  const shops = [
    ...new Map(
      results.flatMap((result) => result.resellers).map((shop) => [shop.id, shop]),
    ).values(),
  ];
  if (shops.length > 0) {
    changes.push({
      path: 'data/resellers.yaml',
      text: `${main.resellers.trimEnd()}\n${draftYamlList(shops)}`,
    });
  }
  changes.sort((a, b) => (a.path < b.path ? -1 : 1));
  const kept = results.filter((result) => result.review.status === 'drafted');
  return {
    title: `Catalog: ${kept.map((result) => result.review.name).join(', ') || `queue updates of ${main.today}`}`,
    body: batchReview(
      results.map((result) => result.review),
      { date: main.today, extractor: 'Workers AI (the nightly bot)' },
    ),
    changes,
  };
}

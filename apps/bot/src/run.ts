import {
  baselineDiff,
  digestDue,
  isDue,
  planTitle,
  searchBudgets,
  type Automation,
  type Baseline,
  type Bundle,
  type CitedPage,
  type IsoDate,
  type PolicyTopic,
  type ReportedPlan,
  type Robots,
  type SnapshotProvider,
} from '@simply-sub/core';
import { checkPages, message, type CheckInput, type PageDeps } from './check-pages';
import { digest, digestBranch, urlOf } from './digest';
import { discover, type DiscoveryServices } from './discovery';
import type { RepositoryState } from './github';
import { filesToRead, worthProposing, type Proposal } from './proposal';
import {
  confirmsReported,
  reportedCountries,
  reportedPages,
  reportOutcomes,
  type ReportedPlanInfo,
} from './reports';
import { reviewWithModel } from './review';
import type { BotState, Pending } from './state';
import {
  approvalTargets,
  bundleTargets,
  networksTargets,
  policyTargets,
  providerTargets,
} from './targets';
import type { Budget, Finding } from './types';

// A night of the bot (BLUEPRINT §6.4, M3.9), as the Workflow runs it: read the repository and data/automation.yaml
// from main, read each host's robots.txt once, then a step for each provider (with the bundles whose pages it cites
// too), each other group of bundles that share a page, and each reseller's logo, checking only what's due by its
// cadence. A page is compared with its baseline: unchanged, its facts hold and no model is asked; changed, the M8.3
// checks run, and what it found waits in KV for the weekly digest, built on the digest's day; then the discovery takes
// what's left of the night's budgets (discovery.ts). A plan visitors reported (M10.10) has its pages checked that
// night whatever their cadence, and the digest says what they showed (reports.ts). Steps pass only small, plain data: a step's result is at most
// 1 MiB, and on the free plan a step has 10 ms of CPU and 50 requests out.

/** A Workflow step: runs once, its result kept, and retried when it throws. */
export type Step = <T>(name: string, task: () => Promise<T>) => Promise<T>;

/** What to check: each provider's and bundle's pages, every host, and every page the catalog cites. */
export interface CatalogIndex {
  /** Provider id → the pages its prices, resellers' approvals, accepted networks and policy ratings cite. */
  providers: Record<string, string[]>;
  /** Bundle id → the pages its prices cite. */
  bundles: Record<string, string[]>;
  hosts: string[];
  /** Every page the catalog cites: pricing or policies, and who cites it (core's citedPages). */
  cited: CitedPage[];
}

/** What the night needs from the world. */
export interface Services {
  readIndex(): Promise<CatalogIndex>;
  readProvider(id: string): Promise<SnapshotProvider | undefined>;
  readBundle(id: string): Promise<Bundle | undefined>;
  /** Each host's robots.txt, read once. */
  readRobots(hosts: readonly string[]): Promise<Record<string, Robots>>;
  readRepository(): Promise<RepositoryState>;
  /** data/automation.yaml as the commit has it. */
  readSettings(commit: string): Promise<Automation>;
  /** A page's baseline as the commit has it, or null without one. */
  readBaseline(url: string, commit: string): Promise<Baseline | null>;
  /** data/policy-topics.yaml as the commit has it, for the review's rubrics. */
  readTopics(commit: string): Promise<PolicyTopic[]>;
  /** Workers AI's answer to a system and a user message (M3.10's review). */
  ask(system: string, user: string): Promise<unknown>;
  /** The page readers, minding `robots`. */
  pages(robots: Readonly<Record<string, Robots>>): PageDeps;
  readFiles(paths: readonly string[], commit: string): Promise<Record<string, string>>;
  propose(state: RepositoryState, proposal: Proposal, branch: string): Promise<string>;
  state: BotState;
  /** What the discovery needs (M3.11). */
  discovery: DiscoveryServices;
}

/** The most hosts one step reads robots.txt for: a step has 50 requests out on the free plan. */
const robotsPerStep = 40;

export interface NightSummary {
  findings: number;
  /** The digest's pull request, opened or refreshed, on the digest's day. */
  pullRequest?: string;
  /** The discovery batch's pull request, the night its last service is done. */
  batch?: string;
}

/** Which bundles each provider's step checks, and the groups of the rest that share a page. */
export function stepPlan(index: CatalogIndex): {
  withProvider: Record<string, string[]>;
  groups: string[][];
} {
  const providers = Object.keys(index.providers).sort();
  const owner = new Map<string, string>();
  for (const provider of providers) {
    for (const page of index.providers[provider]) if (!owner.has(page)) owner.set(page, provider);
  }
  const withProvider: Record<string, string[]> = Object.fromEntries(
    providers.map((id) => [id, []]),
  );
  const groups: { pages: Set<string>; bundles: string[] }[] = [];
  for (const bundle of Object.keys(index.bundles).sort()) {
    const pages = index.bundles[bundle];
    const owners = new Set(pages.map((page) => owner.get(page)));
    const [only] = owners;
    if (owners.size === 1 && only !== undefined) {
      withProvider[only].push(bundle);
      continue;
    }
    const group = groups.find((candidate) => pages.some((page) => candidate.pages.has(page)));
    if (group) {
      for (const page of pages) group.pages.add(page);
      group.bundles.push(bundle);
    } else {
      groups.push({ pages: new Set(pages), bundles: [bundle] });
    }
  }
  return { withProvider, groups: groups.map((group) => group.bundles) };
}

export async function runNight(
  today: IsoDate,
  step: Step,
  services: Services,
): Promise<NightSummary> {
  const repository = await step('read the repository', () => services.readRepository());
  const settings = await step('read the settings', () => services.readSettings(repository.commit));
  const checks = await step('read the check dates', () => services.state.checks());
  const index = await step('read the catalog', () => services.readIndex());
  const cited = Object.fromEntries(index.cited.map((page) => [page.url, page]));
  const due = new Set(
    index.cited
      .filter((page) => isDue(settings.cadence[page.type], checks[page.url], today))
      .map((page) => page.url),
  );
  const logoDue = (id: string) => isDue(settings.cadence.logos, checks[`logo:${id}`], today);
  const reported = await step('read the reports', () => services.state.reports());
  const countries = reportedCountries(reported);
  /** What the digest needs besides what it proposes: a reported plan's price that the page still shows. */
  const alsoKept = (finding: Finding) => confirmsReported(finding, countries);

  const robots: Record<string, Robots> = {};
  for (let start = 0; start < index.hosts.length; start += robotsPerStep) {
    const hosts = index.hosts.slice(start, start + robotsPerStep);
    Object.assign(
      robots,
      await step(`read robots.txt ${start / robotsPerStep + 1}`, () => services.readRobots(hosts)),
    );
  }

  const checked: Record<string, IsoDate> = { ...checks };
  let findings = 0;
  let budget: Budget = {
    browserPages: settings.batch.browserPages,
    neurons: settings.batch.neurons,
  };
  /** Runs one step's checks; what it found waits in KV, a pending entry per page (or logo). */
  const check = async (name: string, subject: string, input: () => Promise<CheckInput>) => {
    try {
      const result = await step(name, async () => {
        const made = await input();
        const keys = keysOf(made);
        if (keys.length === 0) return { count: 0, keys, budget };
        const found = await checkPages(made, services.pages(robots), budget);
        await keep(found.findings, keys, today, services.state, alsoKept);
        return { count: found.findings.length, keys, budget: found.budget };
      });
      findings += result.count;
      budget = result.budget;
      for (const key of result.keys) checked[key] = today;
    } catch (error) {
      // Its retries are used up: the rest of the night goes on, and a person hears of it in the digest.
      await step(`note ${subject}'s failure`, () =>
        services.state.putPending({
          key: `failed:${subject}`,
          seen: today,
          findings: [{ kind: 'manual', subject, reason: `The check failed: ${message(error)}` }],
        }),
      );
    }
  };
  /** Each due page's baseline, as main has it: due by its cadence, or for a reported plan. */
  const baselines = async (urls: readonly string[], reportedHere: ReadonlySet<string>) => {
    const found: Record<string, Baseline | null> = {};
    for (const url of urls) {
      if (due.has(url) || reportedHere.has(url)) {
        found[url] = await services.readBaseline(url, repository.commit);
      }
    }
    return found;
  };
  const bundlesOf = async (ids: readonly string[]) => {
    const found = await Promise.all(ids.map((id) => services.readBundle(id)));
    return found.flatMap((bundle) => (bundle ? bundleTargets(bundle) : []));
  };
  const dueOnly = (
    input: Omit<CheckInput, 'baselines' | 'cited'>,
    reportedHere: ReadonlySet<string> = new Set(),
  ): Omit<CheckInput, 'baselines' | 'cited'> => {
    const checked = (url: string) => due.has(url) || reportedHere.has(url);
    return {
      ...input,
      targets: input.targets.filter((target) => checked(target.price.sourceUrl)),
      approvals: input.approvals.filter((approval) => checked(approval.url)),
      networks: input.networks.filter((target) => checked(target.url)),
      policyPages: (input.policyPages ?? []).filter((target) => checked(target.url)),
    };
  };

  const plan = stepPlan(index);
  for (const [id, bundles] of Object.entries(plan.withProvider)) {
    await check(`check ${id}`, id, async () => {
      const provider = await services.readProvider(id);
      const reportedHere = provider ? reportedPages(provider, countries) : new Set<string>();
      const made = dueOnly(
        {
          subject: id,
          targets: [...(provider ? providerTargets(provider) : []), ...(await bundlesOf(bundles))],
          approvals: provider ? approvalTargets(provider) : [],
          networks: provider ? networksTargets(provider) : [],
          policyPages: provider ? policyTargets(provider) : [],
          ...(provider &&
            logoDue(id) && {
              logo: { id, website: provider.website, ...committed(repository, id) },
            }),
        },
        reportedHere,
      );
      return { ...made, baselines: await baselines(urlsOf(made), reportedHere), cited };
    });
  }
  for (const bundles of plan.groups) {
    await check(`check ${bundles.join(', ')}`, bundles.join(', '), async () => {
      const made = dueOnly({
        subject: bundles.join(', '),
        targets: await bundlesOf(bundles),
        approvals: [],
        networks: [],
      });
      return { ...made, baselines: await baselines(urlsOf(made), new Set()), cited };
    });
  }
  for (const reseller of repository.resellers) {
    if (!logoDue(reseller.id)) continue;
    await check(`logo ${reseller.id}`, reseller.id, async () => ({
      subject: reseller.id,
      targets: [],
      approvals: [],
      networks: [],
      logo: { id: reseller.id, website: reseller.website, ...committed(repository, reseller.id) },
    }));
  }

  let pullRequest: string | undefined;
  if (
    digestDue(
      settings,
      today,
      await step('read the last digest', () => services.state.lastDigest()),
    )
  ) {
    // Steps pass each other only small data: which pending findings still stand (by their KV entry), and the review's
    // notes by their place in that list. Each step reads the findings themselves, page texts and all, from KV.
    const kept = await step('gather the digest', async () => {
      const found: Record<string, number[]> = {};
      for (const entry of await services.state.pending()) {
        const standing = await stillPending(
          entry,
          index,
          services,
          repository.commit,
          today,
          alsoKept,
        );
        if (standing.length === 0) await services.state.dropPending(entry.key);
        else found[entry.key] = standing.map((finding) => entry.findings.indexOf(finding));
      }
      await services.state.saveDigest(today);
      return found;
    });
    const live = async () => {
      const entries = new Map(
        (await services.state.pending()).map((entry) => [entry.key, entry] as const),
      );
      return Object.entries(kept).flatMap(([key, places]) => {
        const entry = entries.get(key);
        return entry ? places.map((place) => entry.findings[place]) : [];
      });
    };
    if (Object.keys(kept).length > 0 || reported.length > 0) {
      // The free model's review (M3.10), within the Neurons the night's checks left and the week's review items.
      const review =
        settings.reviewer === 'workers-ai'
          ? await step('review the digest', async () => {
              const findings = await live();
              const done = await reviewWithModel(
                findings,
                await services.readTopics(repository.commit),
                (system, user) => services.ask(system, user),
                settings.batch.reviewItems,
                budget.neurons,
              );
              return {
                added: done.added,
                notes: [...done.notes].map(
                  ([finding, note]) => [findings.indexOf(finding), note] as const,
                ),
                neurons: done.neurons,
              };
            })
          : { added: [], notes: [], neurons: 0 };
      budget = { ...budget, neurons: budget.neurons - review.neurons };
      const reports =
        reported.length > 0
          ? await step('weigh the reports', async () =>
              reportOutcomes(
                reported,
                await reportedPlans(reported, index, services),
                await live(),
              ),
            )
          : undefined;
      pullRequest = await step('build the digest', async () => {
        const findings = await live();
        const reviewed = new Map(review.notes.map(([place, note]) => [findings[place], note]));
        const all = [...findings, ...review.added];
        const files = await services.readFiles(filesToRead(all, today), repository.commit);
        const made = digest(all, new Map(Object.entries(files)), today, {
          reviewer: settings.reviewer,
          reviewed,
          ...(reports && { reports }),
        });
        return services.propose(repository, made, digestBranch);
      });
      // The digest has them now.
      if (reported.length > 0) {
        await step('drop the reports', async () => {
          for (const { plan } of reported) await services.state.dropReport(plan);
        });
      }
    }
  }

  // The discovery (M3.11), with what the checks and the digest left of the night.
  const discovery = await discover(
    {
      today,
      settings,
      repository,
      budget,
      due: isDue(settings.cadence.discovery, checks[discoveryKey], today),
      searchBudgets: searchBudgets(settings, 'bot'),
    },
    step,
    services.discovery,
  );
  if (discovery.took) checked[discoveryKey] = today;
  await step('save the check dates', () => services.state.saveChecks(checked));
  return {
    findings,
    ...(pullRequest !== undefined && { pullRequest }),
    ...(discovery.pullRequest !== undefined && { batch: discovery.pullRequest }),
  };
}

/** Each reported plan's name and prices, from its provider's file; a plan the catalog doesn't have now is left out. */
async function reportedPlans(
  reported: readonly ReportedPlan[],
  index: CatalogIndex,
  services: Services,
): Promise<Map<string, ReportedPlanInfo>> {
  const providers = new Map<string, SnapshotProvider | undefined>();
  const plans = new Map<string, ReportedPlanInfo>();
  for (const { plan } of reported) {
    const id = Object.keys(index.providers).find((provider) => plan.startsWith(`${provider}.`));
    if (id === undefined) continue;
    if (!providers.has(id)) providers.set(id, await services.readProvider(id));
    const provider = providers.get(id);
    const found = provider?.plans.find((candidate) => candidate.id === plan);
    if (provider && found) {
      plans.set(plan, { label: planTitle(provider.name, found.name), prices: found.prices });
    }
  }
  return plans;
}

/** The check dates' key for the discovery's last batch. */
const discoveryKey = 'discovery';

/** The pages (and logo) a step checks, as check-date keys. */
function keysOf(input: Omit<CheckInput, 'baselines' | 'cited'>): string[] {
  const keys = new Set(urlsOf(input));
  if (input.logo) keys.add(`logo:${input.logo.id}`);
  return [...keys];
}

function urlsOf(input: Omit<CheckInput, 'baselines' | 'cited'>): string[] {
  return [
    ...new Set([
      ...input.targets.map((target) => target.price.sourceUrl),
      ...input.approvals.map((approval) => approval.url),
      ...input.networks.map((target) => target.url),
      ...(input.policyPages ?? []).map((target) => target.url),
    ]),
  ];
}

/**
 * Keeps what each checked page (or logo) found for the digest: its pending entry is replaced, or dropped when nothing
 * on it is worth proposing any more (the page is its baseline again and its facts hold).
 */
async function keep(
  found: readonly Finding[],
  keys: readonly string[],
  today: IsoDate,
  state: BotState,
  alsoKept: (finding: Finding) => boolean,
): Promise<void> {
  for (const key of keys) {
    const own = found.filter((finding) =>
      key.startsWith('logo:')
        ? finding.kind === 'logo' && `logo:${finding.id}` === key
        : urlOf(finding) === key,
    );
    // A manual finding without a page is the step's: kept with its first page.
    if (key === keys.find((candidate) => !candidate.startsWith('logo:'))) {
      own.push(
        ...found.filter((finding) => finding.kind === 'manual' && finding.url === undefined),
      );
    }
    const worth = own.filter((finding) => worthProposing(finding, today) || alsoKept(finding));
    if (worth.length > 0) await state.putPending({ key, seen: today, findings: worth });
    else await state.dropPending(key);
  }
}

/**
 * What a pending entry still has to propose: nothing for a page the catalog no longer cites, and no page change once
 * main's baseline has the page's new text (the last digest merged).
 */
async function stillPending(
  entry: Pending,
  index: CatalogIndex,
  services: Services,
  commit: string,
  today: IsoDate,
  alsoKept: (finding: Finding) => boolean,
): Promise<Finding[]> {
  if (
    !entry.key.startsWith('logo:') &&
    !entry.key.startsWith('failed:') &&
    !index.cited.some((page) => page.url === entry.key)
  ) {
    return [];
  }
  const kept: Finding[] = [];
  for (const finding of entry.findings) {
    if (finding.kind === 'page') {
      const main = await services.readBaseline(finding.url, commit);
      const diff = main ? baselineDiff(main.lines, finding.lines) : undefined;
      if (diff && diff.added.length === 0 && diff.removed.length === 0) continue;
    }
    if (worthProposing(finding, today) || alsoKept(finding)) kept.push(finding);
  }
  return kept;
}

function committed(repository: RepositoryState, id: string): { committed?: string } {
  const sha = repository.logos[id];
  return sha === undefined ? {} : { committed: sha };
}

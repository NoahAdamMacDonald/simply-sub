import {
  baselineDiff,
  daysBetween,
  digestDue,
  isDue,
  planTitle,
  searchBudgets,
  type Automation,
  type Baseline,
  type Bundle,
  type CitedPage,
  type IsoDate,
  type Policies,
  type PolicySet,
  type PolicyTopic,
  type ReportedPlan,
  type Robots,
  type SeedStep,
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
// from main, choose tonight's providers (a rotating slice of the catalog, M11.8, so a night's steps stay well under a
// Workflow's 1,024 however large it grows, and each provider is checked at least weekly), read each host's robots.txt
// once, then a step for each of them (with the bundles whose pages it cites too), each other group of their bundles
// that share a page, and each reseller's logo, checking only what's due by its cadence. A page is compared with its
// baseline: unchanged, its facts hold and no model is asked; changed, the M8.3 checks run, and what it found waits in
// KV for the weekly digest, built on the digest's day; then the discovery takes what's left of the night's budgets
// (discovery.ts). A plan visitors reported (M10.10) has its pages checked that night whatever their cadence, and the
// digest says what they showed (reports.ts). Steps pass only small, plain data: a step's result is at most 1 MiB, and
// on the free plan a step has 10 ms of CPU and 50 requests out.

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
  /** Provider id → the shared policy documents its step checks (M11.1): each one by the first provider naming it. */
  policySets: Record<string, PolicySet[]>;
  /** Bundle id → the provider whose night checks it (M11.8): its first plan's. */
  bundleOwners: Record<string, string>;
}

/** What the night needs from the world. */
export interface Services {
  /** Every provider id in the catalog D1, sorted. */
  readProviderIds(): Promise<string[]>;
  /**
   * The catalog D1's providers `ids` and the bundles they own (bundleOwner), and from the site's static files (M11.8)
   * the pages their policies cite and the shared policy documents they name: each document with the first of `namers`
   * naming it, the night's providers when they're read a part at a time.
   */
  readIndex(ids: readonly string[], namers: readonly string[]): Promise<CatalogIndex>;
  /** A provider as D1 has it: since M11.8 without its policies, which policiesUrl names the file of. */
  readProvider(id: string): Promise<SnapshotProvider | undefined>;
  /** The Terms and policies in the file at `url`, a provider's policiesUrl (M11.8). */
  readPolicies(url: string): Promise<Policies>;
  /**
   * The next step of seeding what a deploy's seed left over the day's rows (M11.8): core's seedNext on the catalog
   * D1, from the seed files data:build publishes.
   */
  seedNext(today: IsoDate): Promise<SeedStep>;
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

/** The most seed steps a night takes: a Workflow has 1,024 steps, and the checks need theirs (M11.8). */
const seedStepsPerNight = 200;

/**
 * The fewest providers a night checks (M11.8): a catalog this small is checked whole every night, and a larger one in up
 * to seven slices, a night each, so a night's steps stay well under a Workflow's 1,024 until about 2,000 providers.
 */
export const sliceSize = 100;

/** The most providers a step reads for the night's index: a step has 10 ms of CPU (M11.8). */
const indexPart = 25;

export interface NightSummary {
  findings: number;
  /** The digest's pull request, opened or refreshed, on the digest's day. */
  pullRequest?: string;
  /** The discovery batch's pull request, the night its last service is done. */
  batch?: string;
}

/**
 * Tonight's providers (M11.8): the catalog in id order, cut into at most seven slices of at least sliceSize, one a night
 * in turn, so each is checked at least weekly; and any whose plan a visitor reported, whatever their slice.
 */
export function nightSlice(
  ids: readonly string[],
  today: IsoDate,
  reported: ReadonlySet<string> = new Set(),
): string[] {
  const size = Math.max(sliceSize, Math.ceil(ids.length / 7));
  const slices = Math.max(1, Math.ceil(ids.length / size));
  const start = (daysBetween('1970-01-01', today) % slices) * size;
  return [
    ...new Set([...ids.slice(start, start + size), ...ids.filter((id) => reported.has(id))]),
  ].sort();
}

/** The night's index from the parts its steps read (M11.8), a page cited by several merged into one. */
export function mergeIndexes(parts: readonly CatalogIndex[]): CatalogIndex {
  const cited = new Map<string, CitedPage>();
  for (const page of parts.flatMap((part) => part.cited)) {
    const found = cited.get(page.url);
    cited.set(
      page.url,
      found
        ? {
            url: page.url,
            // A page cited both ways is a pricing page (core's citedPages).
            type: found.type === 'pricing' ? found.type : page.type,
            owners: [...new Set([...found.owners, ...page.owners])],
          }
        : page,
    );
  }
  const merged = <T>(of: (part: CatalogIndex) => Record<string, T>): Record<string, T> =>
    Object.assign({}, ...parts.map(of)) as Record<string, T>;
  return {
    providers: merged((part) => part.providers),
    bundles: merged((part) => part.bundles),
    hosts: [...new Set(parts.flatMap((part) => part.hosts))].sort(),
    cited: [...cited.values()],
    policySets: merged((part) => part.policySets),
    bundleOwners: merged((part) => part.bundleOwners),
  };
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
  await seedWhatWaits(today, step, services);
  const repository = await step('read the repository', () => services.readRepository());
  const settings = await step('read the settings', () => services.readSettings(repository.commit));
  const checks = await step('read the check dates', () => services.state.checks());
  const ids = new Set(await step('read the providers', () => services.readProviderIds()));
  const reported = await step('read the reports', () => services.state.reports());
  const slice = nightSlice([...ids], today, reportedProviders(reported, ids));
  const parts: CatalogIndex[] = [];
  for (let start = 0; start < slice.length; start += indexPart) {
    const part = slice.slice(start, start + indexPart);
    parts.push(
      await step(`read the catalog ${start / indexPart + 1}`, () =>
        services.readIndex(part, slice),
      ),
    );
  }
  const index = mergeIndexes(parts);
  const tonight = new Set(slice);
  const cited = Object.fromEntries(index.cited.map((page) => [page.url, page]));
  const due = new Set(
    index.cited
      .filter((page) => isDue(settings.cadence[page.type], checks[page.url], today))
      .map((page) => page.url),
  );
  const logoDue = (id: string) => isDue(settings.cadence.logos, checks[`logo:${id}`], today);
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
  /**
   * Runs one step's checks; what it found waits in KV, a pending entry per page (or logo), with the provider whose night
   * it was checked on (M11.8).
   */
  const check = async (
    name: string,
    subject: string,
    owner: string | undefined,
    input: () => Promise<CheckInput>,
  ) => {
    try {
      const result = await step(name, async () => {
        const made = await input();
        const keys = keysOf(made);
        if (keys.length === 0) return { count: 0, keys, budget };
        const found = await checkPages(made, services.pages(robots), budget);
        await keep(found.findings, keys, today, services.state, alsoKept, owner);
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
  /** A provider with its Terms and policies (M11.8): D1's leaves them out, and its policiesUrl names their file. */
  const withPolicies = async (provider: SnapshotProvider | undefined) =>
    provider?.policiesUrl && !provider.policies
      ? { ...provider, policies: await services.readPolicies(provider.policiesUrl) }
      : provider;
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
  const reportedIds = reportedProviders(reported, ids);
  /** Whether any of these bundles' pages is due: a step with nothing due isn't taken. */
  const bundlesDue = (bundles: readonly string[]) =>
    bundles.some((bundle) => (index.bundles[bundle] ?? []).some((url) => due.has(url)));
  for (const [id, bundles] of Object.entries(plan.withProvider)) {
    const anything =
      reportedIds.has(id) ||
      logoDue(id) ||
      (index.providers[id] ?? []).some((url) => due.has(url)) ||
      bundlesDue(bundles);
    if (!anything) continue;
    await check(`check ${id}`, id, id, async () => {
      const provider = await withPolicies(await services.readProvider(id));
      const reportedHere = provider ? reportedPages(provider, countries) : new Set<string>();
      const made = dueOnly(
        {
          subject: id,
          targets: [...(provider ? providerTargets(provider) : []), ...(await bundlesOf(bundles))],
          approvals: provider ? approvalTargets(provider) : [],
          networks: provider ? networksTargets(provider) : [],
          policyPages: provider ? policyTargets(provider, index.policySets[id]) : [],
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
    if (!bundlesDue(bundles)) continue;
    const [first = ''] = bundles;
    await check(
      `check ${bundles.join(', ')}`,
      bundles.join(', '),
      index.bundleOwners[first],
      async () => {
        const made = dueOnly({
          subject: bundles.join(', '),
          targets: await bundlesOf(bundles),
          approvals: [],
          networks: [],
        });
        return { ...made, baselines: await baselines(urlsOf(made), new Set()), cited };
      },
    );
  }
  for (const reseller of repository.resellers) {
    if (!logoDue(reseller.id)) continue;
    await check(`logo ${reseller.id}`, reseller.id, undefined, async () => ({
      subject: reseller.id,
      targets: [],
      approvals: [],
      networks: [],
      logo: { id: reseller.id, website: reseller.website, ...committed(repository, reseller.id) },
    }));
  }

  // A page tonight's providers no longer cite, or a provider the catalog no longer has, has nothing to propose (M11.8):
  // each provider's pending pages are tidied on its own night, as its slice comes round.
  await step('drop what tonight’s providers no longer cite', async () => {
    for (const entry of await services.state.pending()) {
      if (entry.owner === undefined || /^(?:logo|failed):/.test(entry.key)) continue;
      if (!ids.has(entry.owner) || (tonight.has(entry.owner) && cited[entry.key] === undefined)) {
        await services.state.dropPending(entry.key);
      }
    }
  });

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
        const standing = await stillPending(entry, index, services, repository.commit, today, {
          alsoKept,
          tonight,
          ids,
        });
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

/**
 * What a deploy's seed left for later, over the day's rows (M11.8): a provider a step, first, so the checks read it,
 * until nothing more fits tonight. A failure leaves the rest for tomorrow, and a person hears of it in the digest.
 */
async function seedWhatWaits(today: IsoDate, step: Step, services: Services): Promise<void> {
  try {
    for (let n = 1; n <= seedStepsPerNight; n++) {
      const seeded = await step(`seed ${n}`, () => services.seedNext(today));
      if (seeded.result !== 'more') return;
    }
  } catch (error) {
    await step('note the seed’s failure', () =>
      services.state.putPending({
        key: 'failed:seed',
        seen: today,
        findings: [
          {
            kind: 'manual',
            subject: 'the catalog seed',
            reason: `Seeding what waits failed: ${message(error)}`,
          },
        ],
      }),
    );
  }
}

/** The providers of the plans visitors reported, which tonight's slice takes whatever its turn (M10.10, M11.8). */
function reportedProviders(
  reported: readonly ReportedPlan[],
  ids: ReadonlySet<string>,
): Set<string> {
  return new Set(
    reported
      .map(({ plan }) => plan.slice(0, plan.indexOf('.')))
      .filter((provider) => ids.has(provider)),
  );
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
  owner: string | undefined,
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
    if (worth.length > 0) {
      await state.putPending({
        key,
        seen: today,
        findings: worth,
        ...(owner !== undefined && { owner }),
      });
    } else {
      await state.dropPending(key);
    }
  }
}

/**
 * What a pending entry still has to propose: nothing for a page the catalog no longer cites, and no page change once
 * main's baseline has the page's new text (the last digest merged). Tonight's index has only tonight's providers
 * (M11.8): a page another provider's night checked waits for that night's tidying, unless the provider has gone.
 */
async function stillPending(
  entry: Pending,
  index: CatalogIndex,
  services: Services,
  commit: string,
  today: IsoDate,
  night: {
    alsoKept: (finding: Finding) => boolean;
    tonight: ReadonlySet<string>;
    ids: ReadonlySet<string>;
  },
): Promise<Finding[]> {
  const { alsoKept, tonight, ids } = night;
  if (!/^(?:logo|failed):/.test(entry.key)) {
    const elsewhere = entry.owner !== undefined && !tonight.has(entry.owner);
    if (
      elsewhere ? !ids.has(entry.owner ?? '') : !index.cited.some((page) => page.url === entry.key)
    ) {
      return [];
    }
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

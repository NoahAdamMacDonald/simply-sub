import type { Bundle, SnapshotProvider } from '@simply-sub/core';
import { checkPages, message, type CheckInput, type PageDeps } from './check-pages';
import type { RepositoryState } from './github';
import { filesToRead, proposal, type Proposal } from './proposal';
import type { Robots } from './robots';
import { approvalTargets, bundleTargets, providerTargets } from './targets';
import type { Budget, Finding } from './types';

// A night's price check (BLUEPRINT §6.4), as the Workflow runs it: read what's to check, read each host's robots.txt
// once, then a step for each provider (with the bundles whose pages it cites too), each other group of bundles that
// share a page, and each reseller's logo, each step retried on its own, then one step for the pull request. A page is
// read in one step only, so it's requested once a night. Steps pass only small, plain data: a step's result is at
// most 1 MiB, and on the free plan a step has 10 ms of CPU and 50 requests out.

/** A Workflow step: runs once, its result kept, and retried when it throws. */
export type Step = <T>(name: string, task: () => Promise<T>) => Promise<T>;

/** What to check: each provider's and bundle's pages, and every host they and the websites are on. */
export interface CatalogIndex {
  /** Provider id → the pages its prices and resellers' approvals cite. */
  providers: Record<string, string[]>;
  /** Bundle id → the pages its prices cite. */
  bundles: Record<string, string[]>;
  hosts: string[];
}

/** What the night needs from the world. */
export interface Services {
  readIndex(): Promise<CatalogIndex>;
  readProvider(id: string): Promise<SnapshotProvider | undefined>;
  readBundle(id: string): Promise<Bundle | undefined>;
  /** Each host's robots.txt, read once. */
  readRobots(hosts: readonly string[]): Promise<Record<string, Robots>>;
  readRepository(): Promise<RepositoryState>;
  /** The page readers, minding `robots`. */
  pages(robots: Readonly<Record<string, Robots>>): PageDeps;
  readFiles(paths: readonly string[], commit: string): Promise<Record<string, string>>;
  propose(state: RepositoryState, proposal: Proposal): Promise<string>;
}

/** What a night may spend: 5 browser pages (of 10 free browser-minutes) and 8,000 of the 10,000 free Neurons. */
export const nightlyBudget: Budget = { browserPages: 5, neurons: 8_000 };

/** The most hosts one step reads robots.txt for: a step has 50 requests out on the free plan. */
const robotsPerStep = 40;

export interface NightSummary {
  findings: number;
  /** The pull request opened or refreshed, if the night changed anything. */
  pullRequest?: string;
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

export async function runPriceCheck(
  today: string,
  step: Step,
  services: Services,
): Promise<NightSummary> {
  const index = await step('read the catalog', () => services.readIndex());
  const repository = await step('read the repository', () => services.readRepository());
  const robots: Record<string, Robots> = {};
  for (let start = 0; start < index.hosts.length; start += robotsPerStep) {
    const hosts = index.hosts.slice(start, start + robotsPerStep);
    Object.assign(
      robots,
      await step(`read robots.txt ${start / robotsPerStep + 1}`, () => services.readRobots(hosts)),
    );
  }

  const findings: Finding[] = [];
  let budget = nightlyBudget;
  const check = async (name: string, subject: string, input: () => Promise<CheckInput>) => {
    try {
      const result = await step(name, async () =>
        checkPages(await input(), services.pages(robots), budget),
      );
      findings.push(...result.findings);
      budget = result.budget;
    } catch (error) {
      // Its retries are used up: the rest of the night goes on.
      findings.push({ kind: 'manual', subject, reason: `The check failed: ${message(error)}` });
    }
  };
  const bundlesOf = async (ids: readonly string[]) => {
    const found = await Promise.all(ids.map((id) => services.readBundle(id)));
    return found.flatMap((bundle) => (bundle ? bundleTargets(bundle) : []));
  };

  const plan = stepPlan(index);
  for (const [id, bundles] of Object.entries(plan.withProvider)) {
    await check(`check ${id}`, id, async () => {
      const provider = await services.readProvider(id);
      return {
        subject: id,
        targets: [...(provider ? providerTargets(provider) : []), ...(await bundlesOf(bundles))],
        approvals: provider ? approvalTargets(provider) : [],
        ...(provider && { logo: { id, website: provider.website, ...committed(repository, id) } }),
      };
    });
  }
  for (const bundles of plan.groups) {
    await check(`check ${bundles.join(', ')}`, bundles.join(', '), async () => ({
      subject: bundles.join(', '),
      targets: await bundlesOf(bundles),
      approvals: [],
    }));
  }
  for (const reseller of repository.resellers) {
    await check(`logo ${reseller.id}`, reseller.id, async () => ({
      subject: reseller.id,
      targets: [],
      approvals: [],
      logo: { id: reseller.id, website: reseller.website, ...committed(repository, reseller.id) },
    }));
  }

  const pullRequest = await step('open or refresh the pull request', async () => {
    const files = await services.readFiles(filesToRead(findings, today), repository.commit);
    const made = proposal(findings, new Map(Object.entries(files)), today);
    // Nothing to change: GitHub has no pull request without a change. What needs checking waits for the next one.
    if (made.changes.length === 0) return undefined;
    return services.propose(repository, made);
  });
  return { findings: findings.length, ...(pullRequest !== undefined && { pullRequest }) };
}

function committed(repository: RepositoryState, id: string): { committed?: string } {
  const sha = repository.logos[id];
  return sha === undefined ? {} : { committed: sha };
}

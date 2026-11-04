import type * as z from 'zod';
import { addDays, type IsoDate } from '../dates/iso-date';
import { iconProblem, readPngImage } from '../icons/icon-image';
import { bundleSchema, type Bundle } from './bundle';
import { categoriesFileSchema, type Categories } from './category';
import { choices, didYouMean, idOf, listedMoreThanOnce, repeatedIndexes } from './checks';
import { featuresFileSchema } from './feature';
import { slugSchema } from './formats';
import type { CatalogFileKind } from './json-schema';
import { featureNamedCategories, planCategories, providerCategories } from './plan-categories';
import { planFeatures } from './provider-features';
import { paidPlanCount, topicApplies } from './plan-policies';
import { policySetSchema, type Policies, type PolicyRating, type PolicySet } from './policy';
import {
  policyTopicsFileSchema,
  titledRatingsMax,
  type PolicyTier,
  type PolicyTopic,
} from './policy-topic';
import { automationSchema } from '../pipeline/automation';
import { onSites, providerSiteKeys, queueFileSchema } from '../pipeline/queue';
import type { Price } from './price';
import { providerSchema, type AddOn, type Plan, type Provider } from './provider';
import { ratersFileSchema, ratingIsOld, ratingDay, ratingSubjects, type Rater } from './rater';
import { redirectsFileSchema } from './redirects';
import { isRetired } from './retired';
import {
  globalRegion,
  groupsOf,
  isCatalogRegion,
  isoRegions,
  membersOf,
  regionProblem,
} from './regions';
import {
  isOnDomain,
  resellerDomains,
  resellersFileSchema,
  siteDomain,
  type Reseller,
} from './reseller';
import {
  awaitingRequiredFeatures,
  checkInclusionLoops,
  checkPlanFeatures,
  checkPriceDifferences,
  checkProviderFeatures,
  checkRequiredFeatures,
  readFeatureRegistry,
  type FeatureRegistry,
} from './validate-features';
import { checkRedirects } from './validate-redirects';

// validateCatalog runs the checks that need more than one file or today's date (BLUEPRINT §6.2), after each
// file's Zod schema. scripts/validate-data.ts reads data/ and prints the result. Nothing here reads the clock or
// the disk.

export type CatalogIssuePath = (string | number)[];

/** One problem in a catalog file. Errors fail validation; warnings are printed but pass. */
export interface CatalogIssue {
  severity: 'error' | 'warning';
  /** From the repo root: data/providers/netflix.yaml. */
  file: string;
  /** Keys and list indexes inside the file (['plans', 2, 'features', 'video.quality']), or [] for the file. */
  path: CatalogIssuePath;
  message: string;
}

/**
 * A file under data/ as the caller read it: a YAML file's parsed data, or a note that it isn't valid YAML, or the
 * bytes of a file in data/logos/.
 */
export type CatalogSourceFile =
  | { file: string; data: unknown }
  // The caller reports why. Checks that need the file's contents skip it, so nothing is reported twice.
  | { file: string; invalidYaml: true }
  | { file: string; bytes: Uint8Array };

/**
 * What an id names. Provider, plan, add-on, bundle and reseller ids share one namespace: provider and reseller logos
 * share data/logos/ and /icons/.
 */
export type CatalogIdKind = 'provider' | 'plan' | 'add-on' | 'bundle' | 'reseller';

export interface CatalogIds {
  /** 'unchecked' for a provider whose file is broken, or an id under it: those can't be looked up. */
  kindOf(id: string): CatalogIdKind | 'unchecked' | undefined;
  /** Every id of these kinds, for suggestions. */
  all(...kinds: CatalogIdKind[]): string[];
}

/** Adds an issue at `path` in one file. */
export type Report = (
  path: CatalogIssuePath,
  message: string,
  severity?: CatalogIssue['severity'],
) => void;

const featuresFile = 'data/features.yaml';
const categoriesFile = 'data/categories.yaml';
const resellersFile = 'data/resellers.yaml';
const policyTopicsFile = 'data/policy-topics.yaml';
const queueFile = 'data/queue.yaml';
const automationFile = 'data/automation.yaml';
const redirectsFile = 'data/redirects.yaml';
const ratersFile = 'data/raters.yaml';
const policySetsDir = 'data/policies/';
const staleAfterDays = 90;
/** Terms change less often than prices, and no nightly check reads them. */
const policyStaleAfterDays = 365;

/**
 * Providers rated before policy topics v2 (M11.1), whose missing topics were warnings until they were regraded under
 * the new rules. Empty since 2026-11-02, when the owner asked for every topic to be required and the 13 were rated on
 * all of them: every provider rates, or gives a status for, each topic that applies. M11.9 still regrades them.
 */
export const awaitingPolicyRegrade: ReadonlySet<string> = new Set<string>();

/**
 * Providers from before M11.5 whose renewal day isn't read yet: a missing renewalAnchor is a warning for them, and an
 * error for every other provider whose paid plans renew by the month or year. None now: M11.9 read them all, Hulu's
 * and ESPN's through a US exit. Mullvad is prepaid, with none to give.
 */
export const awaitingRenewalAnchor: ReadonlySet<string> = new Set();

export interface ValidateOptions {
  /** Providers whose missing policy topics are warnings, not errors: awaitingPolicyRegrade unless a test says. */
  awaitingRegrade?: ReadonlySet<string>;
  /** Plans whose missing required features are warnings: awaitingRequiredFeatures unless a test says. */
  awaitingRequired?: ReadonlyMap<string, readonly string[]>;
  /** Providers whose missing renewalAnchor is a warning: awaitingRenewalAnchor unless a test says. */
  awaitingRenewal?: ReadonlySet<string>;
}

/**
 * Every problem in the catalog, file by file. `files` are all the .yaml and .yml files under data/ and every file
 * in data/logos/, with paths from the repo root. A broken file gets its own errors, and the checks that would only
 * repeat them are left out: a provider that fails its schema isn't checked against the registry, and references
 * to it aren't flagged.
 */
export function validateCatalog(
  files: readonly CatalogSourceFile[],
  today: IsoDate,
  {
    awaitingRegrade = awaitingPolicyRegrade,
    awaitingRequired = awaitingRequiredFeatures,
    awaitingRenewal = awaitingRenewalAnchor,
  }: ValidateOptions = {},
): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const reportIn =
    (file: string): Report =>
    (path, message, severity = 'error') => {
      issues.push({ severity, file, path, message });
    };
  const located = locateFiles(files, reportIn);

  const reportCategories = reportIn(categoriesFile);
  const categories =
    located.categories && parseFile(categoriesFileSchema, located.categories, reportCategories);
  if (categories) {
    for (const kind of ['service', 'feature', 'spend'] as const) {
      const ids = categories[kind].map((category) => category.id);
      for (const index of repeatedIndexes(ids)) {
        reportCategories([kind, index, 'id'], listedMoreThanOnce(ids[index]));
      }
    }
  }

  let registry: FeatureRegistry | undefined;
  if (located.features && 'data' in located.features) {
    const reportFeatures = reportIn(featuresFile);
    parseFile(featuresFileSchema, located.features, reportFeatures);
    registry = readFeatureRegistry(located.features.data, categories, reportFeatures);
  }

  // Providers whose file is broken, by file name and by the id it gives. Nothing references a bundle, so a
  // broken bundle file needs no such list.
  const unchecked = new Set<string>();
  const providers = located.providers.flatMap((named) => {
    const read = readNamedFile(named, providerSchema, named.name, reportIn(named.source.file));
    if (read) {
      return [read];
    }
    unchecked.add(named.name);
    const claimed = idClaimedBy(named.source);
    if (claimed !== undefined) {
      unchecked.add(claimed);
    }
    return [];
  });
  const bundles = located.bundles.flatMap((named) => {
    const read = readNamedFile(
      named,
      bundleSchema,
      `bundle.${named.name}`,
      reportIn(named.source.file),
    );
    return read ? [read] : [];
  });

  // The resellers file is optional: no provider has to list resellers. A broken one leaves references to it unchecked.
  const reportResellers = reportIn(resellersFile);
  const resellers =
    located.resellers && parseFile(resellersFileSchema, located.resellers, reportResellers);
  const resellersRead = resellers && {
    value: resellers,
    file: resellersFile,
    report: reportResellers,
  };

  // The policy topics file is optional too, until a provider rates its policies.
  const reportPolicyTopics = reportIn(policyTopicsFile);
  const policyTopics =
    located.policyTopics &&
    parseFile(policyTopicsFileSchema, located.policyTopics, reportPolicyTopics);
  if (
    !located.policyTopics &&
    (providers.some(({ value }) => value.policies) || located.policySets.length > 0)
  ) {
    reportPolicyTopics(
      [],
      'Missing: the topics that providers rate their policies on go here (BLUEPRINT §4.10)',
    );
  }
  const serviceIds = categories?.service.map((category) => category.id);
  policyTopics?.forEach((topic, index) => {
    const named = [
      ...(topic.categories ?? []).map((id, categoryIndex) => ({
        id,
        path: [index, 'categories', categoryIndex],
      })),
      ...Object.keys(topic.silentIn ?? {}).map((id) => ({ id, path: [index, 'silentIn', id] })),
    ];
    for (const { id, path } of named) {
      if (serviceIds && !serviceIds.includes(id)) {
        reportPolicyTopics(
          path,
          `"${id}" isn't a service category in ${categoriesFile}${choices(id, serviceIds)}`,
        );
      }
    }
  });

  // Shared policy documents (M11.1): a broken one leaves the providers naming it unchecked against it.
  const policySetsUnchecked = new Set<string>();
  const policySets = located.policySets.flatMap((named) => {
    const read = readNamedFile(named, policySetSchema, named.name, reportIn(named.source.file));
    if (!read) policySetsUnchecked.add(named.name);
    return read ? [read] : [];
  });

  // The raters file is optional too, until a provider shows an outside rating (M11.2).
  const reportRaters = reportIn(ratersFile);
  const raters = located.raters && parseFile(ratersFileSchema, located.raters, reportRaters);
  if (!located.raters && providers.some(({ value }) => value.ratings)) {
    reportRaters(
      [],
      'Missing: the outside raters whose labels providers show go here (BLUEPRINT §4.10)',
    );
  }

  const ids = indexIds(providers, bundles, unchecked, resellersRead);
  const context: CheckContext = {
    today,
    currencies: new Set(Intl.supportedValuesOf('currency')),
    categories,
    registry,
    ids,
    resellers: new Map(resellers?.map((reseller) => [reseller.id, reseller])),
    resellersUnchecked: located.resellers !== undefined && resellers === undefined,
    policyTopics: policyTopics && new Map(policyTopics.map((topic) => [topic.id, topic])),
    awaitingRegrade,
    awaitingRequired,
    awaitingRenewal,
    policySets: new Map(policySets.map(({ value }) => [value.id, value])),
    policySetsUnchecked,
    raters: new Map(raters?.map((rater) => [rater.id, rater])),
    // Missing or broken: the file's own error says so, and the ratings naming raters go unchecked.
    ratersUnchecked: raters === undefined,
  };
  for (const { value, report } of providers) {
    checkProvider(value, context, report);
  }
  if (resellersRead && unchecked.size === 0) {
    warnUnlisted(resellersRead, providers);
  }
  if (raters && unchecked.size === 0) {
    warnUnusedRaters(raters, providers, reportRaters);
  }
  for (const { value, report } of bundles) {
    checkBundle(value, context, report);
  }
  for (const { value, report } of policySets) {
    checkPolicySet(
      value,
      providers.map((provider) => provider.value),
      context,
      report,
    );
  }
  checkInclusionLoops(
    providers.flatMap(({ value, report }) =>
      value.plans.map((plan, index) => ({ plan, path: ['plans', index], report })),
    ),
  );
  checkLogos(located.logos, providers, resellersRead, context, reportIn);
  if (located.queue) {
    checkQueue(located.queue, providers, unchecked, categories, reportIn(queueFile));
  }
  if (located.automation) {
    parseFile(automationSchema, located.automation, reportIn(automationFile));
  }
  // Optional: ids are permanent, so there's often nothing to redirect (BLUEPRINT §4.3).
  if (located.redirects) {
    const reportRedirects = reportIn(redirectsFile);
    const redirects = parseFile(redirectsFileSchema, located.redirects, reportRedirects);
    if (redirects) {
      checkRedirects(
        redirects,
        {
          providers: providers.map(({ value }) => value),
          bundles: bundles.map(({ value }) => value),
          registry,
          unchecked,
          today,
        },
        reportRedirects,
      );
    }
  }
  return issues;
}

/** `data/providers/netflix.yaml:42 plans.2.features.video.quality: "8k" isn't …`, with the line if known. */
export function formatCatalogIssue(issue: CatalogIssue, line?: number): string {
  const where = line === undefined ? issue.file : `${issue.file}:${line}`;
  return issue.path.length === 0
    ? `${where}: ${issue.message}`
    : `${where} ${issue.path.join('.')}: ${issue.message}`;
}

/** A provider or bundle file, and its name without .yaml, which its id comes from. */
interface NamedFile {
  source: CatalogSourceFile;
  name: string;
}

interface LocatedFiles {
  features?: CatalogSourceFile;
  categories?: CatalogSourceFile;
  resellers?: CatalogSourceFile;
  policyTopics?: CatalogSourceFile;
  queue?: CatalogSourceFile;
  automation?: CatalogSourceFile;
  redirects?: CatalogSourceFile;
  raters?: CatalogSourceFile;
  providers: NamedFile[];
  bundles: NamedFile[];
  policySets: NamedFile[];
  logos: NamedFile[];
}

/**
 * What a file under data/ is, from its path: the registry, the categories, the resellers, a provider or bundle file
 * and its name without .yaml, or a provider's or reseller's logo (data/logos/<id>.png). Undefined for anything else.
 */
export function locateCatalogFile(
  file: string,
): { kind: CatalogFileKind | 'logo'; name: string } | undefined {
  if (file === featuresFile) {
    return { kind: 'features', name: 'features' };
  }
  if (file === categoriesFile) {
    return { kind: 'categories', name: 'categories' };
  }
  if (file === resellersFile) {
    return { kind: 'resellers', name: 'resellers' };
  }
  if (file === policyTopicsFile) {
    return { kind: 'policy-topics', name: 'policy-topics' };
  }
  if (file === queueFile) {
    return { kind: 'queue', name: 'queue' };
  }
  if (file === automationFile) {
    return { kind: 'automation', name: 'automation' };
  }
  if (file === redirectsFile) {
    return { kind: 'redirects', name: 'redirects' };
  }
  if (file === ratersFile) {
    return { kind: 'raters', name: 'raters' };
  }
  const named = /^data\/(providers|bundles|policies)\/([^/]+)\.yaml$/.exec(file);
  if (named) {
    const kinds = { providers: 'provider', bundles: 'bundle', policies: 'policy-set' } as const;
    return { kind: kinds[named[1] as keyof typeof kinds], name: named[2] };
  }
  const logo = /^data\/logos\/([^/]+)\.png$/.exec(file);
  return logo ? { kind: 'logo', name: logo[1] } : undefined;
}

function locateFiles(
  files: readonly CatalogSourceFile[],
  reportIn: (file: string) => Report,
): LocatedFiles {
  const located: LocatedFiles = { providers: [], bundles: [], policySets: [], logos: [] };
  for (const source of files) {
    const { file } = source;
    const where = locateCatalogFile(file);
    if (where?.kind === 'features') {
      located.features = source;
    } else if (where?.kind === 'categories') {
      located.categories = source;
    } else if (where?.kind === 'resellers') {
      located.resellers = source;
    } else if (where?.kind === 'policy-topics') {
      located.policyTopics = source;
    } else if (where?.kind === 'queue') {
      located.queue = source;
    } else if (where?.kind === 'automation') {
      located.automation = source;
    } else if (where?.kind === 'redirects') {
      located.redirects = source;
    } else if (where?.kind === 'raters') {
      located.raters = source;
    } else if (where) {
      const list = {
        provider: 'providers',
        bundle: 'bundles',
        'policy-set': 'policySets',
        logo: 'logos',
      } as const;
      located[list[where.kind]].push({ source, name: where.name });
    } else if (file.startsWith('data/logos/')) {
      reportIn(file)(
        [],
        'Logos are PNG files named after the provider or reseller id (disney-plus.png)',
      );
    } else if (file.endsWith('.yml')) {
      const name = file.slice(file.lastIndexOf('/') + 1, -'.yml'.length);
      reportIn(file)([], `Rename it to ${name}.yaml: catalog files end in .yaml`);
    } else {
      reportIn(file)(
        [],
        'Not a catalog file: use data/features.yaml, data/categories.yaml, data/resellers.yaml, data/policy-topics.yaml, data/queue.yaml, data/automation.yaml, data/redirects.yaml, data/raters.yaml, data/providers/<id>.yaml, data/bundles/<slug>.yaml or data/policies/<id>.yaml',
      );
    }
  }
  if (!located.features) {
    reportIn(featuresFile)([], 'Missing: the feature registry goes here (BLUEPRINT §4.2)');
  }
  if (!located.categories) {
    reportIn(categoriesFile)(
      [],
      'Missing: the service, feature and spend categories go here (BLUEPRINT §4.5)',
    );
  }
  return located;
}

/** The file's value when it matches `schema`; otherwise reports each schema issue and returns undefined. */
function parseFile<T>(
  schema: z.ZodType<T>,
  source: CatalogSourceFile,
  report: Report,
): T | undefined {
  if (!('data' in source)) {
    return undefined;
  }
  const result = schema.safeParse(source.data);
  if (result.success) {
    return result.data;
  }
  for (const issue of result.error.issues) {
    const path = issue.path.map((key) => (typeof key === 'symbol' ? String(key) : key));
    if (issue.code === 'unrecognized_keys') {
      // At the key itself rather than the object around it, so the line number points at it.
      for (const key of issue.keys) {
        report([...path, key], 'Unknown key: check the spelling, or remove it');
      }
    } else {
      report(path, issue.message);
    }
  }
  return undefined;
}

interface ReadFile<T> {
  value: T;
  file: string;
  report: Report;
}

/**
 * A provider or bundle file that matches its schema and whose id comes from its file name. The id is checked
 * first, even in a file that fails its schema: a mistyped provider id also breaks every plan id's prefix.
 */
function readNamedFile<T extends { id: string }>(
  { source, name }: NamedFile,
  schema: z.ZodType<T>,
  expectedId: string,
  report: Report,
): ReadFile<T> | undefined {
  const nameIsSlug = slugSchema.safeParse(name).success;
  const claimed = idClaimedBy(source);
  if (!nameIsSlug) {
    report([], 'Use a kebab-case file name (disney-plus.yaml)');
  } else if (claimed !== undefined && claimed !== expectedId) {
    report(['id'], `Must be ${expectedId} to match the file name, or rename the file`);
  }
  const value = parseFile(schema, source, report);
  return value && nameIsSlug && claimed === expectedId
    ? { value, file: source.file, report }
    : undefined;
}

/** The id a file gives itself, even when the rest of it is broken. */
function idClaimedBy(source: CatalogSourceFile): string | undefined {
  return 'data' in source ? idOf(source.data) : undefined;
}

function indexIds(
  providers: readonly ReadFile<Provider>[],
  bundles: readonly ReadFile<Bundle>[],
  unchecked: ReadonlySet<string>,
  resellers: ReadFile<readonly Reseller[]> | undefined,
): CatalogIds {
  const defined = new Map<string, { kind: CatalogIdKind; file: string }>();
  const define = (
    id: string,
    kind: CatalogIdKind,
    { file, report }: ReadFile<unknown>,
    path: CatalogIssuePath,
  ) => {
    const existing = defined.get(id);
    if (existing) {
      report(
        path,
        `"${id}" is already the id of ${withArticle(existing.kind)} in ${existing.file}`,
      );
    } else {
      defined.set(id, { kind, file });
    }
  };
  // Bundles first: their ids are bundle.<slug> by design, so a clash is the other file's to fix.
  for (const read of bundles) {
    define(read.value.id, 'bundle', read, ['id']);
  }
  for (const read of providers) {
    define(read.value.id, 'provider', read, ['id']);
    read.value.plans.forEach((plan, index) =>
      define(plan.id, 'plan', read, ['plans', index, 'id']),
    );
    read.value.addOns?.forEach((addOn, index) =>
      define(addOn.id, 'add-on', read, ['addOns', index, 'id']),
    );
  }
  // After the providers: a reseller named like one is the resellers file's to fix.
  resellers?.value.forEach((reseller, index) =>
    define(reseller.id, 'reseller', resellers, [index, 'id']),
  );
  return {
    kindOf: (id) =>
      defined.get(id)?.kind ?? (unchecked.has(id.split('.')[0]) ? 'unchecked' : undefined),
    all: (...kinds) =>
      [...defined].filter(([, { kind }]) => kinds.includes(kind)).map(([id]) => id),
  };
}

function withArticle(kind: CatalogIdKind): string {
  return kind === 'add-on' ? 'an add-on' : `a ${kind}`;
}

interface CheckContext {
  today: IsoDate;
  currencies: ReadonlySet<string>;
  categories: Categories | undefined;
  registry: FeatureRegistry | undefined;
  ids: CatalogIds;
  /** data/resellers.yaml's, by id. */
  resellers: ReadonlyMap<string, Reseller>;
  /** The resellers file is there but broken, so a reseller missing from it may only be unreadable. */
  resellersUnchecked: boolean;
  /** data/policy-topics.yaml's, by id, or undefined when it's missing or broken: ratings' topics go unchecked. */
  policyTopics: ReadonlyMap<string, PolicyTopic> | undefined;
  awaitingRegrade: ReadonlySet<string>;
  awaitingRequired: ReadonlyMap<string, readonly string[]>;
  awaitingRenewal: ReadonlySet<string>;
  /** data/policies/'s shared documents that parse, by id. */
  policySets: ReadonlyMap<string, PolicySet>;
  /** The ids of shared documents whose file is broken: what names them goes unchecked. */
  policySetsUnchecked: ReadonlySet<string>;
  /** data/raters.yaml's, by id. */
  raters: ReadonlyMap<string, Rater>;
  /** The raters file is missing or broken, so a rater missing from it may only be unreadable. */
  ratersUnchecked: boolean;
}

function checkProvider(provider: Provider, context: CheckContext, report: Report): void {
  const { categories, registry, ids } = context;
  if (categories) {
    for (const [key, kind] of [
      ['category', 'service'],
      ['spendCategory', 'spend'],
    ] as const) {
      const categoryIds = categories[kind].map((category) => category.id);
      if (!categoryIds.includes(provider[key])) {
        report(
          [key],
          `"${provider[key]}" isn't a ${kind} category in data/categories.yaml${choices(provider[key], categoryIds)}`,
        );
      }
    }
  }
  for (const [region, currency] of Object.entries(provider.billingCurrency ?? {})) {
    if (!isCatalogRegion(region)) {
      report(['billingCurrency', region], regionProblem(region));
    }
    if (!context.currencies.has(currency)) {
      report(['billingCurrency', region], `"${currency}" isn't a real ISO 4217 currency code`);
    }
  }
  const own = [siteDomain(provider.website), ...(provider.domains ?? [])];
  for (const [region, accepted] of Object.entries(provider.acceptedNetworks ?? {})) {
    if (!isCatalogRegion(region)) {
      report(['acceptedNetworks', region], regionProblem(region));
    }
    if (!isOnDomain(accepted.url, own)) {
      report(
        ['acceptedNetworks', region, 'url'],
        `Must be a page of ${provider.name}'s own sites, on ${own.join(' or ')}: only the cards it says it takes are listed`,
      );
    }
  }

  if (registry && provider.features) {
    checkProviderFeatures(provider.features, { registry, ids, providerId: provider.id, report });
  }
  const planIds = provider.plans.map((plan) => plan.id);
  const addOnIds = (provider.addOns ?? []).map((addOn) => addOn.id);
  const prices = new PriceChecks(context, report);
  const serviceIds = categories?.service.map((category) => category.id);
  provider.plans.forEach((plan, index) => {
    const path = ['plans', index];
    if (registry) {
      checkPlanFeatures(
        plan,
        path,
        { registry, ids, providerId: provider.id, report },
        provider.features,
      );
    }
    plan.categories?.forEach((id, categoryIndex) => {
      if (serviceIds && !serviceIds.includes(id)) {
        report(
          [...path, 'categories', categoryIndex],
          `"${id}" isn't a service category in data/categories.yaml${choices(id, serviceIds)}`,
        );
      }
    });
    if (plan.categories?.length === 1 && plan.categories[0] === provider.category) {
      report(
        [...path, 'categories'],
        `${provider.category} is the provider's category already: leave categories out`,
      );
    }
    if (registry) {
      checkFeatureCategories(plan, provider, path, { registry, serviceIds, report });
      checkRequiredFeatures(
        plan,
        planCategories(plan, provider),
        planFeatures(plan, provider),
        path,
        {
          registry,
          awaiting: context.awaitingRequired,
          report,
        },
      );
    }
    plan.addOnIds?.forEach((id, addOnIndex) => {
      if (!addOnIds.includes(id)) {
        report(
          [...path, 'addOnIds', addOnIndex],
          planIds.includes(id)
            ? `"${id}" is a plan, not an add-on`
            : `"${id}" isn't an add-on in this file${addOnIds.length > 0 ? choices(id, addOnIds) : ' (add it under addOns)'}`,
        );
      }
    });
    plan.formerNames?.forEach((former, formerIndex) => {
      if (former.until > context.today) {
        report(
          [...path, 'formerNames', formerIndex, 'until'],
          `${former.until} is after today (${context.today}): use the last day the plan had that name`,
        );
      }
    });
    prices.check(plan.prices, [...path, 'prices'], isRetired(plan, provider, context.today));
  });

  if (registry) {
    checkPriceDifferences(
      provider.plans.map((plan, index) => ({
        plan,
        features: planFeatures(plan, provider),
        sold: !isRetired(plan, provider, context.today),
        path: ['plans', index],
      })),
      report,
    );
  }

  const sold = new Set(provider.plans.flatMap((plan) => plan.addOnIds ?? []));
  provider.addOns?.forEach((addOn, index) => {
    const path = ['addOns', index];
    if (!sold.has(addOn.id)) {
      report(
        [...path, 'id'],
        "No plan lists this add-on: add it to the addOnIds of the plans it's sold with",
      );
    }
    const granted = addOn.grantsPlan;
    if (granted !== undefined && !planIds.includes(granted)) {
      report(
        [...path, 'grantsPlan'],
        addOnIds.includes(granted)
          ? `"${granted}" is an add-on: grantsPlan names a plan`
          : `"${granted}" isn't a plan in this file${choices(granted, planIds)}`,
      );
    }
    prices.check(
      addOn.prices,
      [...path, 'prices'],
      provider.retired !== undefined && provider.retired <= context.today,
    );
  });

  if (provider.billingCurrency) {
    checkBillingCurrency(provider, provider.billingCurrency, context.currencies, report);
  }
  if (provider.availableIn) {
    checkAvailableIn(provider, provider.availableIn, report);
  }
  provider.resellers?.forEach((listing, index) =>
    checkResellerListing(provider, listing, ['resellers', index], context, prices, report),
  );
  prices.warnIfStale();
  if (provider.policies) {
    checkPolicies(provider, provider.policies, context, report);
  }
  checkPolicyCoverage(provider, context, report);
  checkTopicFeatures(provider, context, report);
  if (provider.ratings) {
    checkOutsideRatings(provider.ratings, context, report);
  }
  checkOwner(provider, own, context, report);
  checkPaymentMethods(provider, own, report);
  checkRenewalAnchor(provider, own, context, report);
  checkCurrencies(provider, own, context, report);
  checkSourceRepo(provider, own, context, report);
  checkInferred(provider, own, context, report);
  checkAccounts(provider, own, context, report);
}

/**
 * Inferred feature values (M11.9): each names a value the plan states, its own or its provider's, from a page of the
 * provider's own sites, its policies' or its owner's, read no later than today.
 */
function checkInferred(
  provider: Provider,
  own: readonly string[],
  { today }: CheckContext,
  report: Report,
): void {
  const sites = ownPages(provider, own);
  provider.plans.forEach((plan, planIndex) => {
    for (const [featureId, inferred] of Object.entries(plan.inferred ?? {})) {
      const path = ['plans', planIndex, 'inferred', featureId];
      if (
        !Object.hasOwn(plan.features, featureId) &&
        !Object.hasOwn(provider.features ?? {}, featureId)
      ) {
        report(path, 'Names a feature the plan doesn’t state: give its value in features first');
      }
      if (!isOnDomain(inferred.page.url, sites)) {
        report(
          [...path, 'page', 'url'],
          `Must be a page of ${provider.name}'s own sites, its policies' or its owner's (${sites.join(', ')})`,
        );
      }
      checkReadOn(inferred.lastVerified, [...path, 'lastVerified'], today, report);
    }
  });
}

/**
 * A provider's own sites and the sites its own pages are on: its website and domains, its policies' pages (Claude's
 * terms on anthropic.com), the shared documents' it names when they're given (ESPN's subscriber agreement, on
 * hulu.com, M11.9) and its owner's site (Microsoft's for Xbox Game Pass), where its owner and the ways to pay it may be
 * stated.
 */
function ownPages(
  provider: Provider,
  own: readonly string[],
  sets: ReadonlyMap<string, PolicySet> = new Map(),
): string[] {
  return [
    ...new Set([
      ...own,
      ...(provider.policies?.links ?? []).map((link) => siteDomain(link.url)),
      ...(provider.policies?.shared ?? []).flatMap((id) =>
        (sets.get(id)?.links ?? []).map((link) => siteDomain(link.url)),
      ),
      ...(provider.owner?.website ? [siteDomain(provider.owner.website)] : []),
    ]),
  ];
}

/**
 * How a provider can be paid (M11.5, the owner's request on 2026-11-02): every provider says, quoted from its own
 * pages, so cash, crypto and gift cards are never missed.
 */
function checkPaymentMethods(provider: Provider, own: readonly string[], report: Report): void {
  if (!provider.paymentMethods) {
    report(
      [],
      'Say how it can be paid: its own page on payment methods, quoted (paymentMethods), cash and crypto included',
    );
    return;
  }
  const sites = ownPages(provider, own);
  provider.paymentMethods.forEach((entry, index) => {
    entry.regions?.forEach((region, item) => {
      if (!isCatalogRegion(region)) {
        report(['paymentMethods', index, 'regions', item], regionProblem(region));
      }
    });
    if (!isOnDomain(entry.url, sites)) {
      report(
        ['paymentMethods', index, 'url'],
        `Must be a page of ${provider.name}'s own sites, its policies' or its owner's (${sites.join(', ')})`,
      );
    }
  });
}

/**
 * Whether a provider has a paid plan still sold that renews by itself by the month or year, so the day it renews on
 * decides its item's charges (M11.5): a prepaid service and a free one don't.
 */
function renewsMonthly(provider: Provider): boolean {
  return provider.plans.some(
    (plan) =>
      plan.retired === undefined &&
      plan.prices.some(
        (price) =>
          price.retired === undefined &&
          price.autoRenew &&
          price.amount > 0 &&
          (price.interval === 'month' || price.interval === 'year'),
      ),
  );
}

/**
 * The day a provider renews on (M11.5): every provider whose paid plans renew by the month or year says, from its own
 * pages (or that they don't say), the 13 from before M11.5 warning until M11.9 reads theirs. A provider that renews
 * every 30 days prices its months as 30 days.
 */
function checkRenewalAnchor(
  provider: Provider,
  own: readonly string[],
  { today, awaitingRenewal, policySets }: CheckContext,
  report: Report,
): void {
  const anchor = provider.renewalAnchor;
  if (!anchor) {
    if (provider.retired === undefined && renewsMonthly(provider)) {
      report(
        [],
        'Say which day it renews on, quoted from its terms or billing help (renewalAnchor), or that they don’t say (kind: not-stated)',
        awaitingRenewal.has(provider.id) ? 'warning' : 'error',
      );
    }
    return;
  }
  const sites = ownPages(provider, own, policySets);
  const pages =
    anchor.kind === 'not-stated'
      ? anchor.pages.map((url, index) => ({ url, path: ['renewalAnchor', 'pages', index] }))
      : [{ url: anchor.url, path: ['renewalAnchor', 'url'] }];
  for (const { url, path } of pages) {
    if (!isOnDomain(url, sites)) {
      report(
        path,
        `Must be a page of ${provider.name}'s own sites, its policies' or its owner's (${sites.join(', ')})`,
      );
    }
  }
  checkReadOn(anchor.lastVerified, ['renewalAnchor', 'lastVerified'], today, report);
  if (anchor.kind !== 'every-30-days') return;
  provider.plans.forEach((plan, planIndex) =>
    plan.prices.forEach((price, index) => {
      if (price.autoRenew && price.interval === 'month' && price.intervalCount === 1) {
        report(
          ['plans', planIndex, 'prices', index, 'interval'],
          'It renews every 30 days (renewalAnchor): price its months as interval day, intervalCount 30',
        );
      }
    }),
  );
}

/** A page's lastVerified: not after today, and a warning once it's a year old, like a policy's. */
/**
 * Finance accounts (M11.10, BLUEPRINT §4.11): a finance provider's plans are accounts, each with its terms, and it says
 * who regulates it; no other provider's plan is one. Its rates and its protection are quoted from its own pages.
 */
function checkAccounts(
  provider: Provider,
  own: readonly string[],
  { today }: CheckContext,
  report: Report,
): void {
  const finance = provider.category === 'finance';
  const sites = ownPages(provider, own);
  provider.plans.forEach((plan, planIndex) => {
    const path = ['plans', planIndex, 'account'];
    if (!plan.account) {
      if (finance) {
        report(
          ['plans', planIndex],
          "Give its account's terms (account): a finance provider's plans are accounts",
        );
      }
      return;
    }
    if (!finance) {
      report(path, "Only a finance provider's plans are accounts: leave account out");
      return;
    }
    const pages = [
      ...(plan.account.rates
        ? [{ url: plan.account.rates.sourceUrl, at: [...path, 'rates', 'sourceUrl'] }]
        : []),
      { url: plan.account.protection.url, at: [...path, 'protection', 'url'] },
    ];
    for (const { url, at } of pages) {
      if (!isOnDomain(url, sites)) {
        report(at, `Must be a page of ${provider.name}'s own sites (${sites.join(', ')})`);
      }
    }
    if (plan.account.rates) {
      checkReadOn(
        plan.account.rates.lastVerified,
        [...path, 'rates', 'lastVerified'],
        today,
        report,
      );
    }
    checkReadOn(
      plan.account.protection.lastVerified,
      [...path, 'protection', 'lastVerified'],
      today,
      report,
    );
  });
  if (finance && !provider.regulators) {
    report([], 'Say who regulates it (regulators), each with its register’s page for it');
  }
  if (!finance && provider.regulators) {
    report(['regulators'], 'Only a finance provider lists regulators: leave them out');
  }
  provider.regulators?.forEach((regulator, index) => {
    if (isOnDomain(regulator.url, own)) {
      report(
        ['regulators', index, 'url'],
        "Must be the regulator's own register, not the provider's site",
      );
    }
    checkReadOn(regulator.lastVerified, ['regulators', index, 'lastVerified'], today, report);
  });
}

function checkReadOn(
  lastVerified: IsoDate,
  path: (string | number)[],
  today: IsoDate,
  report: Report,
): void {
  if (lastVerified > today) {
    report(path, `${lastVerified} is after today (${today})`);
  } else if (addDays(lastVerified, policyStaleAfterDays) < today) {
    report(path, `Read on ${lastVerified}, over a year ago: read the page again`, 'warning');
  }
}

/**
 * The currencies a provider takes beyond its price lists (M11.5): quoted from its own pages, for the ways to pay it
 * lists.
 */
function checkCurrencies(
  provider: Provider,
  own: readonly string[],
  { currencies }: CheckContext,
  report: Report,
): void {
  if (!provider.currencies) return;
  const sites = ownPages(provider, own);
  const methods = new Set(provider.paymentMethods?.flatMap((entry) => entry.methods) ?? []);
  provider.currencies.forEach((entry, index) => {
    entry.regions?.forEach((region, item) => {
      if (!isCatalogRegion(region)) {
        report(['currencies', index, 'regions', item], regionProblem(region));
      }
    });
    entry.codes.forEach((code, item) => {
      if (!currencies.has(code)) {
        report(
          ['currencies', index, 'codes', item],
          `"${code}" isn't a real ISO 4217 currency code`,
        );
      }
    });
    entry.methods?.forEach((method, item) => {
      if (provider.paymentMethods && !methods.has(method)) {
        report(
          ['currencies', index, 'methods', item],
          `${provider.name}'s paymentMethods don't list ${method}: list it there, quoted, or leave it out here`,
        );
      }
    });
    if (!isOnDomain(entry.url, sites)) {
      report(
        ['currencies', index, 'url'],
        `Must be a page of ${provider.name}'s own sites, its policies' or its owner's (${sites.join(', ')})`,
      );
    }
  });
}

/** software.open-source's values from which a provider's apps' code is open: a repository link is then needed. */
const openSourceValues: ReadonlySet<string> = new Set(['open-clients', 'fully-open']);

/**
 * Where a provider's source code is (M11.5): its own page links it, and it goes with software.open-source, a provider
 * whose apps are open (open-source apps or fully open) linking it, and one that links it saying how open it is.
 */
function checkSourceRepo(
  provider: Provider,
  own: readonly string[],
  { today }: CheckContext,
  report: Report,
): void {
  const values = new Set(
    provider.plans.flatMap((plan) => {
      const value = planFeatures(plan, provider)['software.open-source'];
      return typeof value === 'string' ? [value] : [];
    }),
  );
  const repo = provider.sourceRepo;
  if (!repo) {
    if ([...values].some((value) => openSourceValues.has(value))) {
      report(
        [],
        'Its apps are open source (software.open-source): link the repository its own page links, in sourceRepo',
      );
    }
    return;
  }
  if (values.size === 0 || [...values].every((value) => value === 'proprietary')) {
    report(
      ['sourceRepo'],
      'A repository link needs software.open-source saying how open its code is (source-available or more)',
    );
  }
  const sites = ownPages(provider, own);
  if (!isOnDomain(repo.page.url, sites)) {
    report(
      ['sourceRepo', 'page', 'url'],
      `Must be a page of ${provider.name}'s own sites, its policies' or its owner's (${sites.join(', ')})`,
    );
  }
  checkReadOn(repo.lastVerified, ['sourceRepo', 'lastVerified'], today, report);
}

/**
 * A provider's outside ratings (M11.2): each from a rater in data/raters.yaml that rates its subject, with a label
 * from that rater's scale, dated no later than today, on the rater's own site; a subject that needs several raters
 * (a news outlet's bias) has them; and a warning once one is a year old, since the rater may have rated it again.
 */
function checkOutsideRatings(
  ratings: NonNullable<Provider['ratings']>,
  { raters, ratersUnchecked, today }: CheckContext,
  report: Report,
): void {
  ratings.forEach((rating, index) => {
    const path = ['ratings', index];
    if (ratingDay(rating.date) > today) {
      report([...path, 'date'], `${rating.date} is after today (${today})`);
    } else if (ratingIsOld(rating.date, today)) {
      report(
        [...path, 'date'],
        `Rated ${rating.date}, over a year ago: look for ${raters.get(rating.rater)?.name ?? 'the rater'}'s newer rating`,
        'warning',
      );
    }
    const rater = raters.get(rating.rater);
    if (!rater) {
      if (!ratersUnchecked) {
        report(
          [...path, 'rater'],
          `"${rating.rater}" isn't in ${ratersFile}${didYouMean(rating.rater, [...raters.keys()], 'add it there once its terms allow showing its labels')}`,
        );
      }
      return;
    }
    const scale = rater.scales.find((candidate) => candidate.subject === rating.subject);
    if (!scale) {
      report(
        [...path, 'subject'],
        `${rater.name} doesn't rate ${rating.subject}${choices(
          rating.subject,
          rater.scales.map((candidate) => candidate.subject),
        )}`,
      );
    } else if (!scale.labels.includes(rating.label)) {
      report(
        [...path, 'label'],
        `"${rating.label}" isn't on ${rater.name}'s scale for ${rating.subject}${choices(rating.label, scale.labels)}`,
      );
    }
    const domains = [siteDomain(rater.website), ...(rater.domains ?? [])];
    if (!isOnDomain(rating.url, domains)) {
      report(
        [...path, 'url'],
        `Must be ${rater.name}'s own page for it, on ${domains.join(' or ')}`,
      );
    }
  });
  for (const [subject, { name, minRaters }] of Object.entries(ratingSubjects)) {
    const rated = ratings
      .map((rating, index) => ({ rating, index }))
      .filter(({ rating }) => rating.subject === subject);
    const count = new Set(rated.map(({ rating }) => rating.rater)).size;
    if (rated.length > 0 && count < minRaters) {
      report(
        ['ratings', rated[0].index, 'subject'],
        `${name} (${subject}) needs ${minRaters} raters at least, so no single rater's view stands alone: add another or leave it out`,
      );
    }
  }
}

/**
 * A provider's owner (M11.2): quoted from its own pages, on its sites or the sites of its own policies (Claude's terms
 * on anthropic.com), or from its owner's own site (Microsoft's annual report for Xbox Game Pass). Every provider needs
 * one (the owner's request on 2026-11-02).
 */
function checkOwner(
  provider: Provider,
  own: readonly string[],
  { today }: CheckContext,
  report: Report,
): void {
  const { owner } = provider;
  if (!owner) {
    report(
      [],
      'Say who owns it: quote its about page, its owner’s own page about it, or its terms, in owner',
    );
    return;
  }
  const sites = ownPages(provider, own);
  const offSite = `Must be a page of ${provider.name}'s own sites, its policies' or its owner's (${sites.join(', ')}): give the owner's site in website when the page is there`;
  if (!isOnDomain(owner.page.url, sites)) report(['owner', 'page', 'url'], offSite);
  // Where the company is from (the owner's choice, 2026-11-03), quoted like its name.
  const { country } = owner;
  if (!country) {
    report(
      ['owner'],
      'Say where the company is from: owner.country, an ISO 3166-1 code, quoted from its own pages or its owner’s',
    );
  } else {
    if (!isoRegions.has(country.code)) {
      report(
        ['owner', 'country', 'code'],
        country.code === 'UK'
          ? regionProblem(country.code)
          : `"${country.code}" isn't an ISO 3166-1 country code (US, CA, CH)`,
      );
    }
    if (country.page && !isOnDomain(country.page.url, sites)) {
      report(['owner', 'country', 'page', 'url'], offSite);
    }
    if (country.lastVerified) {
      checkReadOn(country.lastVerified, ['owner', 'country', 'lastVerified'], today, report);
    }
  }
  checkReadOn(owner.lastVerified, ['owner', 'lastVerified'], today, report);
}

/** A rater no provider shows gets a warning: it's either missing from a provider file or no longer needed. */
function warnUnusedRaters(
  raters: readonly Rater[],
  providers: readonly ReadFile<Provider>[],
  report: Report,
): void {
  const used = new Set(
    providers.flatMap(({ value }) => value.ratings?.map((rating) => rating.rater) ?? []),
  );
  raters.forEach((rater, index) => {
    if (!used.has(rater.id)) {
      report(
        [index, 'id'],
        'No provider shows this rater: add its ratings to the providers it rates, or remove it',
        'warning',
      );
    }
  });
}

/**
 * A provider's policy ratings (BLUEPRINT §4.10): each names a topic from data/policy-topics.yaml that applies to it
 * (a topic for some categories, such as activity logging, needs a plan in one; a billing topic, a paid plan), and
 * the shared documents it names are in data/policies/. Its own rating replaces a shared one only where one rates the
 * topic.
 */
function checkPolicies(
  provider: Provider,
  policies: Policies,
  context: CheckContext,
  report: Report,
): void {
  const { policyTopics, policySets } = context;
  const categories = providerCategories(provider);
  const ratings = policies.ratings ?? [];
  checkRatingList(
    ratings,
    ['policies'],
    {
      name: provider.name,
      sites: [
        siteDomain(provider.website),
        ...(provider.domains ?? []),
        ...(policies.links ?? []).map((link) => siteDomain(link.url)),
      ],
      waiting: context.awaitingRegrade.has(provider.id),
    },
    context,
    report,
  );
  ratings.forEach((rating, index) => {
    const path = ['policies', 'ratings', index];
    const topic = policyTopics?.get(rating.topic);
    if (topic?.categories && !topic.categories.some((id) => categories.includes(id))) {
      report(
        [...path, 'topic'],
        `${topic.name} is only for providers with a plan in ${topic.categories.join(' or ')}`,
      );
    } else if (topic?.paidPlans !== undefined && paidPlanCount(provider) < topic.paidPlans) {
      report(
        [...path, 'topic'],
        `${topic.name} is only for providers with ${topic.paidPlans === 1 ? 'a paid plan' : `${topic.paidPlans} paid plans or more`}`,
      );
    }
    const named = (policies.shared ?? []).flatMap((id) => policySets.get(id) ?? []);
    if (
      rating.replacesShared &&
      named.length === (policies.shared ?? []).length &&
      !named.some((set) => set.ratings.some((other) => other.topic === rating.topic))
    ) {
      report(
        [...path, 'replacesShared'],
        `No shared document it names rates ${rating.topic}: leave replacesShared out`,
      );
    }
  });
  policies.shared?.forEach((id, index) => {
    if (!policySets.has(id) && !context.policySetsUnchecked.has(id)) {
      report(
        ['policies', 'shared', index],
        `"${id}" isn't a shared document in ${policySetsDir}${didYouMean(id, [...policySets.keys()], `add data/policies/${id}.yaml`)}`,
      );
    }
  });
}

/**
 * A provider's ratings or a shared document's: each on a topic of data/policy-topics.yaml, read on a date that isn't
 * after today, with a way to change it on its owner's sites, which a grade the topic's actionFor lists must have. A
 * titled topic's ratings (other.notable) each have a title, up to three. Ratings older than a year are worth reading
 * again.
 */
function checkRatingList(
  ratings: readonly PolicyRating[],
  base: CatalogIssuePath,
  owner: {
    name: string;
    sites: readonly string[];
    /** Rated before M11.1 and waiting for M11.9's regrade: a missing action is a warning. */
    waiting: boolean;
  },
  { policyTopics, today }: CheckContext,
  report: Report,
): void {
  const topicIds = [...(policyTopics?.keys() ?? [])];
  const sites = [...new Set(owner.sites)];
  let oldest: IsoDate | undefined;
  ratings.forEach((rating, index) => {
    const path = [...base, 'ratings', index];
    const topic = policyTopics?.get(rating.topic);
    if (policyTopics && !topic) {
      report(
        [...path, 'topic'],
        `"${rating.topic}" isn't a topic in ${policyTopicsFile}${choices(rating.topic, topicIds)}`,
      );
    }
    if (topic) {
      checkTitle(topic, rating, path, report);
    }
    // A grade that means the user has to act links where they do it (M5.12, M11.1).
    if (rating.tier && topic?.actionFor?.includes(rating.tier) && !rating.action) {
      report(
        [...path, 'action'],
        `${topic.name} rated ${capitalized(rating.tier)} means the user has to act: link ${owner.name}'s own page for it in action`,
        owner.waiting ? 'warning' : 'error',
      );
    }
    if (rating.lastVerified > today) {
      report([...path, 'lastVerified'], `${rating.lastVerified} is after today (${today})`);
    }
    // The provider's own way to change it (M5.12): on its sites, or the site its policies are on (Disney's privacy
    // center, Bell's), never another company's.
    if (rating.action && !isOnDomain(rating.action.url, sites)) {
      report(
        [...path, 'action', 'url'],
        `Must be a page of ${owner.name}'s own sites or its policies' (${sites.join(', ')}): its own way to change it`,
      );
    }
    if (oldest === undefined || rating.lastVerified < oldest) {
      oldest = rating.lastVerified;
    }
  });
  for (const topic of policyTopics?.values() ?? []) {
    if (!topic.titled) continue;
    ratings
      .map((rating, index) => ({ rating, index }))
      .filter(({ rating }) => rating.topic === topic.id)
      .slice(titledRatingsMax)
      .forEach(({ index }) =>
        report(
          [...base, 'ratings', index, 'topic'],
          `${topic.name} takes up to ${titledRatingsMax} ratings: keep the ones that stand out most`,
        ),
      );
  }
  if (oldest !== undefined && addDays(oldest, policyStaleAfterDays) < today) {
    report(
      base,
      `Some ratings were read on ${oldest}, over a year ago: read the pages again`,
      'warning',
    );
  }
}

/**
 * A shared policy document (data/policies/<id>.yaml): its ratings, checked as a provider's are, with its own pages'
 * sites for its ways to change things; and a warning when no provider names it.
 */
function checkPolicySet(
  set: PolicySet,
  providers: readonly Provider[],
  context: CheckContext,
  report: Report,
): void {
  const naming = providers.filter((provider) => provider.policies?.shared?.includes(set.id));
  checkRatingList(
    set.ratings,
    [],
    {
      name: set.name,
      sites: set.links.map((link) => siteDomain(link.url)),
      waiting:
        naming.length > 0 && naming.every((provider) => context.awaitingRegrade.has(provider.id)),
    },
    context,
    report,
  );
  if (naming.length === 0) {
    report(
      ['id'],
      "No provider names this document in its policies' shared: add it to the providers it covers, or remove it",
      'warning',
    );
  }
}

/**
 * A plan lists every category it fits (M11.3): one its features name (a VPN, a password manager) is in its
 * categories, a warning, or in its notIn, when it comes with the plan but isn't what it's sold as. notIn names only
 * service categories its features name and it isn't in. A rule whose feature or category isn't defined is inactive.
 */
function checkFeatureCategories(
  plan: Plan,
  provider: Provider,
  path: CatalogIssuePath,
  {
    registry,
    serviceIds,
    report,
  }: { registry: FeatureRegistry; serviceIds: readonly string[] | undefined; report: Report },
): void {
  const inCategories = planCategories(plan, provider);
  const named = featureNamedCategories(plan, (id) => registry.features.has(id)).filter(
    ({ category }) => !serviceIds || serviceIds.includes(category),
  );
  const notIn = plan.notIn ?? [];
  notIn.forEach((id, index) => {
    const at = [...path, 'notIn', index];
    if (serviceIds && !serviceIds.includes(id)) {
      report(
        at,
        `"${id}" isn't a service category in data/categories.yaml${choices(id, serviceIds)}`,
      );
    } else if (inCategories.includes(id)) {
      report(at, `It's in ${id}: take ${id} out of notIn or out of its categories`);
    } else if (!named.some(({ category }) => category === id)) {
      report(at, `No feature of it names ${id}: leave ${id} out of notIn`);
    }
  });
  const missing = named.filter(
    ({ category }) => !inCategories.includes(category) && !notIn.includes(category),
  );
  if (missing.length > 0) {
    const list = missing.map(({ category }) => category).join(', ');
    report(
      [...path, plan.categories ? 'categories' : 'id'],
      `Its features say it's in ${missing.map(({ category, feature }) => `${category} (${feature})`).join(', ')}: add ${list} to its categories, or to notIn when ${missing.length === 1 ? 'it comes' : 'they come'} with the plan but ${missing.length === 1 ? "isn't" : "aren't"} what it's sold as`,
      'warning',
    );
  }
}

/**
 * A topic and a feature on the same fact both stay, the feature for ranking and the topic for the card, and must agree
 * (M11.1, the guide's §1.3 step 9): a rating of `tier` on `topic` needs one of `values` in `feature` (provider-wide
 * features included) on every plan it covers, or only those that have `parent` when it names one. A rule whose
 * feature isn't in the registry yet is inactive.
 */
export const topicFeatureRules: readonly {
  topic: string;
  tier: PolicyTier;
  feature: string;
  values: readonly string[];
  parent?: string;
  /** Why, after "Great needs …". */
  needs: string;
  /** The other way out, after "grade it lower, or …". */
  fix: string;
}[] = [
  {
    topic: 'service.activity-logging',
    tier: 'great',
    feature: 'vpn.independent-audits',
    values: ['no-logs'],
    parent: 'vpn.included',
    needs: 'an independent audit of the no-logs claim',
    fix: 'add the audit to the feature with its source',
  },
  {
    topic: 'legal.licence',
    tier: 'great',
    feature: 'software.open-source',
    values: [...openSourceValues],
    needs: 'open-source apps',
    fix: 'state software.open-source from its own page',
  },
];

function checkTopicFeatures(provider: Provider, context: CheckContext, report: Report): void {
  const { registry, policySets } = context;
  const policies = provider.policies;
  if (!registry || !policies) return;
  const rated = [
    ...(policies.ratings ?? []).map((rating, index) => ({
      rating,
      path: ['policies', 'ratings', index, 'tier'],
    })),
    ...(policies.shared ?? []).flatMap((id, index) =>
      (policySets.get(id)?.ratings ?? []).map((rating) => ({
        rating,
        path: ['policies', 'shared', index],
      })),
    ),
  ];
  for (const rule of topicFeatureRules) {
    if (!registry.features.has(rule.feature)) continue;
    for (const { rating, path } of rated) {
      if (rating.topic !== rule.topic || rating.tier !== rule.tier) continue;
      const lacking = provider.plans.filter((plan) => {
        if (rating.plans && !rating.plans.includes(plan.id)) return false;
        const features = planFeatures(plan, provider);
        if (rule.parent !== undefined && features[rule.parent] !== true) return false;
        const value = features[rule.feature];
        return !(Array.isArray(value) ? value : [value]).some(
          (one) => typeof one === 'string' && rule.values.includes(one),
        );
      });
      if (lacking.length > 0) {
        report(
          path,
          `${capitalized(rule.tier)} needs ${rule.needs}, but ${lacking.map((plan) => plan.id).join(', ')} ${lacking.length === 1 ? 'has' : 'have'} no ${rule.values.join(' or ')} in ${rule.feature}: grade it lower, or ${rule.fix}`,
        );
      }
    }
  }
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A titled topic's ratings have a title and a grade; no other topic's has a title. */
function checkTitle(
  topic: PolicyTopic,
  rating: PolicyRating,
  path: CatalogIssuePath,
  report: Report,
): void {
  if (!topic.titled) {
    if (rating.title !== undefined) {
      report(
        [...path, 'title'],
        'Only a titled topic’s ratings (other.notable) have a title: leave it out',
      );
    }
    return;
  }
  if (rating.title === undefined) {
    report(
      [...path, 'title'],
      `Give each ${topic.name} rating a title: what stands out, in a few words`,
    );
  }
  if (rating.status !== undefined) {
    report([...path, 'status'], `${topic.name} is never required: grade it, or leave it out`);
  }
}

/**
 * Every topic that applies to a provider has a rating or a status for everywhere and every plan (M11.1), its own or a
 * shared document's, so cards line up: a rating for some plans or regions sits over that one and doesn't replace it.
 * An error, or a warning for a provider waiting for M11.9's regrade.
 */
function checkPolicyCoverage(provider: Provider, context: CheckContext, report: Report): void {
  if (!context.policyTopics) return;
  const shared = provider.policies?.shared ?? [];
  // A shared document that's broken has its own errors: what it rates is unknown.
  if (shared.some((id) => context.policySetsUnchecked.has(id))) return;
  const ratings = [
    ...(provider.policies?.ratings ?? []),
    ...shared.flatMap((id) => context.policySets.get(id)?.ratings ?? []),
  ];
  const missing = [...context.policyTopics.values()]
    .filter((topic) => topicApplies(topic, provider))
    .flatMap((topic) => {
      const rated = ratings.filter((rating) => rating.topic === topic.id);
      if (rated.some((rating) => !rating.plans && !rating.regions)) return [];
      return [rated.length > 0 ? `${topic.id} (only for some plans or regions)` : topic.id];
    });
  if (missing.length === 0) return;
  const waiting = context.awaitingRegrade.has(provider.id);
  const count = missing.length === 1 ? 'a topic' : `${missing.length} topics`;
  report(
    provider.policies ? ['policies'] : [],
    `${waiting ? 'Waiting for M11.9’s regrade: no' : 'No'} rating or status for ${count} that ${missing.length === 1 ? 'applies' : 'apply'}: ${missing.join(', ')}. Rate each, or give it a status (not-stated or not-applicable)`,
    waiting ? 'warning' : 'error',
  );
}

/**
 * A provider's reseller: one data/resellers.yaml lists, approved on the provider's own site (only the shops a provider
 * names are listed, BLUEPRINT §4.9), with its prices on the reseller's own pages.
 */
function checkResellerListing(
  provider: Provider,
  listing: NonNullable<Provider['resellers']>[number],
  path: CatalogIssuePath,
  context: CheckContext,
  prices: PriceChecks,
  report: Report,
): void {
  const reseller = context.resellers.get(listing.reseller);
  if (!reseller && !context.resellersUnchecked) {
    report(
      [...path, 'reseller'],
      `"${listing.reseller}" isn't in ${resellersFile}${didYouMean(listing.reseller, [...context.resellers.keys()], 'add it there')}`,
    );
  }
  const own = [siteDomain(provider.website), ...(provider.domains ?? [])];
  if (!isOnDomain(listing.approvedBy.url, own)) {
    report(
      [...path, 'approvedBy', 'url'],
      `Must be a page of ${provider.name}'s own sites, on ${own.join(' or ')}: only the resellers it names are listed`,
    );
  }
  listing.offers.forEach((offer, offerIndex) => {
    const pricesPath = [...path, 'offers', offerIndex, 'prices'];
    prices.check(offer.prices, pricesPath);
    if (!reseller) return;
    const domains = resellerDomains(reseller);
    offer.prices.forEach((price, priceIndex) => {
      if (!isOnDomain(price.sourceUrl, domains)) {
        report(
          [...pricesPath, priceIndex, 'sourceUrl'],
          `Must be ${reseller.name}'s page, on ${domains.join(' or ')}: if the domain is theirs, add it to their domains in ${resellersFile}`,
        );
      }
    });
  });
}

/** A reseller no provider lists gets a warning: it's either missing from a provider file or no longer needed. */
function warnUnlisted(
  resellers: ReadFile<readonly Reseller[]>,
  providers: readonly ReadFile<Provider>[],
): void {
  const listed = new Set(
    providers.flatMap(({ value }) => value.resellers?.map((listing) => listing.reseller) ?? []),
  );
  resellers.value.forEach((reseller, index) => {
    if (!listed.has(reseller.id)) {
      resellers.report(
        [index, 'id'],
        'No provider lists this reseller: add it to the resellers of the providers whose plans it sells, or remove it',
        'warning',
      );
    }
  });
}

/** A provider's plans and add-ons, each with its path in the file. */
function pricedItems(
  provider: Provider,
): { item: Plan | AddOn; path: CatalogIssuePath; kind: 'plan' | 'add-on' }[] {
  return [
    ...provider.plans.map((item, index) => ({
      item,
      path: ['plans', index],
      kind: 'plan' as const,
    })),
    ...(provider.addOns ?? []).map((item, index) => ({
      item,
      path: ['addOns', index],
      kind: 'add-on' as const,
    })),
  ];
}

/**
 * When a provider says which currency it charges in each region, every region a plan or add-on is priced in has
 * an entry, and the item has a price there in that currency. A missing region is reported once per file, and a
 * currency or region that isn't real only once, by checkProvider and PriceChecks.
 */
function checkBillingCurrency(
  provider: Provider,
  billingCurrency: Readonly<Record<string, string>>,
  currencies: ReadonlySet<string>,
  report: Report,
): void {
  const reported = new Set<string>();
  for (const { item, path, kind } of pricedItems(provider)) {
    const firstInRegion = new Map<string, number>();
    item.prices.forEach((price, index) => {
      if (isCatalogRegion(price.region) && !firstInRegion.has(price.region)) {
        firstInRegion.set(price.region, index);
      }
    });
    for (const [region, index] of firstInRegion) {
      const pricePath = [...path, 'prices', index];
      if (!Object.hasOwn(billingCurrency, region)) {
        if (!reported.has(region)) {
          reported.add(region);
          report(
            [...pricePath, 'region'],
            `billingCurrency has no ${region}: add ${region}: ${item.prices[index].currency} to it`,
          );
        }
        continue;
      }
      const charged = billingCurrency[region];
      if (
        currencies.has(charged) &&
        !item.prices.some((price) => price.region === region && price.currency === charged)
      ) {
        report(
          [...pricePath, 'currency'],
          `billingCurrency charges ${charged} in ${region}, so this ${kind} needs a ${region} price in ${charged}`,
        );
      }
    }
  }
}

/**
 * availableIn is the full list of regions a provider sells in, so it covers every region a plan or add-on is
 * priced in: a member state through its group too, and a group through itself or one of its members. A missing
 * region is reported once per file.
 */
function checkAvailableIn(
  provider: Provider,
  availableIn: readonly string[],
  report: Report,
): void {
  availableIn.forEach((region, index) => {
    if (region === globalRegion) {
      report(
        ['availableIn', index],
        'GLOBAL means everywhere: list regions here, or leave availableIn out',
      );
    } else if (!isCatalogRegion(region)) {
      report(['availableIn', index], regionProblem(region));
    }
  });
  const listed = (region: string) =>
    [region, ...groupsOf(region), ...membersOf(region)].some((covered) =>
      availableIn.includes(covered),
    );
  const reported = new Set<string>();
  for (const { item, path, kind } of pricedItems(provider)) {
    item.prices.forEach(({ region }, index) => {
      if (region === globalRegion || !isCatalogRegion(region) || reported.has(region)) {
        return;
      }
      if (!listed(region)) {
        reported.add(region);
        report(
          [...path, 'prices', index, 'region'],
          `availableIn has no ${region}, but this ${kind} is priced there: add ${region} to it`,
        );
      }
    });
  }
}

/**
 * Each logo is a PNG the app can show, named after a provider or reseller. One without gets a warning, since the
 * app shows its first letter instead; `npm run data:icons` fetches one.
 */
function checkLogos(
  logos: readonly NamedFile[],
  providers: readonly ReadFile<Provider>[],
  resellers: ReadFile<readonly Reseller[]> | undefined,
  { ids, resellersUnchecked }: CheckContext,
  reportIn: (file: string) => Report,
): void {
  for (const { source, name } of logos) {
    const report = reportIn(source.file);
    const kind = ids.kindOf(name);
    // With the resellers file broken, an unknown name may be one of its resellers.
    const known = kind === 'provider' || kind === 'reseller' || kind === 'unchecked';
    if (!known && !(kind === undefined && resellersUnchecked)) {
      report(
        [],
        `"${name}" isn't a provider or reseller id: name the logo after one${didYouMean(name, ids.all('provider', 'reseller'))}`,
      );
    }
    const problem = iconProblem('bytes' in source ? readPngImage(source.bytes) : undefined);
    if (problem) {
      report([], problem);
    }
  }
  const named = new Set(logos.map(({ name }) => name));
  const noLogo = (id: string) =>
    `No logo, so the app shows a letter: run npm run data:icons to fetch data/logos/${id}.png`;
  for (const { value, report } of providers) {
    if (!named.has(value.id)) {
      report([], noLogo(value.id), 'warning');
    }
  }
  resellers?.value.forEach((reseller, index) => {
    if (!named.has(reseller.id)) {
      resellers.report([index, 'id'], noLogo(reseller.id), 'warning');
    }
  });
}

/**
 * The discovery queue (BLUEPRINT §6.5): its schema, real service categories, and agreement with the catalog: an entry
 * is done exactly when its provider file is there, and a queued service isn't already on a provider's site.
 */
function checkQueue(
  source: CatalogSourceFile,
  providers: readonly ReadFile<Provider>[],
  unchecked: ReadonlySet<string>,
  categories: Categories | undefined,
  report: Report,
): void {
  const queue = parseFile(queueFileSchema, source, report);
  if (!queue) {
    return;
  }
  const serviceIds = categories?.service.map((category) => category.id);
  const providerIds = new Set(providers.map(({ value }) => value.id));
  queue.forEach((entry, index) => {
    if (serviceIds && !serviceIds.includes(entry.category)) {
      report(
        [index, 'category'],
        `"${entry.category}" isn't a service category in ${categoriesFile}${choices(entry.category, serviceIds)}`,
      );
    }
    if (unchecked.has(entry.id)) {
      return;
    }
    const inCatalog = providerIds.has(entry.id);
    if (entry.status === 'done' && !inCatalog) {
      report(
        [index, 'status'],
        `"${entry.id}" is done, but there's no data/providers/${entry.id}.yaml: add it, or give another status with a note`,
      );
    } else if (entry.status !== 'done' && inCatalog) {
      report(
        [index, 'status'],
        `"${entry.id}" is in the catalog (data/providers/${entry.id}.yaml): mark it done`,
      );
    } else if (entry.status === 'queued') {
      const owner = providers.find(({ value }) => onSites(entry.website, providerSiteKeys(value)));
      if (owner) {
        report(
          [index, 'website'],
          `It's on ${owner.value.id}'s site, which is in the catalog: remove the entry, or give it a status with a note`,
        );
      }
    }
  });
}

function checkBundle(bundle: Bundle, context: CheckContext, report: Report): void {
  const { ids } = context;
  const seller = ids.kindOf(bundle.soldBy);
  if (seller !== 'provider' && seller !== 'unchecked') {
    report(
      ['soldBy'],
      `"${bundle.soldBy}" isn't a provider${didYouMean(bundle.soldBy, ids.all('provider'))}`,
    );
  }
  bundle.includes.forEach((id, index) => {
    const kind = ids.kindOf(id);
    if (kind === 'add-on' || kind === 'bundle') {
      report(['includes', index], `"${id}" is ${withArticle(kind)}: a bundle includes plans`);
    } else if (kind !== 'plan' && kind !== 'unchecked') {
      report(['includes', index], `"${id}" isn't a plan${didYouMean(id, ids.all('plan'))}`);
    }
  });
  const prices = new PriceChecks(context, report);
  prices.check(bundle.prices, ['prices']);
  prices.warnIfStale();
}

interface StalePrice {
  date: IsoDate;
  path: CatalogIssuePath;
}

/**
 * The price checks for one file: real regions and currencies, no repeats within an item and no lastVerified after
 * today. It counts the prices last verified more than 90 days ago, for one warning per file.
 */
class PriceChecks {
  private readonly context: CheckContext;
  private readonly report: Report;
  private readonly staleBefore: IsoDate;
  private count = 0;
  private readonly stale: StalePrice[] = [];

  constructor(context: CheckContext, report: Report) {
    this.context = context;
    this.report = report;
    this.staleBefore = addDays(context.today, -staleAfterDays);
  }

  /**
   * `path` is the prices list's own. A retired plan's are its last prices, kept as they were, so never stale (M10.27),
   * and so is a retired price (M10.28).
   */
  check(prices: readonly Price[], path: CatalogIssuePath, retired = false): void {
    const { today, currencies } = this.context;
    const first = new Map<string, number>();
    prices.forEach((price, index) => {
      const at = [...path, index];
      if (!isCatalogRegion(price.region)) {
        this.report([...at, 'region'], regionProblem(price.region));
      }
      if (!currencies.has(price.currency)) {
        this.report([...at, 'currency'], `"${price.currency}" isn't a real ISO 4217 currency code`);
      }
      if (price.lastVerified > today) {
        this.report(
          [...at, 'lastVerified'],
          `${price.lastVerified} is after today (${today}): use the date the price was checked`,
        );
      } else if (!retired && price.retired === undefined && price.lastVerified < this.staleBefore) {
        this.stale.push({ date: price.lastVerified, path: [...at, 'lastVerified'] });
      }
      if (price.retired !== undefined && price.retired > today) {
        this.report(
          [...at, 'retired'],
          `${price.retired} is after today (${today}): use the day the provider stopped selling it`,
        );
      }
      this.count++;
      const key = [price.region, price.currency, price.interval, price.intervalCount].join(' ');
      const earlier = first.get(key);
      if (earlier === undefined) {
        first.set(key, index);
      } else {
        this.report(
          at,
          `Same region, currency, interval and intervalCount as prices.${earlier}: keep one`,
        );
      }
    });
  }

  warnIfStale(): void {
    const oldest = this.stale.reduce<StalePrice | undefined>(
      (found, entry) => (found === undefined || entry.date < found.date ? entry : found),
      undefined,
    );
    if (!oldest) {
      return;
    }
    const ofAll = `of ${this.count} ${this.count === 1 ? 'price' : 'prices'}`;
    const ago = `more than ${staleAfterDays} days ago`;
    this.report(
      oldest.path,
      this.stale.length === 1
        ? `1 ${ofAll} was last verified ${ago}, on ${oldest.date}. Check it again and update lastVerified`
        : `${this.stale.length} ${ofAll} were last verified ${ago}, the oldest on ${oldest.date}. Check them again and update lastVerified`,
      'warning',
    );
  }
}

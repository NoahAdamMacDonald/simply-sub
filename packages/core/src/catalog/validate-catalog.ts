import type * as z from 'zod';
import { addDays, type IsoDate } from '../dates/iso-date';
import { iconProblem, readPngImage } from '../icons/icon-image';
import { bundleSchema, type Bundle } from './bundle';
import { categoriesFileSchema, type Categories } from './category';
import { choices, didYouMean, idOf, listedMoreThanOnce, repeatedIndexes } from './checks';
import { featuresFileSchema } from './feature';
import { slugSchema } from './formats';
import type { CatalogFileKind } from './json-schema';
import { providerCategories } from './plan-categories';
import type { Policies } from './policy';
import { policyTopicsFileSchema, type PolicyTopic } from './policy-topic';
import { automationSchema } from '../pipeline/automation';
import { onSites, providerSiteKeys, queueFileSchema } from '../pipeline/queue';
import type { Price } from './price';
import { providerSchema, type AddOn, type Plan, type Provider } from './provider';
import { globalRegion, groupsOf, isCatalogRegion, membersOf, regionProblem } from './regions';
import {
  isOnDomain,
  resellerDomains,
  resellersFileSchema,
  siteDomain,
  type Reseller,
} from './reseller';
import {
  checkInclusionLoops,
  checkPlanFeatures,
  readFeatureRegistry,
  type FeatureRegistry,
} from './validate-features';

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
const staleAfterDays = 90;
/** Terms change less often than prices, and no nightly check reads them. */
const policyStaleAfterDays = 365;

/**
 * Every problem in the catalog, file by file. `files` are all the .yaml and .yml files under data/ and every file
 * in data/logos/, with paths from the repo root. A broken file gets its own errors, and the checks that would only
 * repeat them are left out: a provider that fails its schema isn't checked against the registry, and references
 * to it aren't flagged.
 */
export function validateCatalog(
  files: readonly CatalogSourceFile[],
  today: IsoDate,
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
  if (!located.policyTopics && providers.some(({ value }) => value.policies)) {
    reportPolicyTopics(
      [],
      'Missing: the topics that providers rate their policies on go here (BLUEPRINT §4.10)',
    );
  }
  const serviceIds = categories?.service.map((category) => category.id);
  policyTopics?.forEach((topic, index) =>
    topic.categories?.forEach((id, categoryIndex) => {
      if (serviceIds && !serviceIds.includes(id)) {
        reportPolicyTopics(
          [index, 'categories', categoryIndex],
          `"${id}" isn't a service category in ${categoriesFile}${choices(id, serviceIds)}`,
        );
      }
    }),
  );

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
  };
  for (const { value, report } of providers) {
    checkProvider(value, context, report);
  }
  if (resellersRead && unchecked.size === 0) {
    warnUnlisted(resellersRead, providers);
  }
  for (const { value, report } of bundles) {
    checkBundle(value, context, report);
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
  providers: NamedFile[];
  bundles: NamedFile[];
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
  const named = /^data\/(providers|bundles)\/([^/]+)\.yaml$/.exec(file);
  if (named) {
    return { kind: named[1] === 'providers' ? 'provider' : 'bundle', name: named[2] };
  }
  const logo = /^data\/logos\/([^/]+)\.png$/.exec(file);
  return logo ? { kind: 'logo', name: logo[1] } : undefined;
}

function locateFiles(
  files: readonly CatalogSourceFile[],
  reportIn: (file: string) => Report,
): LocatedFiles {
  const located: LocatedFiles = { providers: [], bundles: [], logos: [] };
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
    } else if (where) {
      const list = { provider: 'providers', bundle: 'bundles', logo: 'logos' } as const;
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
        'Not a catalog file: use data/features.yaml, data/categories.yaml, data/resellers.yaml, data/policy-topics.yaml, data/queue.yaml, data/automation.yaml, data/providers/<id>.yaml or data/bundles/<slug>.yaml',
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

  const planIds = provider.plans.map((plan) => plan.id);
  const addOnIds = (provider.addOns ?? []).map((addOn) => addOn.id);
  const prices = new PriceChecks(context, report);
  const serviceIds = categories?.service.map((category) => category.id);
  provider.plans.forEach((plan, index) => {
    const path = ['plans', index];
    if (registry) {
      checkPlanFeatures(plan, path, { registry, ids, providerId: provider.id, report });
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
    prices.check(plan.prices, [...path, 'prices']);
  });

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
    prices.check(addOn.prices, [...path, 'prices']);
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
}

/**
 * A provider's policy ratings (BLUEPRINT §4.10): each names a topic from data/policy-topics.yaml that applies to it
 * (a topic for some categories, such as VPN logging, needs a plan in one), read on a date that isn't after today.
 * Ratings older than a year are worth reading again.
 */
function checkPolicies(
  provider: Provider,
  policies: Policies,
  { policyTopics, today }: CheckContext,
  report: Report,
): void {
  const categories = providerCategories(provider);
  const topicIds = [...(policyTopics?.keys() ?? [])];
  const actionSites = [
    ...new Set([
      siteDomain(provider.website),
      ...(provider.domains ?? []),
      ...policies.links.map((link) => siteDomain(link.url)),
    ]),
  ];
  let oldest: IsoDate | undefined;
  policies.ratings.forEach((rating, index) => {
    const path = ['policies', 'ratings', index];
    const topic = policyTopics?.get(rating.topic);
    if (policyTopics && !topic) {
      report(
        [...path, 'topic'],
        `"${rating.topic}" isn't a topic in ${policyTopicsFile}${choices(rating.topic, topicIds)}`,
      );
    }
    if (topic?.categories && !topic.categories.some((id) => categories.includes(id))) {
      report(
        [...path, 'topic'],
        `${topic.name} is only for providers with a plan in ${topic.categories.join(' or ')}`,
      );
    }
    if (rating.lastVerified > today) {
      report([...path, 'lastVerified'], `${rating.lastVerified} is after today (${today})`);
    }
    // The provider's own way to change it (M5.12): on its sites, or the site its policies are on (Disney's privacy
    // center, Bell's), never another company's.
    if (rating.action && !isOnDomain(rating.action.url, actionSites)) {
      report(
        [...path, 'action', 'url'],
        `Must be a page of ${provider.name}'s own sites or its policies' (${actionSites.join(', ')}): its own way to change it`,
      );
    }
    if (oldest === undefined || rating.lastVerified < oldest) {
      oldest = rating.lastVerified;
    }
  });
  if (oldest !== undefined && addDays(oldest, policyStaleAfterDays) < today) {
    report(
      ['policies'],
      `Some ratings were read on ${oldest}, over a year ago: read the pages again`,
      'warning',
    );
  }
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

  /** `path` is the prices list's own. */
  check(prices: readonly Price[], path: CatalogIssuePath): void {
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
      } else if (price.lastVerified < this.staleBefore) {
        this.stale.push({ date: price.lastVerified, path: [...at, 'lastVerified'] });
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

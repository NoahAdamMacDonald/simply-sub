import {
  buildPolicyIndex,
  citedPages,
  planTitle,
  policyFiles,
  retirementOf,
  type Bundle,
  type PolicyIndex,
  type PolicyRating,
  type PolicySet,
  type Price,
  type Provider,
  type SnapshotProvider,
} from '@simply-sub/core';
import type { CatalogIndex } from './run';
import type {
  ApprovalTarget,
  NetworksTarget,
  PolicyPageTarget,
  PriceTarget,
  RateTarget,
} from './types';

// What the check looks at for each provider and bundle (BLUEPRINT §6.4): every price with a sourceUrl (its plans', its
// add-ons', its resellers' offers'), every reseller's approval, and each region's accepted card networks (§9.3). A price
// without a sourceUrl was read from a page that can't be fetched (a checkout), so a person checks it. A retired plan's
// prices are its last ones, kept as they were (BLUEPRINT §4.3, M10.27): its page no longer has them, so they're left
// out, and so are a retired provider's add-ons.

export function providerFile(id: string): string {
  return `data/providers/${id}.yaml`;
}

/** A shared policy document's file (M11.1). */
export function policySetFile(id: string): string {
  return `data/policies/${id}.yaml`;
}

export function bundleFile(id: string): string {
  return `data/bundles/${id.replace(/^bundle\./, '')}.yaml`;
}

/** A provider's prices that have a source. */
export function providerTargets(provider: SnapshotProvider): PriceTarget[] {
  const file = providerFile(provider.id);
  const targets: PriceTarget[] = [];
  for (const plan of provider.plans) {
    if (retirementOf(plan, provider)) continue;
    const title = planTitle(provider.name, plan.name);
    for (const price of sourced(plan.prices)) {
      targets.push({
        file,
        owner: { kind: 'plan', id: plan.id },
        price,
        label: title,
        names: unique([plan.name, title]),
      });
    }
  }
  for (const addOn of provider.retired === undefined ? (provider.addOns ?? []) : []) {
    for (const price of sourced(addOn.prices)) {
      targets.push({
        file,
        owner: { kind: 'addOn', id: addOn.id },
        price,
        label: `${provider.name} ${addOn.name}`,
        names: [addOn.name],
      });
    }
  }
  for (const listing of provider.resellers ?? []) {
    for (const offer of listing.offers) {
      const plan = provider.plans.find(({ id }) => id === offer.plan);
      const title = plan ? planTitle(provider.name, plan.name) : offer.plan;
      for (const price of sourced(offer.prices)) {
        targets.push({
          file,
          owner: { kind: 'reseller', reseller: listing.reseller, plan: offer.plan },
          price,
          label: `${title} at ${listing.reseller}`,
          names: unique([title, provider.name]),
        });
      }
    }
  }
  return targets;
}

/** A provider's finance accounts' posted rates (M11.14), but a retired plan's, which its page no longer has. */
export function rateTargets(provider: SnapshotProvider): RateTarget[] {
  return provider.plans.flatMap((plan) => {
    const rates = plan.account?.rates;
    if (!rates || retirementOf(plan, provider)) return [];
    const title = planTitle(provider.name, plan.name);
    return [
      {
        file: providerFile(provider.id),
        planId: plan.id,
        label: title,
        names: unique([plan.name, title]),
        rates: {
          tiers: rates.tiers,
          ...(rates.bonus && { bonus: rates.bonus }),
          sourceUrl: rates.sourceUrl,
          lastVerified: rates.lastVerified,
        },
      },
    ];
  });
}

/** "2.25%, 2.50% from 10000": a target's tiers in the pull request. */
export function tiersText(tiers: readonly { from: number; rate: number }[]): string {
  return tiers
    .map((tier) => `${tier.rate.toFixed(2)}%${tier.from === 0 ? '' : ` from ${tier.from}`}`)
    .join(', ');
}

/** A provider's resellers' approvals. */
export function approvalTargets(provider: SnapshotProvider): ApprovalTarget[] {
  return (provider.resellers ?? []).map((listing) => ({
    file: providerFile(provider.id),
    provider: provider.id,
    reseller: listing.reseller,
    url: listing.approvedBy.url,
    quotes: listing.approvedBy.quotes,
  }));
}

/** A provider's accepted card networks, a region at a time (BLUEPRINT §9.3). */
export function networksTargets(provider: SnapshotProvider): NetworksTarget[] {
  return Object.entries(provider.acceptedNetworks ?? {}).map(([region, accepted]) => ({
    file: providerFile(provider.id),
    provider: provider.id,
    region,
    networks: [...accepted.networks],
    url: accepted.url,
    quotes: [...accepted.quotes],
  }));
}

/** A provider's policy pages, each with the quotes its ratings take from it (BLUEPRINT §4.10, M3.9). */
/**
 * The pages a provider's graded ratings quote, and those of the shared documents its step checks (`sets`), each with
 * the file its ratings are in. A status quotes nothing, so there's nothing on a page to look for.
 */
export function policyTargets(
  provider: SnapshotProvider,
  sets: readonly PolicySet[] = [],
): PolicyPageTarget[] {
  const pages = new Map<string, PolicyPageTarget>();
  const add = (file: string, ratings: readonly PolicyRating[]) => {
    for (const rating of ratings) {
      if (!rating.tier) continue;
      for (const source of rating.sources ?? []) {
        const key = `${file} ${source.url}`;
        const page = pages.get(key) ?? {
          file,
          provider: provider.id,
          url: source.url,
          ratings: [],
        };
        const own = page.ratings.find((entry) => entry.topic === rating.topic);
        if (own) own.quotes.push(source.quote);
        else page.ratings.push({ topic: rating.topic, tier: rating.tier, quotes: [source.quote] });
        pages.set(key, page);
      }
    }
  };
  add(providerFile(provider.id), provider.policies?.ratings ?? []);
  for (const set of sets) add(policySetFile(set.id), set.ratings);
  return [...pages.values()];
}

/**
 * Each shared document's step: the first of `namers`, by id, that names it, so its pages are checked once a night. Only
 * `providers`' are kept: the night reads its providers a part at a time (M11.8), and `namers` are all of them.
 */
function policySetOwners(
  providers: readonly SnapshotProvider[],
  sets: readonly PolicySet[],
  policies: PolicyIndex,
  namers: readonly string[],
): Record<string, PolicySet[]> {
  const owned: Record<string, PolicySet[]> = {};
  const here = new Set(providers.map((provider) => provider.id));
  const ids = [...namers].sort();
  for (const set of sets) {
    const owner = ids.find((id) => policies.providers[id]?.shared?.includes(set.id));
    if (owner !== undefined && here.has(owner)) (owned[owner] ??= []).push(set);
  }
  return owned;
}

/** The provider a bundle's pages are checked with: its first plan's (M11.8: the night's slice takes it with them). */
export function bundleOwner(bundle: Pick<Bundle, 'includes'>): string {
  const [plan = ''] = bundle.includes;
  return plan.slice(0, plan.indexOf('.'));
}

export function bundleTargets(bundle: Bundle): PriceTarget[] {
  return sourced(bundle.prices).map((price) => ({
    file: bundleFile(bundle.id),
    owner: { kind: 'bundle', id: bundle.id },
    price,
    label: bundle.name,
    names: [bundle.name],
  }));
}

/** "CA, monthly", "GLOBAL in EUR, every 6 months": which of an owner's prices it is. */
export function priceText(
  price: Pick<Price, 'region' | 'currency' | 'interval' | 'intervalCount'>,
): string {
  const period =
    price.intervalCount === 1
      ? { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' }[price.interval]
      : `every ${price.intervalCount} ${price.interval}s`;
  return `${price.region} in ${price.currency}, ${period}`;
}

function sourced(prices: readonly Price[]): (Price & { sourceUrl: string })[] {
  return prices.filter(
    (price): price is Price & { sourceUrl: string } => price.sourceUrl !== undefined,
  );
}

function unique(names: string[]): string[] {
  return [...new Set(names)];
}

/**
 * The night's index: each provider's and bundle's pages, and every host they and the websites are on. Its policies'
 * pages are `policies`' (M11.8): /data/policies/index.json's, since D1's providers leave their policies out, or by
 * default those the providers hold. A shared document is checked with the first of `namers` naming it: the night's
 * providers, when it reads them a part at a time.
 */
export function catalogIndex(
  providers: readonly SnapshotProvider[],
  bundles: readonly Bundle[],
  sets: readonly PolicySet[] = [],
  policies: PolicyIndex = buildPolicyIndex(policyFiles({ providers, policySets: sets })),
  namers: readonly string[] = providers.map((provider) => provider.id),
): CatalogIndex {
  const hosts = new Set<string>(iconServiceHosts);
  const pagesOf = (urls: readonly string[]) => {
    for (const url of urls) {
      const host = URL.parse(url)?.host;
      if (host) hosts.add(host);
    }
    return [...new Set(urls)];
  };
  const index: CatalogIndex = {
    providers: {},
    bundles: {},
    hosts: [],
    cited: citedPages(providers as readonly Provider[], bundles, policies),
    policySets: policySetOwners(providers, sets, policies, namers),
    bundleOwners: Object.fromEntries(bundles.map((bundle) => [bundle.id, bundleOwner(bundle)])),
  };
  for (const provider of providers) {
    pagesOf([provider.website]);
    index.providers[provider.id] = pagesOf([
      ...providerTargets(provider).map((target) => target.price.sourceUrl),
      ...approvalTargets(provider).map((approval) => approval.url),
      ...networksTargets(provider).map((target) => target.url),
      // The pages its policies cite, and those of the shared documents its step checks.
      ...(policies.providers[provider.id]?.links ?? []),
      ...(index.policySets[provider.id] ?? []).flatMap((set) => set.links.map((link) => link.url)),
    ]);
  }
  for (const bundle of bundles) {
    index.bundles[bundle.id] = pagesOf(
      bundleTargets(bundle).map((target) => target.price.sourceUrl),
    );
  }
  index.hosts = [...hosts].sort();
  return index;
}

/** The icon services the logo search asks (core's iconServices). */
const iconServiceHosts = ['www.google.com', 'icons.duckduckgo.com'];

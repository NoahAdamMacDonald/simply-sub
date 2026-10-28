import { planTitle, type Bundle, type Price, type SnapshotProvider } from '@simply-sub/core';
import type { CatalogIndex } from './run';
import type { ApprovalTarget, PriceTarget } from './types';

// What the check looks at for each provider and bundle (BLUEPRINT §6.4): every price with a sourceUrl (its plans', its
// add-ons', its resellers' offers'), and every reseller's approval. A price without one was read from a page that
// can't be fetched (a checkout), so a person checks it.

export function providerFile(id: string): string {
  return `data/providers/${id}.yaml`;
}

export function bundleFile(id: string): string {
  return `data/bundles/${id.replace(/^bundle\./, '')}.yaml`;
}

/** A provider's prices that have a source. */
export function providerTargets(provider: SnapshotProvider): PriceTarget[] {
  const file = providerFile(provider.id);
  const targets: PriceTarget[] = [];
  for (const plan of provider.plans) {
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
  for (const addOn of provider.addOns ?? []) {
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

/** The night's index: each provider's and bundle's pages, and every host they and the websites are on. */
export function catalogIndex(
  providers: readonly SnapshotProvider[],
  bundles: readonly Bundle[],
): CatalogIndex {
  const hosts = new Set<string>(iconServiceHosts);
  const pagesOf = (urls: readonly string[]) => {
    for (const url of urls) {
      const host = URL.parse(url)?.host;
      if (host) hosts.add(host);
    }
    return [...new Set(urls)];
  };
  const index: CatalogIndex = { providers: {}, bundles: {}, hosts: [] };
  for (const provider of providers) {
    pagesOf([provider.website]);
    index.providers[provider.id] = pagesOf([
      ...providerTargets(provider).map((target) => target.price.sourceUrl),
      ...approvalTargets(provider).map((approval) => approval.url),
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

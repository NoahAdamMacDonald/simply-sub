import type { IsoDate } from '../dates/iso-date';
import { rankKeyOptions } from '../ranking/rank-keys';
import type { Bundle } from './bundle';
import { didYouMean } from './checks';
import type { Provider } from './provider';
import { idSpace, type Redirect } from './redirects';
import { isRetired, retirementOf } from './retired';
import type { Report } from './validate-catalog';
import type { FeatureRegistry } from './validate-features';

// The checks of data/redirects.yaml that need the rest of the catalog (BLUEPRINT §4.3, §6.2, M10.27): every target
// exists and is still sold, no entry points at another's old id (so redirects never chain or loop), and an old id still
// in the catalog is a retired plan or provider whose subscribers move on the entry's date.

export interface RedirectChecks {
  providers: readonly Provider[];
  bundles: readonly Bundle[];
  /** Undefined when data/features.yaml couldn't be read: feature entries are then left unchecked. */
  registry: FeatureRegistry | undefined;
  /** Providers whose file is broken: entries naming them or their plans are left unchecked. */
  unchecked: ReadonlySet<string>;
  today: IsoDate;
}

export function checkRedirects(
  redirects: readonly Redirect[],
  { providers, bundles, registry, unchecked, today }: RedirectChecks,
  report: Report,
): void {
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const plans = new Map(
    providers.flatMap((provider) => provider.plans.map((plan) => [plan.id, { provider, plan }])),
  );
  const addOnIds = providers.flatMap((provider) => (provider.addOns ?? []).map(({ id }) => id));
  const bundleIds = bundles.map(({ id }) => id);
  const rankKeys =
    registry &&
    new Set([...registry.features.values()].flatMap(rankKeyOptions).map((option) => option.key));
  const froms = new Set(redirects.map(({ kind, from }) => `${idSpace(kind)} ${from}`));
  const skipped = (id: string) =>
    unchecked.has(id.startsWith('perk:') ? id.slice(5, id.indexOf('/')) : id.split('.')[0]);

  redirects.forEach((redirect, index) => {
    const { kind, from, to } = redirect;
    if (froms.has(`${idSpace(kind)} ${to}`)) {
      report(
        [index, 'to'],
        `"${to}" is redirected itself: point this entry where that one points, so redirects never chain`,
      );
    } else if (!skipped(to)) {
      const problem = targetProblem(kind, to);
      if (problem) report([index, 'to'], problem);
    }
    if (!skipped(from)) {
      const problem = sourceProblem(kind, from);
      if (problem) report([index, 'from'], problem);
    }
  });

  /** Why `to` can't be a target: it doesn't exist, or isn't sold any more. */
  function targetProblem(kind: Redirect['kind'], to: string): string | undefined {
    switch (kind) {
      case 'provider': {
        const provider = providerById.get(to);
        if (!provider) return `"${to}" isn't a provider${didYouMean(to, [...providerById.keys()])}`;
        return provider.retired !== undefined && provider.retired <= today
          ? `"${to}" is retired: point it at a provider still sold`
          : undefined;
      }
      case 'plan': {
        const found = plans.get(to);
        if (!found) return `"${to}" isn't a plan${didYouMean(to, [...plans.keys()])}`;
        return isRetired(found.plan, found.provider, today)
          ? `"${to}" is retired: point it at a plan still sold`
          : undefined;
      }
      case 'add-on':
        return addOnIds.includes(to)
          ? undefined
          : `"${to}" isn't an add-on${didYouMean(to, addOnIds)}`;
      case 'bundle':
        return bundleIds.includes(to)
          ? undefined
          : `"${to}" isn't a bundle${didYouMean(to, bundleIds)}`;
      case 'perk':
        // Perks get ids with M11.6; until then a perk's target is checked for its provider only.
        if (to.startsWith('perk:')) {
          const provider = to.slice(5, to.indexOf('/'));
          return providerById.has(provider) ? undefined : `"${provider}" isn't a provider`;
        }
        return rankKeyProblem(to);
      case 'feature':
        return rankKeyProblem(to);
    }
  }

  function rankKeyProblem(key: string): string | undefined {
    return !rankKeys || rankKeys.has(key)
      ? undefined
      : `"${key}" isn't a rank key of data/features.yaml${didYouMean(key, [...rankKeys])}`;
  }

  /** Why `from` can't be redirected: it's still in the catalog, and isn't a retired plan or provider that moves. */
  function sourceProblem(kind: Redirect['kind'], from: string): string | undefined {
    const still =
      `"${from}" is still in the catalog: a redirect is for an id that's gone, or a retired plan's subscribers ` +
      'moving (retire it first)';
    switch (kind) {
      case 'provider': {
        const provider = providerById.get(from);
        if (!provider) return undefined;
        if (provider.retired === undefined) return still;
        return provider.endsOn === undefined
          ? undefined
          : "A provider whose subscribers move doesn't end: leave out its endsOn";
      }
      case 'plan': {
        const found = plans.get(from);
        if (!found) return undefined;
        const retirement = retirementOf(found.plan, found.provider);
        if (!retirement) return still;
        return retirement.endsOn === undefined
          ? undefined
          : "A plan whose subscribers move doesn't end: leave out its endsOn";
      }
      case 'add-on':
        return addOnIds.includes(from) ? still : undefined;
      case 'bundle':
        return bundleIds.includes(from) ? still : undefined;
      case 'feature':
        return rankKeys?.has(from)
          ? `"${from}" is still a rank key of data/features.yaml: a redirect is for a key that's gone`
          : undefined;
      case 'perk':
        return undefined;
    }
  }
}

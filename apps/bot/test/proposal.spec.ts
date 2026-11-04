import { describe, expect, it } from 'vitest';
import { proposal } from '../src/proposal';
import { mergeIndexes, stepPlan } from '../src/run';
import {
  buildPolicyIndex,
  policyFiles,
  type PolicySet,
  type SnapshotProvider,
} from '@simply-sub/core';
import { catalogIndex, policyTargets, providerTargets } from '../src/targets';
import type { Finding } from '../src/types';
import { files, mullvad, netflix, today } from './fakes';

describe('stepPlan', () => {
  it('checks a bundle in the step of the provider whose page it cites, and groups the rest by page', () => {
    const plan = stepPlan({
      providers: { crave: ['https://crave.ca/subscribe'], tsn: ['https://tsn.ca/subscribe'] },
      bundles: {
        'bundle.a': ['https://crave.ca/subscribe'],
        'bundle.b': ['https://help.example.com/price'],
        'bundle.c': ['https://help.example.com/price'],
        'bundle.d': ['https://tsn.ca/subscribe', 'https://crave.ca/subscribe'],
      },
      hosts: [],
      cited: [],
      policySets: {},
      bundleOwners: {},
    });
    expect(plan.withProvider).toEqual({ crave: ['bundle.a'], tsn: [] });
    expect(plan.groups).toEqual([['bundle.b', 'bundle.c'], ['bundle.d']]);
  });

  it('merges the parts a night reads into the index of them all, a page cited by several once (M11.8)', () => {
    const merged = mergeIndexes([catalogIndex([netflix], []), catalogIndex([mullvad], [])]);
    const whole = catalogIndex([netflix, mullvad], []);
    const byUrl = (pages: typeof whole.cited) =>
      [...pages]
        .sort((a, b) => (a.url < b.url ? -1 : 1))
        .map((page) => ({
          ...page,
          owners: [...page.owners].sort(),
        }));
    expect({ ...merged, cited: byUrl(merged.cited) }).toEqual({
      ...whole,
      cited: byUrl(whole.cited),
    });
  });

  it('indexes every page once, with every host', () => {
    const index = catalogIndex([netflix, mullvad], []);
    expect(index.providers['netflix']).toEqual([
      'https://help.netflix.com/en/node/24926/ca',
      'https://help.netflix.com/en/node/24926/us',
      'https://help.netflix.com/en/node/24926/gb',
      'https://help.netflix.com/en/node/24926/au',
      'https://help.netflix.com/en/node/24926/de',
      'https://help.netflix.com/en/node/24926/fr',
      'https://help.netflix.com/en/node/24926/es',
      'https://help.netflix.com/en/node/24926/it',
      'https://help.netflix.com/en/node/24926/nz',
      'https://help.netflix.com/en/node/24926/ie',
      'https://help.netflix.com/en/node/24926/nl',
      // Its accepted cards in each country (M9.2; all eleven since the owner's tasks, 2026-11-03).
      'https://help.netflix.com/en/node/116380/ca',
      'https://help.netflix.com/en/node/116380/us',
      'https://help.netflix.com/en/node/116380/gb',
      'https://help.netflix.com/en/node/116380/au',
      'https://help.netflix.com/en/node/116380/nz',
      'https://help.netflix.com/en/node/116380/ie',
      'https://help.netflix.com/en/node/116380/de',
      'https://help.netflix.com/en/node/116380/fr',
      'https://help.netflix.com/en/node/116380/nl',
      'https://help.netflix.com/en/node/116380/es',
      'https://help.netflix.com/en/node/116380/it',
      // The pages its policies cite (M3.9), in its links' order (M11.8).
      'https://help.netflix.com/legal/termsofuse',
      'https://help.netflix.com/legal/privacy',
      'https://help.netflix.com/en/node/123277',
      'https://help.netflix.com/en/node/54816',
      'https://hackerone.com/netflix',
      // Its cancel page, which its Cancelling rating quotes since M11.9.
      'https://help.netflix.com/en/node/407',
      // Its games' community guidelines, which its terms include (every agreement a user accepts, 2026-11-03).
      'https://help.netflix.com/legal/gamescommunityguidelines',
    ]);
    expect(index.hosts).toContain('www.amazon.ca');
    expect(index.hosts).toContain('icons.duckduckgo.com');
  });

  it('checks a shared policy document once, in the step of the first provider naming it (M11.1)', () => {
    const privacy = 'https://privacy.example.com/policy';
    const set: PolicySet = {
      id: 'example-privacy',
      name: 'Example Group’s privacy policy',
      links: [{ name: 'Privacy policy', url: privacy }],
      ratings: [
        {
          topic: 'privacy.data-sharing',
          tier: 'neutral',
          reason: 'It shares data for ads unless you say no.',
          sources: [{ url: privacy, quote: 'We share identifiers with advertisers' }],
          lastVerified: '2026-10-27',
        },
      ],
    };
    const naming = (provider: SnapshotProvider): SnapshotProvider => ({
      ...provider,
      policies: { ...provider.policies, shared: [set.id] },
    });
    const index = catalogIndex([naming(netflix), naming(mullvad)], [], [set]);
    expect(index.policySets).toEqual({ mullvad: [set] });
    expect(index.providers['mullvad']).toContain(privacy);
    expect(index.providers['netflix']).not.toContain(privacy);
    expect(index.cited.find((page) => page.url === privacy)?.owners).toEqual([
      'netflix',
      'mullvad',
    ]);
    // A night reads its providers a part at a time (M11.8): the document is still checked once, with the first of
    // all the night's providers naming it, whichever part that is.
    const policies = buildPolicyIndex(
      policyFiles({ providers: [naming(netflix), naming(mullvad)], policySets: [set] }),
    );
    const parts = [netflix, mullvad].map((provider) =>
      catalogIndex([naming(provider)], [], [set], policies, ['mullvad', 'netflix']),
    );
    expect(parts.map((part) => part.policySets)).toEqual([{}, { mullvad: [set] }]);
    expect(mergeIndexes(parts).providers['netflix']).not.toContain(privacy);
    expect(policyTargets(naming(mullvad), [set]).at(-1)).toEqual({
      file: 'data/policies/example-privacy.yaml',
      provider: 'mullvad',
      url: privacy,
      ratings: [
        {
          topic: 'privacy.data-sharing',
          tier: 'neutral',
          quotes: ['We share identifiers with advertisers'],
        },
      ],
    });
  });
});

describe('proposal', () => {
  it('lists what needs checking once a page, however many of its prices failed', () => {
    const targets = providerTargets(netflix).filter((target) => target.price.region === 'US');
    const findings: Finding[] = targets.map((target) => ({
      kind: 'manual',
      subject: target.label,
      url: target.price.sourceUrl,
      reason: 'The page answered 403',
    }));
    const made = proposal(findings, new Map(Object.entries(files)), today);
    expect(made.changes).toEqual([]);
    expect(made.body).toContain(
      '- **5 of them** (Netflix Standard with ads; Netflix Standard; Netflix Premium; Netflix Extra member (with ads); and 1 more): The page answered 403 [help.netflix.com/en/node/24926/us]',
    );
  });
});

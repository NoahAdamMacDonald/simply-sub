import { describe, expect, it } from 'vitest';
import { proposal } from '../src/proposal';
import { stepPlan } from '../src/run';
import type { PolicySet, SnapshotProvider } from '@simply-sub/core';
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
    });
    expect(plan.withProvider).toEqual({ crave: ['bundle.a'], tsn: [] });
    expect(plan.groups).toEqual([['bundle.b', 'bundle.c'], ['bundle.d']]);
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
      // Its accepted cards in each country (M9.2).
      'https://help.netflix.com/en/node/116380/ca',
      'https://help.netflix.com/en/node/116380/us',
      // The pages its policies cite (M3.9), in its links' order (M11.8).
      'https://help.netflix.com/legal/termsofuse',
      'https://help.netflix.com/legal/privacy',
      'https://help.netflix.com/en/node/123277',
      'https://help.netflix.com/en/node/54816',
      'https://hackerone.com/netflix',
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

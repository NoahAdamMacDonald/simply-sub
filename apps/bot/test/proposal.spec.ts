import { describe, expect, it } from 'vitest';
import { proposal } from '../src/proposal';
import { stepPlan } from '../src/run';
import { catalogIndex, providerTargets } from '../src/targets';
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
    });
    expect(plan.withProvider).toEqual({ crave: ['bundle.a'], tsn: [] });
    expect(plan.groups).toEqual([['bundle.b', 'bundle.c'], ['bundle.d']]);
  });

  it('indexes every page once, with every host', () => {
    const index = catalogIndex([netflix, mullvad], []);
    expect(index.providers['netflix']).toEqual([
      'https://help.netflix.com/en/node/24926/ca',
      'https://help.netflix.com/en/node/24926/us',
      'https://help.netflix.com/en/node/24926/au',
      'https://help.netflix.com/en/node/24926/nz',
      // Its accepted cards in each country (M9.2).
      'https://help.netflix.com/en/node/116380/ca',
      'https://help.netflix.com/en/node/116380/us',
      // The pages its policy ratings quote (M3.9).
      'https://help.netflix.com/legal/privacy',
      'https://help.netflix.com/legal/termsofuse',
      'https://help.netflix.com/en/node/123277',
      'https://help.netflix.com/en/node/54816',
    ]);
    expect(index.hosts).toContain('www.amazon.ca');
    expect(index.hosts).toContain('icons.duckduckgo.com');
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

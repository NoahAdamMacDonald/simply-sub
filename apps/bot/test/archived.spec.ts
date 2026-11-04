import type { Baseline } from '@simply-sub/core';
import { describe, expect, it } from 'vitest';
import { checkPages, type CheckInput } from '../src/check-pages';
import { providerTargets } from '../src/targets';
import type { PolicyPageTarget, PriceTarget } from '../src/types';
import { fakeDeps, netflix, storedWorld, type Calls } from './fakes';

// Sites that turn bots away (M11.15): their pages come from the Internet Archive's newest copy, never from the site.

const budget = { browserPages: 5, neurons: 8_000 };
const pricing = 'https://chatgpt.com/pricing/';
const terms = 'https://openai.com/policies/row-terms-of-use/';
const archived = ['chatgpt.com', 'openai.com'];
const today = '2026-11-04';

/** A price on the archived pricing page. */
const target: PriceTarget = (() => {
  const found = providerTargets(netflix).find(
    (candidate) => candidate.owner.kind === 'plan' && candidate.price.region === 'CA',
  ) as PriceTarget;
  return { ...found, price: { ...found.price, sourceUrl: pricing } };
})();

const baseline = (lines: string[], changes: Partial<Baseline> = {}): Baseline => ({
  url: pricing,
  method: 'archive',
  saved: '2026-11-01',
  lines,
  ...changes,
});

async function check(
  input: Partial<CheckInput>,
  copies: Record<string, string> = {},
  calls: Calls = { pages: [], browser: [], ai: [], archived: [] },
) {
  const world = { ...storedWorld(), archived: copies };
  const { findings } = await checkPages(
    { subject: 'chatgpt', targets: [], approvals: [], networks: [], archived, today, ...input },
    fakeDeps(world, calls),
    budget,
  );
  return { findings, calls };
}

describe('pages on a site that turns bots away', () => {
  it('are read from the archive’s copy only, their prices neither confirmed nor guessed', async () => {
    const { findings, calls } = await check(
      { targets: [target], baselines: { [pricing]: baseline(['Pricing', 'Plus']) } },
      { [pricing]: '<h1>Pricing</h1><p>Plus</p>' },
    );
    expect(findings).toEqual([]);
    expect(calls.archived).toEqual([pricing]);
    expect(calls.pages).toEqual([]);
    expect(calls.browser).toEqual([]);
    expect(calls.ai).toEqual([]);
  });

  it('become a page finding when the copy’s text changed, for the weekly review', async () => {
    const { findings } = await check(
      { targets: [target], baselines: { [pricing]: baseline(['Pricing', 'Plus']) } },
      { [pricing]: '<h1>Pricing</h1><p>Plus and Pro</p><div>Updated: 3 hours ago</div>' },
    );
    expect(findings).toEqual([
      expect.objectContaining({
        kind: 'page',
        url: pricing,
        method: 'archive',
        added: ['Plus and Pro'],
        removed: ['Plus'],
        had: true,
      }),
    ]);
  });

  it('go to a person when read only from the archive for over 90 days', async () => {
    const old = baseline(['Pricing', 'Plus'], { saved: '2026-08-05' });
    const { findings } = await check(
      { targets: [target], baselines: { [pricing]: old } },
      { [pricing]: '<h1>Pricing</h1><p>Plus</p>' },
    );
    expect(findings).toEqual([
      expect.objectContaining({
        kind: 'manual',
        url: pricing,
        reason: expect.stringContaining('since 2026-08-05') as string,
      }),
    ]);
    // 90 days exactly is still within the limit.
    const recent = baseline(['Pricing', 'Plus'], { saved: '2026-08-06' });
    const within = await check(
      { targets: [target], baselines: { [pricing]: recent } },
      { [pricing]: '<h1>Pricing</h1><p>Plus</p>' },
    );
    expect(within.findings).toEqual([]);
  });

  it('are nothing to tell a person on a night the archive has no copy', async () => {
    const { findings } = await check({
      targets: [target],
      baselines: { [pricing]: baseline(['Pricing']) },
    });
    expect(findings).toEqual([]);
  });

  it('are compared with a baseline read another way, and changed ones get the archive’s', async () => {
    const browser = baseline(['Pricing'], { method: 'browser' });
    const same = await check(
      { targets: [target], baselines: { [pricing]: browser } },
      { [pricing]: '<h1>Pricing</h1>' },
    );
    expect(same.findings).toEqual([]);
    const changed = await check(
      { targets: [target], baselines: { [pricing]: browser } },
      { [pricing]: '<h1>Pricing</h1><p>Go</p>' },
    );
    expect(changed.findings).toEqual([
      expect.objectContaining({ kind: 'page', method: 'archive', added: ['Go'], removed: [] }),
    ]);
  });

  it('have their policy quotes looked for in the copy', async () => {
    const policy: PolicyPageTarget = {
      file: 'data/providers/chatgpt.yaml',
      provider: 'chatgpt',
      url: terms,
      ratings: [
        {
          topic: 'legal.disputes',
          tier: 'poor',
          quotes: ['Class arbitrations, class actions, and representative actions are prohibited.'],
        },
      ],
    };
    const { findings } = await check(
      { policyPages: [policy], baselines: { [terms]: null } },
      { [terms]: '<h1>Terms of Use</h1><p>Disputes go to your local courts.</p>' },
    );
    expect(findings.map((finding) => finding.kind).sort()).toEqual(['page', 'policy']);
    expect(findings.find((finding) => finding.kind === 'policy')).toMatchObject({
      missing: [{ topic: 'legal.disputes' }],
    });
  });

  it('never have the site asked for its icon', async () => {
    const { findings, calls } = await check({
      logo: { id: 'chatgpt', website: 'https://chatgpt.com', committed: 'abc' },
    });
    expect(findings).toEqual([]);
    expect(calls.pages).toEqual([]);
  });
});

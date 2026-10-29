import {
  baselineLines,
  baselinePath,
  pageText,
  providerSchema,
  type Automation,
  type Baseline,
} from '@simply-sub/core';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { digestBranch, reviewFile } from '../src/digest';
import { runNight } from '../src/run';
import { memoryState } from '../src/state';
import { catalogIndex } from '../src/targets';
import {
  fakeServices,
  mullvad,
  netflix,
  png,
  settings,
  stepper,
  storedWorld,
  today,
  type World,
} from './fakes';
import mullvadNoInet from './fixtures/mullvad-resellers-no-inet.html?raw';
import mullvadTaxGone from './fixtures/mullvad-pricing-tax-gone.html?raw';
import netflixChanged from './fixtures/netflix-ca-changed.html?raw';

// A night of the bot, end to end with fakes (M3.9, and M8.3's "done when" through the weekly digest): each due page is
// compared with its baseline; one that's unchanged needs no model, one that changed waits in KV, and on the digest's
// day one pull request proposes the week's clear changes, each changed page's new baseline and a review list.

/** The stored world with every page the catalog cites, each the same as its baseline. */
function quietWorld(): World {
  const world = storedWorld();
  for (const page of catalogIndex([netflix, mullvad], []).cited) {
    world.pages[page.url] ??= `<p>${page.url} as it was read.</p>`;
  }
  return world;
}

/** Each page's baseline: its text in `world`. */
function baselinesOf(world: World): Record<string, Baseline> {
  return Object.fromEntries(
    Object.entries(world.pages).map(([url, html]) => [
      url,
      { url, method: 'fetch' as const, saved: '2026-10-28', lines: baselineLines(pageText(html)) },
    ]),
  );
}

async function night(
  world: World,
  options: {
    baselines?: Record<string, Baseline>;
    settings?: Automation;
    state?: ReturnType<typeof memoryState>;
    date?: string;
  } = {},
) {
  const services = await fakeServices(world, undefined, {
    baselines: options.baselines ?? baselinesOf(quietWorld()),
    ...(options.settings && { settings: options.settings }),
    ...(options.state && { state: options.state }),
  });
  const steps: string[] = [];
  const ai: unknown[] = [];
  const pages = services.pages.bind(services);
  services.pages = (robots) => {
    const deps = pages(robots);
    const extract = deps.extract;
    return { ...deps, extract: async (request) => (ai.push(request), extract(request)) };
  };
  const summary = await runNight(options.date ?? today, stepper(steps), services);
  return { summary, steps, proposals: services.proposals, ai, state: services.state };
}

/** A night with nothing new: the same world, its own baselines, and no AI. */
describe('a quiet night', () => {
  it('reads the settings and checks each provider, with no model and no pull request', async () => {
    const { summary, steps, proposals, ai } = await night(quietWorld());
    expect(steps).toEqual([
      'read the repository',
      'read the settings',
      'read the check dates',
      'read the catalog',
      'read robots.txt 1',
      'check mullvad',
      'check netflix',
      'read the last digest',
      'build the digest',
      'save the check dates',
    ]);
    expect(ai).toEqual([]);
    expect(proposals).toEqual([]);
    expect(summary.pullRequest).toBeUndefined();
  });

  it('checks nothing whose cadence is off, and nothing checked since its cadence began', async () => {
    const off = settings({
      cadence: { pricing: 'off', policies: 'off', logos: 'off', discovery: 'off' },
    });
    const { steps } = await night(quietWorld(), { settings: off });
    expect(steps).not.toContain('read robots.txt 2');
    const state = memoryState();
    await night(quietWorld(), { state });
    const checks = await state.checks();
    expect(checks['https://help.netflix.com/en/node/24926/ca']).toBe(today);
    expect(checks['https://help.netflix.com/legal/termsofuse']).toBe(today);
  });
});

describe('the weekly digest', () => {
  it('proposes a changed price, with its quote checked, the page’s new baseline and an empty review list', async () => {
    const world = quietWorld();
    world.pages['https://help.netflix.com/en/node/24926/ca'] = netflixChanged;
    world.ai = (request) => ({
      response: {
        prices: request.messages[1].content.includes('1. Netflix Standard:')
          ? [
              {
                plan: 1,
                found: true,
                regularAmount: 19.99,
                currency: 'CAD',
                onlySalePrice: false,
                quote: 'Standard: $19.99 / month',
              },
            ]
          : [],
      },
    });
    const { summary, proposals } = await night(world);
    expect(summary.pullRequest).toBe('https://github.com/NoahAdamMacDonald/simply-sub/pull/1');
    const [made] = proposals;
    expect(made.branch).toBe(digestBranch);
    expect(made.title).toBe(`Catalog digest ${today}`);
    const paths = made.changes.map((change) => change.path);
    expect(paths).toContain('data/providers/netflix.yaml');
    expect(paths).toContain(baselinePath('https://help.netflix.com/en/node/24926/ca'));
    expect(paths).toContain(reviewFile);
    const file =
      made.changes.find((change) => change.path === 'data/providers/netflix.yaml')?.text ?? '';
    const provider = providerSchema.parse(parse(file));
    expect(provider.plans.find((plan) => plan.id === 'netflix.standard')?.prices[0].amount).toBe(
      19.99,
    );
    expect(made.body).toContain(
      '| Netflix Standard, CA in CAD, monthly | 18.99 CAD | 19.99 CAD (+5.3%) |',
    );
    expect(made.changes.find((change) => change.path === reviewFile)?.text).toContain(
      'Nothing to review this week.',
    );
  });

  it('sends a price whose quote isn’t on the page to the review list, never taking it', async () => {
    const world = quietWorld();
    world.pages['https://help.netflix.com/en/node/24926/ca'] = netflixChanged;
    world.ai = (request) => ({
      response: {
        prices: request.messages[1].content.includes('1. Netflix Standard:')
          ? [
              {
                plan: 1,
                found: true,
                regularAmount: 21.99,
                currency: 'CAD',
                onlySalePrice: false,
                quote: 'Standard: $21.99 / month',
              },
            ]
          : [],
      },
    });
    const [made] = (await night(world)).proposals;
    const review = made.changes.find((change) => change.path === reviewFile)?.text ?? '';
    expect(review).toContain('Workers AI’s quote for its price isn’t on the page word for word');
    expect(review).toContain(`\`${baselinePath('https://help.netflix.com/en/node/24926/ca')}\``);
    const file = made.changes.find((change) => change.path === 'data/providers/netflix.yaml');
    expect(file).toBeUndefined();
  });

  it('keeps what a night found until the digest’s day, then proposes it', async () => {
    const world = quietWorld();
    world.pages['https://mullvad.net/en/pricing'] = mullvadTaxGone;
    const state = memoryState();
    const notToday = settings({ digest: { day: 'monday' } });
    const first = await night(world, { state, settings: notToday });
    expect(first.proposals).toEqual([]);
    expect((await state.pending()).map((entry) => entry.key)).toEqual([
      'https://mullvad.net/en/pricing',
    ]);
    // The digest's day: the pricing page isn't due again, and what it found is still proposed.
    const second = await night(quietWorld(), {
      state,
      date: '2026-11-02',
      settings: settings({
        digest: { day: 'monday' },
        cadence: { ...notToday.cadence, pricing: 'weekly' },
      }),
    });
    const [made] = second.proposals;
    const review = made.changes.find((change) => change.path === reviewFile)?.text ?? '';
    expect(review).toContain('its "tax included" words are gone from');
    const file =
      made.changes.find((change) => change.path === 'data/providers/mullvad.yaml')?.text ?? '';
    // The plan's prices lose their taxIncluded; resellers' prices cite other pages and keep theirs.
    expect(
      providerSchema.parse(parse(file)).plans[0].prices.some((price) => price.taxIncluded),
    ).toBe(false);
  });

  it('drops a pending page once main’s baseline has its new text (the digest merged)', async () => {
    const world = quietWorld();
    world.pages['https://mullvad.net/en/help/partnerships-and-resellers'] = mullvadNoInet;
    const state = memoryState();
    await night(world, { state, settings: settings({ digest: { day: 'monday' } }) });
    expect(await state.pending()).toHaveLength(1);
    // Main now has the page's new text as its baseline, and the reseller's listing gone.
    const merged = baselinesOf(world);
    const later = await night(world, {
      state,
      baselines: merged,
      date: '2026-10-30',
      settings: settings({ digest: { day: 'monday' } }),
    });
    expect(later.ai).toEqual([]);
    expect(await state.pending()).toEqual([]);
  });

  it('lists a changed policy page for review, with the quotes it lost', async () => {
    const world = quietWorld();
    world.pages['https://help.netflix.com/legal/termsofuse'] =
      '<p>Our terms have changed completely.</p>';
    const [made] = (await night(world)).proposals;
    const review = made.changes.find((change) => change.path === reviewFile)?.text ?? '';
    expect(review).toMatch(
      /## Policies\n\n- \[ \] \*\*netflix's \[help\.netflix\.com\/legal\/termsofuse\]/,
    );
    expect(review).toContain('added: “Our terms have changed completely.”');
  });

  it('gives a page without a baseline its first one, with nothing to review', async () => {
    const world = quietWorld();
    const baselines = baselinesOf(world);
    delete baselines['https://help.netflix.com/en/node/116380/ca'];
    const [made] = (await night(world, { baselines })).proposals;
    expect(made.changes.map((change) => change.path)).toEqual([
      baselinePath('https://help.netflix.com/en/node/116380/ca'),
      reviewFile,
    ]);
    expect(made.body).toContain('### Pages that changed with nothing to review');
  });

  it('proposes a changed logo (a rebrand)', async () => {
    const world = quietWorld();
    world.icons['https://www.netflix.com/icon-180.png'] = png(180, 7);
    const [made] = (await night(world)).proposals;
    expect(made.changes.map((change) => change.path)).toContain('data/logos/netflix.png');
    expect(made.body).toContain(
      '**netflix**: a new 180×180 icon from [www.netflix.com/icon-180.png]',
    );
  });

  it('goes on when a provider’s step fails, saying so in the review list', async () => {
    const world = quietWorld();
    const services = await fakeServices(world, undefined, { baselines: baselinesOf(world) });
    const read = services.readProvider;
    services.readProvider = async (id) => {
      if (id === 'mullvad') throw new Error('D1 is unavailable');
      return read(id);
    };
    await runNight(today, stepper([]), services);
    const review =
      services.proposals[0].changes.find((change) => change.path === reviewFile)?.text ?? '';
    expect(review).toContain('**mullvad**: The check failed: D1 is unavailable');
  });
});

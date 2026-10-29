import {
  baselinePath,
  batchIdsIn,
  providerSchema,
  queueFileSchema,
  type Automation,
} from '@simply-sub/core';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { runNight } from '../src/run';
import { memoryState } from '../src/state';
import { fakeServices, png, settings, stepper, today, type World } from './fakes';

// The discovery in the bot (M3.11), end to end with fakes: a queued service's pages found on its own site, read,
// extracted by Workers AI part by part and drafted with every quote checked, over as many nights as the budgets take,
// then one batch pull request with its file, logo, baselines and the queue's new status.

const site = 'https://www.streamco.example';
const filler = (sentence: string, times: number) => ` ${sentence}`.repeat(times);

const queue = `- id: streamco
  name: StreamCo
  website: ${site}
  category: streaming
  source: manual
  status: queued
- id: lockedco
  name: LockedCo
  website: https://www.lockedco.example
  category: streaming
  source: manual
  status: queued
`;

/** StreamCo's site: a home page linking its plans and policies, and LockedCo's, which can't be read. */
function streamWorld(): World {
  const home = `<html><head><link rel="apple-touch-icon" href="/icon-180.png"></head><body><nav><a href="/plans">Plans</a></nav><footer><a href="/terms">Terms of Use</a> <a href="/privacy">Privacy</a></footer></body></html>`;
  return {
    pages: {
      [site]: home,
      [`${site}/`]: home,
      [`${site}/plans`]: `<h1>Choose your plan</h1><p>Standard: $18.99 / month.</p><p>Premium: $23.99 / month. Premium streams in 4K (Ultra HD) with no ads.</p><p>We accept Visa, Mastercard and American Express.</p><p>${filler('Every plan lets you watch on your phone, tablet and TV.', 8)}</p>`,
      [`${site}/cancel`]: `<h1>How to cancel your membership</h1><p>To cancel, open Account and choose Cancel membership. You can cancel anytime.${filler('Your plan stays until the end of the period.', 8)}</p>`,
      [`${site}/terms`]: `<h1>Terms of Use</h1><p>These terms govern your StreamCo membership. You can cancel anytime; you’ll keep access until the end of your billing period. We don’t give refunds for partial months.${filler('You agree to these terms.', 90)}</p>`,
      [`${site}/privacy`]: `<h1>Privacy policy</h1><p>This policy says how we use your personal information.${filler('We use your data to run the service.', 45)}</p>`,
    },
    icons: { [`${site}/icon-180.png`]: png(180) },
    queue,
    // Workers AI: the plans from the pricing part, the policies from the policies part, quoting the pages.
    extract: (_system, user) => ({
      response: user.includes('Standard: $18.99 / month')
        ? {
            plans: [
              {
                name: 'Standard',
                prices: [
                  {
                    region: 'CA',
                    currency: 'CAD',
                    amount: 18.99,
                    interval: 'month',
                    page: 'pricing',
                    quote: 'Standard: $18.99 / month',
                  },
                ],
              },
              {
                name: 'Premium',
                prices: [
                  {
                    region: 'CA',
                    currency: 'CAD',
                    amount: 23.99,
                    interval: 'month',
                    page: 'pricing',
                    quote: 'Premium: $23.99 / month',
                  },
                ],
              },
            ],
          }
        : {
            policies: [
              {
                topic: 'billing.cancel-refunds',
                tier: 'neutral',
                reason:
                  'You can cancel anytime and keep watching until the period ends, but get no money back.',
                sources: [
                  {
                    page: 'terms',
                    quote: 'you’ll keep access until the end of your billing period',
                  },
                ],
              },
            ],
          },
    }),
  };
}

const discoveryOn = (changes: Partial<Automation> = {}) =>
  settings({ ...changes, cadence: { ...settings().cadence, discovery: 'weekly' } });

async function night(
  world: World,
  options: { settings?: Automation; state?: ReturnType<typeof memoryState>; date?: string } = {},
) {
  const state = options.state ?? memoryState();
  const services = await fakeServices(world, [], {
    settings: options.settings ?? discoveryOn(),
    state,
  });
  const steps: string[] = [];
  const summary = await runNight(options.date ?? today, stepper(steps), services);
  return { summary, steps, proposals: services.proposals, state, discovery: services.discovery };
}

describe('the discovery', () => {
  it('drafts the next queued service and opens its batch pull request', async () => {
    const world = streamWorld();
    world.queue = queue.split('- id: lockedco')[0];
    const { summary, steps, proposals, state, discovery } = await night(world);
    expect(steps).toContain("survey streamco's site");
    expect(steps).toContain("find streamco's pricing page");
    expect(steps).toContain('extract streamco, part 1 of 2');
    expect(steps).toContain('draft streamco');
    expect(summary.batch).toBe('https://github.com/NoahAdamMacDonald/simply-sub/pull/1');

    const [made] = proposals;
    expect(made.branch).toBe(`catalog/batch-${today}-streamco`);
    expect(made.title).toBe('Catalog: StreamCo');
    expect(batchIdsIn(made.body)).toEqual(['streamco']);
    const text = (path: string) => made.changes.find((change) => change.path === path)?.text ?? '';
    const provider = providerSchema.parse(parse(text('data/providers/streamco.yaml')));
    expect(provider.plans.map((plan) => [plan.name, plan.prices[0].amount])).toEqual([
      ['Standard', 18.99],
      ['Premium', 23.99],
    ]);
    expect(provider.cancelUrl).toBe(`${site}/cancel`);
    expect(provider.policies?.ratings[0].sources[0].quote).toBe(
      'you’ll keep access until the end of your billing period',
    );
    const paths = made.changes.map((change) => change.path);
    expect(paths).toContain('data/logos/streamco.png');
    expect(paths).toContain(baselinePath(`${site}/plans`));
    expect(paths).toContain(baselinePath(`${site}/terms`));
    const statuses = queueFileSchema.parse(parse(text('data/queue.yaml')));
    expect(statuses[0]).toMatchObject({ id: 'streamco', status: 'done', date: today });
    // Each page read once, and nothing left in KV but the check date.
    expect(new Set(discovery.reads).size).toBe(discovery.reads.length);
    expect(await state.discovery()).toBeUndefined();
    expect(await state.work('streamco')).toBeUndefined();
    expect((await state.checks())['discovery']).toBe(today);
  });

  it('takes the night’s Neurons only, and goes on the next night without reading the pages again', async () => {
    const world = streamWorld();
    world.queue = queue.split('- id: lockedco')[0];
    const state = memoryState();
    const few = discoveryOn({ batch: { ...settings().batch, neurons: 100 } });
    const first = await night(world, { state, settings: few });
    expect(first.proposals).toEqual([]);
    expect((await state.work('streamco'))?.pages?.map((page) => page.kind)).toEqual([
      'pricing',
      'cancel',
      'terms',
      'privacy',
    ]);
    // The next night: not due again, but the batch under way goes on.
    const second = await night(world, { state, date: '2026-10-30' });
    expect(second.proposals.map((made) => made.branch)).toEqual([
      `catalog/batch-${today}-streamco`,
    ]);
    expect(second.discovery.reads).toEqual([]);
  });

  it('leaves out a service none of whose pages can be read, saying why in the queue', async () => {
    const world = streamWorld();
    world.batchPulls = { open: ['streamco'], closed: [] };
    const { proposals } = await night(world);
    const [made] = proposals;
    expect(made.branch).toBe(`catalog/batch-${today}-lockedco`);
    expect(made.title).toBe(`Catalog: queue updates of ${today}`);
    const statuses = queueFileSchema.parse(
      parse(made.changes.find((change) => change.path === 'data/queue.yaml')?.text ?? ''),
    );
    expect(statuses.find((entry) => entry.id === 'lockedco')).toMatchObject({
      status: 'unreadable',
      note: 'No page of it could be read',
    });
    // StreamCo is in an open batch pull request: not taken again.
    expect(statuses.find((entry) => entry.id === 'streamco')?.status).toBe('queued');
  });

  it('reads a page only a browser shows, within the night’s browser pages', async () => {
    const world = streamWorld();
    world.queue = queue.split('- id: lockedco')[0];
    const plans = world.pages[`${site}/plans`];
    world.pages[`${site}/plans`] = '<div id="app"></div>';
    world.browserOnly = { [`${site}/plans`]: plans.replace(/<[^>]+>/g, ' ') };
    const state = memoryState();
    const none = discoveryOn({ batch: { ...settings().batch, browserPages: 0 } });
    expect((await night(world, { state, settings: none })).proposals).toEqual([]);
    expect((await state.work('streamco'))?.pages?.[0]).toMatchObject({
      kind: 'pricing',
      method: 'browser',
    });
    const next = await night(world, { state, date: '2026-10-30' });
    expect(next.discovery.reads).toContain(`browser ${site}/plans`);
    const file = next.proposals[0].changes.find(
      (change) => change.path === 'data/providers/streamco.yaml',
    );
    expect(providerSchema.parse(parse(file?.text ?? '')).plans).toHaveLength(2);
  });

  it('takes no batch when its cadence is off, nor one the queue has nothing for', async () => {
    const off = await night(streamWorld(), { settings: settings() });
    expect(
      off.steps.filter((name) => name.includes('discovery') || name.includes('streamco')),
    ).toEqual(['read the discovery batch']);
    const world = streamWorld();
    world.queue = '[]\n';
    const empty = await night(world);
    expect(empty.proposals).toEqual([]);
    // Looked for tonight, so the cadence counts from tonight.
    expect((await empty.state.checks())['discovery']).toBe(today);
  });
});

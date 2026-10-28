import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { providerSchema } from '@simply-sub/core';
import { runPriceCheck } from '../src/run';
import { fakeServices, mullvad, png, stepper, storedWorld, today, type World } from './fakes';
import mullvadNoInet from './fixtures/mullvad-resellers-no-inet.html?raw';
import mullvadTaxGone from './fixtures/mullvad-pricing-tax-gone.html?raw';
import netflixChanged from './fixtures/netflix-ca-changed.html?raw';

// A night of the price check, end to end with fakes (PROJECT-PLAN M8.3's "done when"): a changed price, a changed
// logo, a taxIncluded quote gone from its page and a reseller the provider no longer names each produce a pull
// request; a night where nothing changed produces none.

async function night(world: World) {
  const services = await fakeServices(world);
  const steps: string[] = [];
  const summary = await runPriceCheck(today, stepper(steps), services);
  return { summary, steps, proposals: services.proposals };
}

/** The lines a change took out and put in, in order: the edits only replace or take out lines. */
function changedLines(before: string, after: string): string[] {
  const old = before.split('\n');
  const now = after.split('\n');
  const removed: string[] = [];
  const added: string[] = [];
  let j = 0;
  for (let i = 0; i < old.length; i++) {
    if (old[i] === now[j]) {
      j++;
    } else if (old[i + 1] === now[j]) {
      removed.push(`- ${old[i].trim()}`);
    } else {
      removed.push(`- ${old[i].trim()}`);
      added.push(`+ ${now[j].trim()}`);
      j++;
    }
  }
  return [...removed, ...added];
}

describe('a night of the price check', () => {
  it('runs a step per provider, then the pull request, and opens none when nothing changed', async () => {
    const { summary, steps, proposals } = await night(storedWorld());
    expect(steps).toEqual([
      'read the catalog',
      'read the repository',
      'read robots.txt 1',
      'check mullvad',
      'check netflix',
      'open or refresh the pull request',
    ]);
    expect(proposals).toEqual([]);
    expect(summary.pullRequest).toBeUndefined();
  });

  it('proposes a changed price, with today’s lastVerified', async () => {
    const world = storedWorld();
    world.pages['https://help.netflix.com/en/node/24926/ca'] = netflixChanged;
    // Workers AI reads Standard's new price off the page.
    world.ai = (request) => ({
      response: {
        prices: request.messages[1].content.includes('1. Netflix Standard:')
          ? [{ plan: 1, found: true, regularAmount: 19.99, currency: 'CAD', onlySalePrice: false }]
          : [],
      },
    });
    const { summary, proposals } = await night(world);
    expect(summary.pullRequest).toBe('https://github.com/NoahAdamMacDonald/simply-sub/pull/1');
    const [made] = proposals;
    expect(made.title).toBe(`Price updates ${today}`);
    const file = made.changes.find((change) => change.path === 'data/providers/netflix.yaml');
    expect(
      changedLines(
        (await import('../../../data/providers/netflix.yaml?raw')).default,
        file?.text ?? '',
      ),
    ).toEqual([
      '- amount: 18.99',
      '- lastVerified: 2026-10-23',
      '+ amount: 19.99',
      `+ lastVerified: ${today}`,
    ]);
    expect(providerSchema.safeParse(parse(file?.text ?? '')).success).toBe(true);
    expect(made.body).toContain(
      '| Netflix Standard, CA in CAD, monthly | 18.99 CAD | 19.99 CAD (+5.3%) |',
    );
  });

  it('proposes a changed logo (a rebrand)', async () => {
    const world = storedWorld();
    world.icons['https://www.netflix.com/icon-180.png'] = png(180, 7);
    const { proposals } = await night(world);
    const [made] = proposals;
    expect(made.changes.map((change) => change.path)).toEqual(['data/logos/netflix.png']);
    expect(made.changes[0].base64).toBeDefined();
    expect(made.body).toContain(
      '**netflix**: a new 180×180 icon from [www.netflix.com/icon-180.png]',
    );
  });

  it('proposes taking out taxIncluded when its quote is gone from the page', async () => {
    const world = storedWorld();
    world.pages['https://mullvad.net/en/pricing'] = mullvadTaxGone;
    const { proposals } = await night(world);
    const [made] = proposals;
    const file = made.changes.find((change) => change.path === 'data/providers/mullvad.yaml');
    // Each of Mullvad's prices cites the page and its quote.
    const prices = mullvad.plans[0].prices.length;
    expect(prices).toBe(5);
    expect(
      changedLines(
        (await import('../../../data/providers/mullvad.yaml?raw')).default,
        file?.text ?? '',
      ),
    ).toEqual([
      ...Array.from({ length: prices }, () => [
        '- taxIncluded: { quote: Including VAT. }',
        '- lastVerified: 2026-10-26',
      ]).flat(),
      ...Array.from({ length: prices }, () => `+ lastVerified: ${today}`),
    ]);
    expect(providerSchema.safeParse(parse(file?.text ?? '')).success).toBe(true);
    expect(made.body).toContain('its quote “Including VAT.” isn’t on the page any more');
  });

  it('proposes removing a reseller the provider’s page no longer names', async () => {
    const world = storedWorld();
    world.pages['https://mullvad.net/en/help/partnerships-and-resellers'] = mullvadNoInet;
    const { proposals } = await night(world);
    const [made] = proposals;
    const text =
      made.changes.find((change) => change.path === 'data/providers/mullvad.yaml')?.text ?? '';
    const provider = providerSchema.parse(parse(text));
    expect(provider.resellers?.map((listing) => listing.reseller)).toEqual([
      'amazon',
      'laptopwithlinux',
      'proxystore',
      'serialcart',
      'webhallen',
    ]);
    expect(made.body).toContain('**inet** isn’t named as mullvad’s reseller any more');
  });

  it('goes on when a provider’s step fails, saying so in the pull request', async () => {
    const world = storedWorld();
    world.icons['https://www.netflix.com/icon-180.png'] = png(180, 9);
    const services = await fakeServices(world);
    services.readProvider = async (id) => {
      if (id === 'mullvad') throw new Error('D1 is unavailable');
      return (await fakeServices(world)).readProvider(id);
    };
    await runPriceCheck(today, stepper([]), services);
    expect(services.proposals[0].body).toContain(
      '**mullvad**: The check failed: D1 is unavailable',
    );
  });
});

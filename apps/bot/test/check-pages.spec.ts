import { describe, expect, it } from 'vitest';
import { checkPages, judged, networksFindings } from '../src/check-pages';
import { gitBlobSha } from '../src/icons';
import { approvalTargets, networksTargets, providerTargets } from '../src/targets';
import type { PriceTarget } from '../src/types';
import { committedLogos, fakeDeps, mullvad, netflix, png, storedWorld, type Calls } from './fakes';
import netflixPaymentUsChanged from './fixtures/netflix-payment-us-changed.html?raw';

// One provider's checks, and §6.4's guardrails.

const budget = { browserPages: 5, neurons: 8_000 };
const standard = providerTargets(netflix).find(
  (target) =>
    target.owner.kind === 'plan' &&
    target.owner.id === 'netflix.standard' &&
    target.price.region === 'CA',
) as PriceTarget;

describe('checkPages', () => {
  it('confirms prices still on their pages without Workers AI, reading each page once', async () => {
    const calls: Calls = { pages: [], browser: [], ai: [] };
    const { findings } = await checkPages(
      { subject: 'netflix', targets: providerTargets(netflix), approvals: [], networks: [] },
      fakeDeps(storedWorld(), calls),
      budget,
    );
    const confirmed = findings.filter((finding) => finding.kind === 'confirmed');
    // The Canadian, British, Australian and New Zealand prices are on their fixture pages; the US page isn't there.
    expect(
      confirmed.map((finding) => 'target' in finding && finding.target.price.region).sort(),
    ).toEqual([
      'AU',
      'AU',
      'AU',
      ...Array.from({ length: 5 }, () => 'CA'),
      'GB',
      'GB',
      'GB',
      'NZ',
      'NZ',
    ]);
    expect(findings.filter((finding) => finding.kind === 'manual')).toHaveLength(1);
    expect(calls.ai).toEqual([]);
    expect(new Set(calls.pages).size).toBe(calls.pages.length);
  });

  it('opens a page that a fetch gets nothing from in the browser, within the night’s budget', async () => {
    const world = storedWorld();
    world.pages['https://mullvad.net/en/pricing'] = '<div id="app"></div>';
    world.browserOnly = {
      'https://mullvad.net/en/pricing': 'Mullvad VPN €5 /month. Including VAT.',
    };
    const calls: Calls = { pages: [], browser: [], ai: [] };
    const targets = providerTargets(mullvad).filter((target) => target.owner.kind === 'plan');
    const result = await checkPages(
      { subject: 'mullvad', targets, approvals: [], networks: [] },
      fakeDeps(world, calls),
      budget,
    );
    expect(calls.browser).toEqual(['https://mullvad.net/en/pricing']);
    expect(result.budget.browserPages).toBe(4);
    // The monthly prices show as "€5 /month", for 1, 2, 3 or 6 months. The yearly €60 never shows on its own, and a
    // yearly price isn't matched a month at a time (a per-month figure could be another plan's), so a person checks it.
    expect(
      result.findings.map((finding) =>
        'target' in finding && finding.target && 'price' in finding.target
          ? `${finding.kind} ${finding.target.price.amount}`
          : finding.kind,
      ),
    ).toEqual(['confirmed 5', 'confirmed 10', 'confirmed 15', 'confirmed 30', 'manual 60']);

    const none = await checkPages(
      { subject: 'mullvad', targets, approvals: [], networks: [] },
      fakeDeps(world),
      {
        ...budget,
        browserPages: 0,
      },
    );
    expect(none.findings.some((finding) => finding.kind === 'confirmed')).toBe(false);
  });

  it('never opens a page robots.txt keeps the bot out of in the browser', async () => {
    const calls: Calls = { pages: [], browser: [], ai: [] };
    const deps = fakeDeps(storedWorld(), calls);
    deps.page = async () => ({ error: 'robots.txt doesn’t allow the bot to read it' });
    const { findings } = await checkPages(
      { subject: 'netflix', targets: [standard], approvals: [], networks: [] },
      deps,
      budget,
    );
    expect(calls.browser).toEqual([]);
    expect(findings).toMatchObject([
      { kind: 'manual', reason: 'robots.txt doesn’t allow the bot to read it' },
    ]);
  });

  it('asks Workers AI only while the night’s Neurons last', async () => {
    const world = storedWorld();
    world.pages['https://help.netflix.com/en/node/24926/ca'] = '<p>Standard: $21.99 a month</p>';
    const calls: Calls = { pages: [], browser: [], ai: [] };
    const low = await checkPages(
      { subject: 'netflix', targets: [standard], approvals: [], networks: [] },
      fakeDeps(world, calls),
      { ...budget, neurons: 10 },
    );
    expect(calls.ai).toEqual([]);
    expect(low.findings).toMatchObject([
      { kind: 'manual', reason: 'Not enough Workers AI left tonight to read it' },
    ]);
  });

  it('finds a reseller’s approval missing', async () => {
    const world = storedWorld();
    world.pages['https://mullvad.net/en/help/partnerships-and-resellers'] = '<p>Amazon - CA</p>';
    const { findings } = await checkPages(
      { subject: 'mullvad', targets: [], approvals: approvalTargets(mullvad), networks: [] },
      fakeDeps(world),
      budget,
    );
    expect(
      findings.map((finding) => finding.kind === 'reseller' && finding.approval.reseller),
    ).toEqual(['inet', 'laptopwithlinux', 'proxystore', 'serialcart', 'webhallen']);
  });
});

describe('accepted card networks', () => {
  const [canada, unitedStates] = networksTargets(netflix);

  it('are confirmed while every quote is on its page, with no network named beside them', async () => {
    const { findings } = await checkPages(
      { subject: 'netflix', targets: [], approvals: [], networks: [canada, unitedStates] },
      fakeDeps(storedWorld()),
      budget,
    );
    // The Canadian page's "Discover what's new on Netflix" is prose, out of its list's reach.
    expect(findings).toEqual([]);
  });

  it('take a region out when a quote is gone, and name a network listed beside them', async () => {
    const world = storedWorld();
    world.pages[unitedStates.url] = netflixPaymentUsChanged;
    world.pages[canada.url] = world.pages[canada.url].replace(
      '<li>American Express</li>',
      '<li>American Express</li><li>JCB</li>',
    );
    const { findings } = await checkPages(
      { subject: 'netflix', targets: [], approvals: [], networks: [canada, unitedStates] },
      fakeDeps(world),
      budget,
    );
    expect(findings).toEqual([
      { kind: 'networks', target: canada, missing: [], named: ['jcb'] },
      { kind: 'networks', target: unitedStates, missing: ['Discover'], named: [] },
    ]);
  });

  it('leave to a person a region whose list the page doesn’t show: it follows the reader’s country', () => {
    const shared = 'https://help.disneyplus.com/article/disneyplus-payment-methods';
    const canadian = { ...canada, url: shared, quotes: ['JCB', 'Visa', 'Diners Club'] };
    const american = { ...unitedStates, url: shared, quotes: ['Visa', 'Discover'] };
    // Read from the US: its list, and not Canada's.
    const findings = networksFindings('We accept: Visa Mastercard Discover', [canadian, american]);
    expect(findings).toEqual([
      {
        kind: 'manual',
        subject: "netflix's cards in CA",
        url: shared,
        reason: 'The page shows another country’s list of cards',
      },
    ]);
    // A page that shows neither list changed for both.
    expect(
      networksFindings('We accept: Mastercard', [canadian, american]).map(
        (finding) => finding.kind,
      ),
    ).toEqual(['networks', 'networks']);
  });

  it('are left to a person when their page can’t be read', async () => {
    const world = storedWorld();
    delete world.pages[canada.url];
    const { findings } = await checkPages(
      { subject: 'netflix', targets: [], approvals: [], networks: [canada] },
      fakeDeps(world),
      budget,
    );
    expect(findings).toEqual([
      {
        kind: 'manual',
        subject: "netflix's cards in CA",
        url: canada.url,
        reason: 'Browser Rendering couldn’t read the page',
      },
    ]);
  });
});

describe('judged', () => {
  const answer = (regularAmount: number, extra = {}) => ({
    found: true,
    regularAmount,
    currency: 'CAD',
    onlySalePrice: false,
    ...extra,
  });

  it('confirms the same price, proposes another, and flags one that moves more than 30%', () => {
    expect(judged(standard, answer(18.99))).toMatchObject({ kind: 'confirmed' });
    expect(judged(standard, answer(19.99))).toMatchObject({
      kind: 'changed',
      amount: 19.99,
      suspicious: false,
    });
    expect(judged(standard, answer(24.99))).toMatchObject({ kind: 'changed', suspicious: true });
    expect(judged(standard, answer(12.99))).toMatchObject({ kind: 'changed', suspicious: true });
  });

  it('never takes a sale price, a price in another currency, or one that isn’t there', () => {
    expect(judged(standard, answer(9.99, { onlySalePrice: true }))).toMatchObject({
      kind: 'manual',
      reason: 'The page shows only a sale or first-term price',
    });
    expect(judged(standard, answer(19.99, { currency: 'USD' }))).toMatchObject({
      kind: 'manual',
      reason: 'The page shows USD, not CAD: a region or currency mismatch',
    });
    expect(judged(standard, { found: false, onlySalePrice: false })).toMatchObject({
      kind: 'manual',
    });
    expect(judged(standard, undefined)).toMatchObject({ kind: 'manual' });
  });
});

describe('logos', () => {
  const input = (committed?: string) => ({
    subject: 'netflix',
    targets: [],
    approvals: [],
    networks: [],
    logo: { id: 'netflix', website: 'https://www.netflix.com', ...(committed && { committed }) },
  });

  it('proposes a new icon at least as big as the committed one, and none smaller (an icon service’s)', async () => {
    const committed = await gitBlobSha(committedLogos['netflix']);
    const world = storedWorld();
    world.icons['https://www.netflix.com/icon-180.png'] = png(180, 3);
    expect((await checkPages(input(committed), fakeDeps(world), budget)).findings).toMatchObject([
      { kind: 'logo', width: 180, replaces: true },
    ]);
    world.icons['https://www.netflix.com/icon-180.png'] = png(96, 3);
    expect((await checkPages(input(committed), fakeDeps(world), budget)).findings).toEqual([]);
    // A provider without a logo yet gets its first.
    expect((await checkPages(input(), fakeDeps(world), budget)).findings).toMatchObject([
      { kind: 'logo', width: 96, replaces: false },
    ]);
  });

  it('asks a person when the committed logo can’t be read to compare with', async () => {
    const world = storedWorld();
    world.icons['https://www.netflix.com/icon-180.png'] = png(180, 3);
    const deps = fakeDeps(world);
    deps.committedLogo = async () => undefined;
    expect((await checkPages(input('0'.repeat(40)), deps, budget)).findings).toMatchObject([
      { kind: 'manual', subject: "netflix's logo" },
    ]);
  });
});

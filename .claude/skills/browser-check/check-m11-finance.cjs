// M11.13 in the system Edge: the finance optimizer on Optimizations, on `ng serve`, for a Canadian in Ontario. No real
// finance provider is in the catalog before M11.15, so the CA file is answered with two fixture providers: Example
// Bank (a $17.95 chequing that $4,000 waives, paying 0.50%; free savings at 2%, and 2.50% over $10,000) and Example
// Savings (Basic, free at 2%; Plus, $10 a month at 3.50%). Banking holds, written to IndexedDB, the chequing with
// $1,000, the bank's savings with $100,000 and Basic with $9,000. In both themes at 1280 and 360 px, keyboard only:
// - Home's Banking card, then List view's View optimizations (Tab, Enter) open Optimizations: no cost-only card, and an
//   Accounts section whose cards are, in order: the bank's $101,000 over CDIC's $100,000 limit (a warning); Plus would
//   earn $930.00 more than the bank's savings, linked to Search; $3,000 moved to the chequing saves $170.40; Basic's
//   $9,000 in the bank's savings earns $45.00 more; and Plus pays for itself above $8,000 ($10 a month for 1.5 points
//   more: the acceptance's break-even). Every card says "Information, not financial advice."
// - Tab to See it in Search, Enter: Search opens on Example Savings with Plus shown.
// With axe on Optimizations, screenshots, and no horizontal scroll.
// Usage: node check-m11-finance.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
const fs = require('fs');
const path = require('path');

const [depsDir, outDir, baseUrl] = process.argv.slice(2);
const { chromium } = require(path.join(depsDir, 'node_modules', 'playwright-core'));
const axeSource = fs.readFileSync(
  path.join(depsDir, 'node_modules', 'axe-core', 'axe.min.js'),
  'utf8',
);
fs.mkdirSync(outDir, { recursive: true });

const WIDE = { width: 1280, height: 900 };
const NARROW = { width: 360, height: 740 };
const checks = [];
const consoleProblems = [];
function check(name, ok, detail = '') {
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const LIST = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const stamps = { createdAt: '2026-11-01T12:00:00.000Z', updatedAt: '2026-11-01T12:00:00.000Z' };
const verified = '2026-11-03';

const protection = {
  insurer: 'cdic',
  held: 'own-name',
  limit: 100000,
  url: 'https://example.com/deposit-insurance',
  quotes: ['Your eligible deposits are protected by CDIC.'],
  lastVerified: verified,
};
const rates = (applies, tiers) => ({
  follows: 'none',
  applies,
  tiers,
  sourceUrl: 'https://example.com/rates',
  lastVerified: verified,
});
const price = (amount) => ({
  region: 'CA',
  currency: 'CAD',
  amount,
  interval: 'month',
  intervalCount: 1,
  autoRenew: true,
  lastVerified: verified,
});
const regulators = [
  {
    name: 'OSFI',
    url: 'https://www.osfi-bsif.gc.ca/en/supervision/financial-institutions',
    lastVerified: verified,
  },
];
const finance = {
  website: 'https://example.com',
  category: 'finance',
  spendCategory: 'finance',
  cancelUrl: 'https://example.com/close',
  regulators,
};

/** The fixture providers, as the CA file's snapshot holds them. */
const providers = [
  {
    id: 'example-bank',
    name: 'Example Bank',
    ...finance,
    plans: [
      {
        id: 'example-bank.unlimited',
        name: 'Unlimited Chequing',
        link: 'https://example.com/chequing',
        features: {},
        prices: [price(17.95)],
        account: {
          kind: 'chequing',
          currency: 'CAD',
          waivers: [{ minBalance: 4000 }],
          rates: rates('whole', [{ from: 0, rate: 0.5 }]),
          protection,
        },
      },
      {
        id: 'example-bank.savings',
        name: 'High Interest Savings',
        link: 'https://example.com/savings',
        features: {},
        prices: [price(0)],
        account: {
          kind: 'savings',
          currency: 'CAD',
          rates: rates('portion', [
            { from: 0, rate: 2 },
            { from: 10000, rate: 2.5 },
          ]),
          protection,
        },
      },
    ],
  },
  {
    id: 'example-savings',
    name: 'Example Savings',
    ...finance,
    plans: [
      ['basic', 'Basic', 0, 2],
      ['plus', 'Plus', 10, 3.5],
    ].map(([slug, name, fee, rate]) => ({
      id: `example-savings.${slug}`,
      name,
      link: 'https://example.com/plans',
      features: {},
      prices: [price(fee)],
      account: {
        kind: 'savings',
        currency: 'CAD',
        rates: rates('whole', [{ from: 0, rate }]),
        protection: { ...protection, held: 'trust' },
      },
    })),
  },
];

/** The cards Optimizations shows, in order: their first lines. */
const expectedHeadings = [
  "$101,000 at Example Bank is over CDIC's $100,000 limit",
  'Example Savings Plus would earn $930.00 more a year than Example Bank High Interest Savings',
  'Moving $3,000 to Example Bank Unlimited Chequing would save $170.40 a year',
  'Moving $9,000 to Example Bank High Interest Savings would earn $45.00 more a year',
  'Example Savings Plus would earn $15.00 more a year than Example Savings Basic',
];

async function waitForServer() {
  for (let i = 0; i < 180; i++) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {
      // not up yet
    }
    await sleep(1000);
  }
  throw new Error(`No server at ${baseUrl}`);
}

async function until(what, condition, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await condition();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function newPage(browser, label, colorScheme, viewport) {
  const context = await browser.newContext({
    locale: 'en-CA',
    colorScheme,
    viewport,
    serviceWorkers: 'block',
  });
  // GET /fx, answered with fixed rates, so no Worker is needed behind the dev proxy.
  await context.route('**/api/v1/fx?**', (route) =>
    route.fulfill({
      json: {
        data: {
          base: 'CAD',
          date: '2026-10-26',
          source: 'European Central Bank via Frankfurter',
          rates: { EUR: 0.6372, USD: 0.7243 },
        },
        meta: { fetchedAt: '2026-10-26T06:00:02Z', stale: false },
      },
    }),
  );
  // The CA file with the fixture providers and the finance categories they name.
  await context.route('**/data/catalog/CA.json', async (route) => {
    const response = await route.fetch();
    const file = await response.json();
    const { categories } = file.data;
    categories.service.push({
      id: 'finance',
      name: 'Banking & investing',
      icon: 'account_balance',
    });
    categories.spend.push({ id: 'finance', name: 'Bank & account fees' });
    file.data.providers.push(...providers);
    await route.fulfill({ response, json: file });
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    const blockedWorker = msg.text() === 'Service Worker registration blocked by Playwright';
    if ((msg.type() === 'error' || msg.type() === 'warning') && !blockedWorker) {
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  return { context, page };
}

/** Opens Home and completes the first-run dialog for Ontario. */
async function firstRun(page) {
  await page.goto(baseUrl);
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor({ timeout: 20000 });
  await page
    .locator('mat-form-field', { has: page.locator('mat-label', { hasText: 'Province' }) })
    .locator('.mat-mdc-text-field-wrapper')
    .click();
  await page.getByRole('option', { name: 'Ontario', exact: true }).click();
  await page.locator('.cdk-overlay-pane mat-option').first().waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Get started' }).click();
  await dialog.waitFor({ state: 'detached' });
}

/** Writes a record straight to an IndexedDB table. Dexie's live queries don't see it: reload after. */
function putRecord(page, table, record) {
  return page.evaluate(
    ([store, value]) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('simply-sub');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(store, 'readwrite');
          transaction.objectStore(store).put(value);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    [table, record],
  );
}

/** Banking and its three accounts. */
async function plant(page) {
  await putRecord(page, 'lists', { id: LIST, name: 'Banking', ...stamps });
  const items = [
    ['0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a00', 'example-bank.unlimited', 1000],
    ['0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a01', 'example-bank.savings', 100000],
    ['0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a02', 'example-savings.basic', 9000],
  ];
  for (const [id, planId, amount] of items) {
    await putRecord(page, 'items', {
      id,
      listId: LIST,
      source: { kind: 'catalog', planId },
      billing: {
        mode: 'recurring',
        interval: 'month',
        intervalCount: 1,
        anchorDate: '2026-11-20',
        autoRenew: true,
      },
      tagIds: [],
      rankOverrides: {},
      pinned: false,
      account: { balance: { amount, currency: 'CAD' }, asOf: '2026-11-01' },
      ...stamps,
    });
  }
}

async function axeCheck(page, label) {
  await sleep(600);
  await page.evaluate(axeSource);
  const result = await page.evaluate(() => axe.run(document));
  const problems = result.violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(' '))
        .join(' | ')}`,
  );
  check(`axe: ${label}`, problems.length === 0, problems.join('; '));
}

async function noSideScroll(page, viewport, label) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`no horizontal scroll: ${label}`, width <= viewport.width, `${width}px`);
}

/** Presses Tab until the element `selector` names has focus. */
async function tabTo(page, selector, limit = 150) {
  const there = `document.activeElement?.matches(${JSON.stringify(selector)}) ?? false`;
  for (let presses = 0; presses < limit && !(await page.evaluate(there)); presses++) {
    await page.keyboard.press('Tab');
  }
  if (!(await page.evaluate(there))) throw new Error(`Never reached ${selector}`);
}

async function run(browser, colorScheme, viewport) {
  const label = `${colorScheme} ${viewport.width}`;
  const { context, page } = await newPage(browser, label, colorScheme, viewport);
  try {
    await firstRun(page);
    await plant(page);
    await page.reload();

    // Home's Banking card, then List view's View optimizations, by keyboard.
    await page.locator('a.list-card:not(.new)').waitFor({ timeout: 20000 });
    await tabTo(page, 'a.list-card:not(.new)');
    await page.keyboard.press('Enter');
    await page.locator('ss-optimizations-link a.link').first().waitFor({ timeout: 15000 });
    await tabTo(page, 'ss-optimizations-link a.link');
    await page.keyboard.press('Enter');
    const section = page.locator('section.accounts');
    await section.locator('li.card').first().waitFor({ timeout: 20000 });

    const shown = await section.evaluate((accounts) => ({
      heading: accounts.querySelector('h2')?.textContent.trim(),
      cards: [...accounts.querySelectorAll('li.card')].map((card) => ({
        heading: card.querySelector('.heading')?.textContent.trim(),
        warning: card.classList.contains('warning'),
        advice: card.querySelector('.advice')?.textContent.trim(),
      })),
    }));
    check(
      `${label}: an Accounts section, warnings first, then the most a year first`,
      shown.heading === 'Accounts' &&
        JSON.stringify(shown.cards.map((card) => card.heading)) ===
          JSON.stringify(expectedHeadings) &&
        shown.cards.map((card) => card.warning).join() === 'true,false,false,false,false',
      JSON.stringify(shown.cards.map((card) => card.heading)),
    );
    check(
      `${label}: every finance card says it's information, not financial advice`,
      shown.cards.length > 0 &&
        shown.cards.every((card) => card.advice === 'Information, not financial advice.'),
      JSON.stringify(shown.cards.map((card) => card.advice)),
    );
    const breakEven = (
      await section.locator('li.card').nth(4).locator('p').nth(1).textContent()
    ).trim();
    check(
      `${label}: $10 a month for 1.5 points more pays for itself above $8,000`,
      breakEven ===
        'At 3.50% instead of 2.00%, its $10.00 more a month pays for itself above $8,000, and Example Savings Basic has $9,000.',
      breakEven,
    );
    check(
      `${label}: no cost-only card for the accounts`,
      (await page.locator('ss-suggestion-card').count()) === 0,
    );
    await axeCheck(page, `${label}, Optimizations`);
    await section.screenshot({
      path: path.join(outDir, `finance-${colorScheme}-${viewport.width}.png`),
    });
    await noSideScroll(page, viewport, `${label}, Optimizations`);

    // See it in Search, by keyboard.
    await tabTo(page, 'section.accounts a[href^="/search"]');
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/search\?/, { timeout: 15000 });
    const url = new URL(page.url());
    check(
      `${label}: See it in Search opens Search on Example Savings, with Plus shown`,
      url.searchParams.get('q') === 'Example Savings' &&
        url.searchParams.get('plan') === 'example-savings.plus',
      page.url(),
    );
  } finally {
    await context.close();
  }
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    for (const colorScheme of ['light', 'dark']) {
      for (const viewport of [WIDE, NARROW]) await run(browser, colorScheme, viewport);
    }
  } finally {
    await browser.close();
  }
  check('no console errors or warnings', consoleProblems.length === 0, consoleProblems.join('\n'));
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
})();

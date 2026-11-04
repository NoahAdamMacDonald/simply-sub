// M11.12 in the system Edge: interest and net cost, on `ng serve`, for a Canadian in Ontario. No real
// finance provider is in the catalog before M11.15, so the CA file is answered with a fixture bank added: its $17.95
// chequing pays 0.50% and a $4,000 balance waives its fee; its free savings pay 2%, and 2.50% over $10,000. Banking
// holds, written to IndexedDB, the chequing with $2,000 (its fee paid on the 1st of each month), a second one, Joint,
// with $5,000 (its fee waived) and the savings with $12,000. In both themes at 1280 and 360 px, keyboard only:
// - Home's Budgets: "$285.00 interest a year" beside the totals, which count only the fee paid ($17.95 on the 1st of
//   this month: an account's fee has no sales tax, the owner's choice), read with "not counted in the totals".
// - Home's Banking card leads to List view (Tab, Enter): its totals have the same line; the chequing's card says its
//   interest and its net cost ($215.40 of fees less $10.00), its price with no "+ tax", Joint's says its fee is waived
//   (with Waived under its price) and its interest, the savings' its interest at 2.08%, the tiers averaged.
// - The Lists page: the line beside every list's totals, none on Banking's card.
// With axe on each page, screenshots, and no horizontal scroll.
// Usage: node check-m11-interest.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

/** The 1st of this month on this device: the chequing's fee is paid then, once this month. */
const now = new Date();
const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

const LIST = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const CHEQUING = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a00';
const JOINT = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a01';
const SAVINGS = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a02';
const stamps = { createdAt: '2026-11-01T12:00:00.000Z', updatedAt: '2026-11-01T12:00:00.000Z' };

const protection = {
  insurer: 'cdic',
  held: 'own-name',
  limit: 100000,
  url: 'https://example.com/deposit-insurance',
  quotes: ['Your eligible deposits are protected by CDIC.'],
  lastVerified: '2026-11-03',
};
const rates = (applies, tiers) => ({
  follows: 'none',
  applies,
  tiers,
  sourceUrl: 'https://example.com/rates',
  lastVerified: '2026-11-03',
});
const price = (amount) => ({
  region: 'CA',
  currency: 'CAD',
  amount,
  interval: 'month',
  intervalCount: 1,
  autoRenew: true,
  lastVerified: '2026-11-03',
});

/** The fixture bank, as the CA file's snapshot holds a provider. */
const bank = {
  id: 'example-bank',
  name: 'Example Bank',
  website: 'https://example.com',
  category: 'finance',
  spendCategory: 'finance',
  cancelUrl: 'https://example.com/close',
  regulators: [
    {
      name: 'OSFI',
      url: 'https://www.osfi-bsif.gc.ca/en/supervision/financial-institutions',
      lastVerified: '2026-11-03',
    },
  ],
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
};

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
  // The CA file with the fixture bank and the finance categories it names.
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
    file.data.providers.push(bank);
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
  const monthly = {
    mode: 'recurring',
    interval: 'month',
    intervalCount: 1,
    anchorDate: firstOfMonth,
    autoRenew: true,
  };
  const items = [
    [CHEQUING, 'example-bank.unlimited', 2000, {}],
    [JOINT, 'example-bank.unlimited', 5000, { nickname: 'Joint' }],
    [SAVINGS, 'example-bank.savings', 12000, {}],
  ];
  for (const [id, planId, amount, extra] of items) {
    await putRecord(page, 'items', {
      id,
      listId: LIST,
      source: { kind: 'catalog', planId },
      billing: monthly,
      tagIds: [],
      rankOverrides: {},
      pinned: false,
      account: { balance: { amount, currency: 'CAD' }, asOf: '2026-11-01' },
      ...extra,
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

/** A paragraph's shown words and its words for screen readers. */
function readLine(locator) {
  return locator.evaluate((line) => ({
    shown: line.querySelector('[aria-hidden="true"]:not(mat-icon)')?.textContent.trim(),
    spoken: line.querySelector('.visually-hidden')?.textContent.trim(),
  }));
}

/** A card's account lines, as shown. */
function accountLines(page, itemId) {
  return page
    .locator(`[data-item="${itemId}"] .account-lines li [aria-hidden="true"]`)
    .allTextContents()
    .then((lines) => lines.map((line) => line.trim()));
}

async function run(browser, colorScheme, viewport) {
  const label = `${colorScheme} ${viewport.width}`;
  const { context, page } = await newPage(browser, label, colorScheme, viewport);
  try {
    await firstRun(page);
    await plant(page);
    await page.reload();

    // Home's Budgets: interest beside the totals, never in them.
    const budgets = page.locator('section.budgets');
    const interest = budgets.locator('p.interest');
    await interest.waitFor({ timeout: 20000 });
    const line = await readLine(interest);
    check(
      `${label}: Home's Budgets show the accounts' interest a year, not counted in the totals`,
      line.shown === '$285.00 interest a year' &&
        line.spoken === '$285.00 interest a year, not counted in the totals',
      JSON.stringify(line),
    );
    const month = (
      await budgets.locator('.total [aria-hidden="true"]').first().textContent()
    ).trim();
    check(
      `${label}: this month's total is the one fee paid, with no sales tax, and no interest`,
      month === '$17.95 this month',
      month,
    );
    await axeCheck(page, `${label}, Home`);
    await budgets.screenshot({
      path: path.join(outDir, `interest-home-${colorScheme}-${viewport.width}.png`),
    });
    await noSideScroll(page, viewport, `${label}, Home`);

    // Home's Banking card, by keyboard, to List view.
    await tabTo(page, 'a.list-card:not(.new)');
    await page.keyboard.press('Enter');
    await page.locator(`[data-item="${SAVINGS}"]`).waitFor({ timeout: 15000 });
    const listInterest = await readLine(page.locator('ss-budget-totals p.interest'));
    check(
      `${label}: List view's totals have the same interest line`,
      listInterest.shown === '$285.00 interest a year',
      JSON.stringify(listInterest),
    );
    const cards = {
      chequing: await accountLines(page, CHEQUING),
      joint: await accountLines(page, JOINT),
      savings: await accountLines(page, SAVINGS),
    };
    check(
      `${label}: the chequing's card says its interest and its net cost after its fees`,
      JSON.stringify(cards.chequing) ===
        JSON.stringify([
          'Interest: $10.00 a year at 0.50%',
          'Net: costs $205.40 a year, after interest',
        ]),
      JSON.stringify(cards.chequing),
    );
    const fee = (await page.locator(`[data-item="${CHEQUING}"] .price ss-price`).innerText())
      .replace(/\s+/g, ' ')
      .trim();
    check(
      `${label}: its price has no "+ tax": an account's fee has none`,
      fee.startsWith('$17.95 / mo') && !fee.includes('tax'),
      fee,
    );
    const waived = (
      await page.locator(`[data-item="${JOINT}"] .price .waived`).textContent()
    ).trim();
    check(
      `${label}: Joint's says its fee is waived, with Waived under its price, and its interest`,
      JSON.stringify(cards.joint) ===
        JSON.stringify(['Fee waived: you keep $4,000 in it', 'Interest: $25.00 a year at 0.50%']) &&
        waived === 'Waived',
      `${JSON.stringify(cards.joint)} / ${waived}`,
    );
    check(
      `${label}: the savings' says its interest, its tiers averaged`,
      JSON.stringify(cards.savings) === JSON.stringify(['Interest: $250.00 a year at 2.08%']),
      JSON.stringify(cards.savings),
    );
    await axeCheck(page, `${label}, List view`);
    await page.locator(`[data-item="${JOINT}"]`).screenshot({
      path: path.join(outDir, `interest-card-${colorScheme}-${viewport.width}.png`),
    });
    await noSideScroll(page, viewport, `${label}, List view`);

    // The Lists page: beside every list's totals, not on a list's card.
    await page.goto(`${baseUrl}lists`);
    const overview = page.locator('ss-budget-totals p.interest');
    await overview.first().waitFor({ timeout: 15000 });
    const shown = await overview.allTextContents();
    check(
      `${label}: the Lists page shows it once, beside every list's totals, and not on Banking's card`,
      shown.length === 1 && shown[0].includes('$285.00 interest a year'),
      JSON.stringify(shown),
    );
    await axeCheck(page, `${label}, the Lists page`);
    await noSideScroll(page, viewport, `${label}, the Lists page`);
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

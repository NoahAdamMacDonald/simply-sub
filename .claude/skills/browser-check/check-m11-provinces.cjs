// M11.17's province prices in the system Edge, on `ng serve`: Search and Settings for a Canadian in Ontario, then in
// Quebec. No real provider is priced by province yet, so the CA file is answered with two fixture providers: Example
// Mobile (Talk and Text at $25 for Canada; Unlimited at $50 in Ontario and $40 in Quebec; Quebec Unlimited at $35 in
// Quebec only) and Example Credit Union (a free savings account, sold in British Columbia only). In both themes at
// 1280 and 360 px:
// - Ontario: Example Mobile's card has Talk and Text and Unlimited, not Quebec Unlimited; Unlimited, chosen with the
//   arrow keys, costs $50.00; the credit union's card says "Not offered in Ontario"; Settings' Search default reads
//   "Show only what's sold in Ontario".
// - Quebec, chosen in Settings: the card has all three, cheapest first, and Unlimited costs $40.00; the credit union
//   is "Not offered in Quebec"; Settings reads "Show only what's sold in Quebec".
// With axe on Search and Settings, screenshots, and no horizontal scroll.
// Usage: node check-m11-provinces.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

const verified = '2026-11-10';
const price = (region, amount) => ({
  region,
  currency: 'CAD',
  amount,
  interval: 'month',
  intervalCount: 1,
  autoRenew: true,
  lastVerified: verified,
});
const mobile = { 'mobile.included': true, 'internet.included': false };

/** The fixture providers, as the CA file's snapshot holds them. */
const providers = [
  {
    id: 'example-mobile',
    name: 'Example Mobile',
    website: 'https://example.com',
    category: 'telecom',
    spendCategory: 'telecom',
    cancelUrl: 'https://example.com/cancel',
    plans: [
      {
        id: 'example-mobile.talk',
        name: 'Talk and Text',
        link: 'https://example.com/talk',
        features: mobile,
        prices: [price('CA', 25)],
      },
      {
        id: 'example-mobile.unlimited',
        name: 'Unlimited',
        link: 'https://example.com/unlimited',
        features: { ...mobile, 'mobile.data': 100 },
        prices: [price('CA-ON', 50), price('CA-QC', 40)],
      },
      {
        id: 'example-mobile.quebec',
        name: 'Quebec Unlimited',
        link: 'https://example.com/quebec',
        features: { ...mobile, 'mobile.data': 60 },
        prices: [price('CA-QC', 35)],
      },
    ],
  },
  {
    id: 'example-credit-union',
    name: 'Example Credit Union',
    website: 'https://example.com',
    category: 'finance',
    spendCategory: 'finance',
    cancelUrl: 'https://example.com/close',
    availableIn: ['CA-BC'],
    regulators: [
      {
        name: 'BCFSA',
        url: 'https://www.bcfsa.ca/industry-resources/credit-union-resources',
        lastVerified: verified,
      },
    ],
    plans: [
      {
        id: 'example-credit-union.savings',
        name: 'Savings',
        link: 'https://example.com/savings',
        features: {},
        prices: [price('CA', 0)],
        account: {
          kind: 'savings',
          currency: 'CAD',
          rates: {
            follows: 'none',
            applies: 'whole',
            tiers: [{ from: 0, rate: 3 }],
            sourceUrl: 'https://example.com/rates',
            lastVerified: verified,
          },
          protection: {
            insurer: 'provincial',
            held: 'own-name',
            url: 'https://example.com/deposit-insurance',
            quotes: [
              'Your deposits are guaranteed by the Credit Union Deposit Insurance Corporation.',
            ],
            lastVerified: verified,
          },
        },
      },
    ],
  },
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

async function newPage(browser, label, colorScheme, viewport) {
  const context = await browser.newContext({
    locale: 'en-CA',
    colorScheme,
    viewport,
    serviceWorkers: 'block',
  });
  await context.route('**/api/v1/fx?**', (route) =>
    route.fulfill({
      json: {
        data: {
          base: 'CAD',
          date: '2026-11-10',
          source: 'European Central Bank via Frankfurter',
          rates: { EUR: 0.6372, USD: 0.7243 },
        },
        meta: { fetchedAt: '2026-11-10T06:00:02Z', stale: false },
      },
    }),
  );
  // The CA file with the fixture providers.
  await context.route('**/data/catalog/CA.json', async (route) => {
    const response = await route.fetch();
    const file = await response.json();
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

const card = (page, name) =>
  page.locator('ss-sub-card', { has: page.getByRole('heading', { name, exact: true }) });

/** Searches for `q` and waits for its card. */
async function search(page, q, name) {
  await page.goto(`${baseUrl}search?q=${encodeURIComponent(q)}`);
  const found = card(page, name);
  await found.waitFor({ timeout: 20000 });
  await sleep(500);
  return found;
}

/** The plans a card offers, in its order. */
function planNames(found) {
  return found.locator('fieldset label span:not(.visually-hidden)').allTextContents();
}

/** The card's prices or note, as laid out, spaces collapsed. */
async function pricesText(found) {
  return (await found.locator('.prices').innerText()).replace(/\s+/g, ' ').trim();
}

/** Chooses `name` among the card's plans with the arrow keys, from the plan chosen now. */
async function chooseByKeyboard(page, found, name) {
  await found.locator('fieldset input:checked').focus();
  const names = await planNames(found);
  const from = await found
    .locator('fieldset input')
    .evaluateAll((inputs) => inputs.findIndex((input) => input.checked));
  const to = names.indexOf(name);
  const key = to > from ? 'ArrowRight' : 'ArrowLeft';
  for (let step = 0; step < Math.abs(to - from); step++) await page.keyboard.press(key);
  await sleep(300);
}

async function run(browser, colorScheme, viewport) {
  const label = `${colorScheme} ${viewport.width}`;
  const { context, page } = await newPage(browser, label, colorScheme, viewport);
  try {
    await firstRun(page);

    for (const [province, plans, unlimited] of [
      ['Ontario', ['Talk and Text', 'Unlimited'], '$50.00'],
      ['Quebec', ['Talk and Text', 'Quebec Unlimited', 'Unlimited'], '$40.00'],
    ]) {
      if (province === 'Quebec') {
        // Settings' 📍 opens the location dialog, as a user moving province would.
        await page.goto(`${baseUrl}settings`);
        await page.getByRole('button', { name: /Ontario, Canada/ }).click();
        const dialog = page.locator('mat-dialog-container');
        await dialog.waitFor({ timeout: 20000 });
        await dialog
          .locator(
            'ss-choice-field[data-label="Province or territory"] .mat-mdc-text-field-wrapper',
          )
          .click();
        await page.getByRole('option', { name: 'Quebec', exact: true }).click();
        await page.locator('.cdk-overlay-pane mat-option').first().waitFor({ state: 'detached' });
        await dialog.getByRole('button', { name: 'Save' }).click();
        await dialog.waitFor({ state: 'detached' });
        await page.getByText('Quebec, Canada (CAD)').waitFor({ timeout: 20000 });
      }
      const where = `${label}, ${province}`;

      const mobileCard = await search(page, 'Example Mobile', 'Example Mobile');
      const names = await planNames(mobileCard);
      check(
        `${where}: Example Mobile offers the plans sold in ${province}, cheapest first`,
        JSON.stringify(names) === JSON.stringify(plans),
        JSON.stringify(names),
      );
      await chooseByKeyboard(page, mobileCard, 'Unlimited');
      const shown = await pricesText(mobileCard);
      check(
        `${where}: Unlimited, chosen with the arrow keys, costs ${province}'s ${unlimited}`,
        shown.startsWith(unlimited),
        shown,
      );
      await mobileCard.screenshot({
        path: path.join(
          outDir,
          `provinces-mobile-${province}-${colorScheme}-${viewport.width}.png`,
        ),
      });
      await axeCheck(page, `${where}, Search's Example Mobile`);
      await noSideScroll(page, viewport, `${where}, Search`);

      const creditCard = await search(page, 'Example Credit Union', 'Example Credit Union');
      const note = await pricesText(creditCard);
      check(
        `${where}: the credit union of British Columbia is "Not offered in ${province}"`,
        note === `Not offered in ${province}`,
        note,
      );

      await page.goto(`${baseUrl}settings`);
      const box = page.getByRole('checkbox', { name: `Show only what's sold in ${province}` });
      const named = await box.waitFor({ timeout: 20000 }).then(
        () => true,
        () => false,
      );
      const hint = await page.locator('#search-sold-hint').innerText();
      check(
        `${where}: Settings' Search default is named after ${province}`,
        named && hint.startsWith(`Search starts with its “Sold in ${province}” filter on.`),
        hint,
      );
      if (province === 'Ontario') await axeCheck(page, `${where}, Settings`);
    }
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

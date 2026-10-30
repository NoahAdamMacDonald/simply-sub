// The feedback after M10, part 2, item 11 (M10.23) in the system Edge on ng serve, for a Canadian in Alberta with a $20
// monthly and $300 annual budget, Work Related (Netflix Standard on the 12th) and Family (Crave Premium on the 31st), in
// both themes at 1280 and 360 px: the Lists overview's budget warning (both lists together over this month's budget),
// as Home has it; every list's This month and This year bars together, Home's amounts, on the right above Types from
// 960 px and above the cards under it; the warning's ✕ by keyboard hiding it here and on Home; with axe, screenshots,
// and no horizontal scroll.
// Usage: node check-m10-lists-budgets.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

const rates = {
  data: {
    base: 'CAD',
    date: '2026-10-26',
    source: 'European Central Bank via Frankfurter',
    rates: { CHF: 0.581, EUR: 0.6372, GBP: 0.5571, SEK: 7.097, USD: 0.7243 },
  },
  meta: { fetchedAt: '2026-10-26T06:00:02Z', stale: false },
};

async function firstRun(page) {
  await page.goto(baseUrl);
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor({ timeout: 20000 });
  await page
    .locator('mat-form-field', { has: page.locator('mat-label', { hasText: 'Province' }) })
    .locator('.mat-mdc-text-field-wrapper')
    .click();
  await page.getByRole('option', { name: 'Alberta', exact: true }).click();
  await page.locator('.cdk-overlay-pane mat-option').first().waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Get started' }).click();
  await dialog.waitFor({ state: 'detached' });
}

function readTable(page, table) {
  return page.evaluate(
    (store) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('simply-sub');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const rows = db.transaction(store).objectStore(store).getAll();
          rows.onsuccess = () => {
            db.close();
            resolve(rows.result);
          };
          rows.onerror = () => reject(rows.error);
        };
      }),
    table,
  );
}

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

const WORK = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const FAMILY = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };

async function plant(page) {
  const today = new Date();
  const day = (date) => date.toISOString().slice(0, 10);
  // Due later this month (or on the month's last day), so this month's total counts both.
  const due = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  await putRecord(page, 'lists', { id: WORK, name: 'Work Related', ...stamps });
  await putRecord(page, 'lists', { id: FAMILY, name: 'Family', ...stamps });
  const items = [
    [WORK, 'netflix.standard'],
    [FAMILY, 'crave.premium'],
  ];
  for (const [index, [listId, planId]] of items.entries()) {
    await putRecord(page, 'items', {
      id: `0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0${index}`,
      listId,
      source: { kind: 'catalog', planId },
      billing: {
        mode: 'recurring',
        interval: 'month',
        intervalCount: 1,
        anchorDate: day(due),
        autoRenew: true,
      },
      tagIds: [],
      rankOverrides: {},
      pinned: false,
      ...stamps,
    });
  }
  const [settings] = await readTable(page, 'settings');
  await putRecord(page, 'settings', { ...settings, monthlyBudget: 20, annualBudget: 300 });
}

async function axeCheck(page, label) {
  await sleep(600);
  await page.evaluate(axeSource);
  const result = await page.evaluate(() => axe.run(document));
  const problems = result.violations
    .filter(
      (violation) =>
        violation.id !== 'region' ||
        !violation.nodes.every((node) => node.target.join(' ').includes('cdk-overlay')),
    )
    .map(
      (violation) =>
        `${violation.id}: ${violation.nodes
          .map((node) => node.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`,
    );
  check(`axe: ${label}`, problems.length === 0, problems.join('; '));
}

async function noSideScroll(page, viewport, label) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`no horizontal scroll: ${label}`, width <= viewport.width, `${width}px`);
}

/** The warnings' and the bars' words, as screen readers get them, and the totals as shown. */
const warnings = (page, scope) =>
  page
    .locator(`${scope} ss-budget-warnings .warning .visually-hidden`)
    .allTextContents()
    .then((texts) => texts.map((text) => text.trim()));
const totals = (page, scope) =>
  page
    .locator(`${scope} ss-budget-totals .total [aria-hidden]`)
    .allTextContents()
    .then((texts) => texts.map((text) => text.trim()));

async function run(browser, colorScheme, viewport) {
  const label = `${colorScheme} ${viewport.width}`;
  const narrow = viewport === NARROW;
  const context = await browser.newContext({ locale: 'en-CA', colorScheme, viewport });
  await context.route('**/api/v1/fx?**', (route) => route.fulfill({ json: rates }));
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning')
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  try {
    await firstRun(page);
    await plant(page);

    // Home's warning and Budgets card, to compare.
    await page.goto(baseUrl);
    await until('Home’s warning', async () => (await warnings(page, 'ss-home-page')).length > 0);
    const homeWarnings = await warnings(page, 'ss-home-page');
    const homeTotals = await totals(page, 'ss-home-page .budgets');

    await page.goto(`${baseUrl}lists`);
    await until(
      'the overview’s warning',
      async () => (await warnings(page, 'ss-lists-overview-page')).length > 0,
    );
    const shown = await warnings(page, 'ss-lists-overview-page');
    check(
      `${label}: the overview warns of every list together, as Home does`,
      shown.length > 0 &&
        shown.join() === homeWarnings.join() &&
        /over your \$20\.00 monthly budget/.test(shown[0]),
      shown[0],
    );
    const overviewTotals = await totals(page, 'ss-lists-overview-page .money');
    check(
      `${label}: its bars show every list's this month and this year, Home's amounts`,
      overviewTotals.length === 2 && overviewTotals.join() === homeTotals.join(),
      `${overviewTotals.join(' / ')} vs ${homeTotals.join(' / ')}`,
    );

    const boxes = await page.evaluate(() => {
      const box = (selector) => {
        const element = document.querySelector(`ss-lists-overview-page ${selector}`);
        if (!element) return null;
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        money: box('.money'),
        types: box('.types'),
        card: box('li.card'),
        side: box('.side'),
      };
    });
    if (narrow) {
      check(
        `${label}: the bars come above the cards`,
        boxes.money.y + boxes.money.height <= boxes.card.y,
        JSON.stringify(boxes),
      );
    } else {
      check(
        `${label}: the bars on the right, above Types`,
        boxes.money.x > boxes.card.x + boxes.card.width &&
          Math.abs(boxes.money.x - boxes.side.x) < 1 &&
          boxes.money.y + boxes.money.height <= boxes.types.y,
        JSON.stringify(boxes),
      );
    }
    await axeCheck(page, `${label}: the overview with its warning and bars`);
    await noSideScroll(page, viewport, label);
    await page.screenshot({
      path: path.join(outDir, `lists-budgets-${label.replace(' ', '-')}.png`),
      fullPage: true,
    });

    // Its ✕ by keyboard: gone here, and on Home.
    await page.locator('ss-lists-overview-page ss-budget-warnings .dismiss').first().focus();
    await page.keyboard.press('Enter');
    await until(
      'the warning gone',
      async () => (await warnings(page, 'ss-lists-overview-page')).length < shown.length,
    );
    await page.goto(baseUrl);
    await page.locator('ss-home-page .budgets').waitFor();
    await sleep(800);
    check(
      `${label}: dismissed here, it's gone from Home too`,
      (await warnings(page, 'ss-home-page')).length === homeWarnings.length - 1,
    );
  } catch (error) {
    check(`${label}: ran to the end`, false, error.message.split('\n')[0]);
    await page.screenshot({ path: path.join(outDir, `failure-${label.replace(' ', '-')}.png`) });
  } finally {
    await context.close();
  }
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const colorScheme of ['light', 'dark']) {
      for (const viewport of [WIDE, NARROW]) await run(browser, colorScheme, viewport);
    }
  } finally {
    await browser.close();
  }
  check(
    'no console errors or warnings',
    consoleProblems.length === 0,
    consoleProblems.slice(0, 5).join(' | '),
  );
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} of ${checks.length} passed`);
  process.exitCode = failed > 0 ? 1 : 0;
})();

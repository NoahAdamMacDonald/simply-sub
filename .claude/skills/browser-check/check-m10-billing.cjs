// M10.28 in the system Edge on ng serve, for a Canadian in Alberta: Claude Pro's Canadian monthly price served as
// retired. List view's card and Home say it counts as yearly from Nov 12 with Check your billing; by keyboard Keep
// grandfathers it (Undo brings the check back) and Switch bills it yearly from its renewal; Ultra keeps "(formerly Max
// 20x)" until its renewal. Both themes at both widths, with axe and no horizontal scroll.
// Usage: node check-m10-billing.cjs <deps dir> <output dir> <base url ending in />
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

/** The focused control's aria-label, or its text. */
const focusedLabel = (page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    return element?.getAttribute('aria-label') ?? element?.textContent?.replace(/\s+/g, ' ').trim();
  });

async function tabTo(page, name, limit = 80) {
  for (let presses = 0; presses < limit; presses++) {
    if ((await focusedLabel(page)) === name) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Never reached ${name}`);
}

const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };
const LIST = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const PRO = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a00';
const ULTRA = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a01';

const item = (id, planId) => ({
  id,
  listId: LIST,
  source: { kind: 'catalog', planId },
  billing: {
    mode: 'recurring',
    interval: 'month',
    intervalCount: 1,
    anchorDate: '2026-11-12',
    autoRenew: true,
  },
  tagIds: [],
  rankOverrides: {},
  pinned: false,
  ...stamps,
});

async function plant(page) {
  await putRecord(page, 'lists', { id: LIST, name: 'Work Related', ...stamps });
  await putRecord(page, 'items', item(PRO, 'claude.pro'));
  await putRecord(page, 'items', item(ULTRA, 'claude.max-20x'));
}

/** Claude Pro's Canadian monthly price no longer sold, in whatever catalog file is asked for. */
async function retireProMonthly(context) {
  await context.route(/\/data\/catalog(\/[A-Z]+)?\.json$/, async (route) => {
    const response = await route.fetch();
    const snapshot = await response.json();
    for (const provider of snapshot.data.providers) {
      for (const plan of provider.plans) {
        if (plan.id !== 'claude.pro') continue;
        for (const price of plan.prices) {
          if (price.region === 'CA' && price.interval === 'month') price.retired = '2026-10-20';
        }
      }
    }
    await route.fulfill({ response, json: snapshot });
  });
}

const textOf = (locator) => locator.innerText().then((text) => text.replace(/\s+/g, ' ').trim());
const proBilling = async (page) =>
  (await readTable(page, 'items')).find((stored) => stored.id === PRO);

async function run(browser, colorScheme, viewport) {
  const label = `${colorScheme} ${viewport.width}`;
  const context = await browser.newContext({ locale: 'en-CA', colorScheme, viewport });
  await context.route('**/api/v1/fx?**', (route) => route.fulfill({ json: rates }));
  await retireProMonthly(context);
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning')
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  const shot = (name) => path.join(outDir, `${name}-${label.replace(' ', '-')}.png`);
  const expected =
    'Claude Pro isn’t sold billed monthly any more. From Nov 12, 2026 it counts as yearly, at $280.00.';
  try {
    await firstRun(page);
    await plant(page);

    // List view: the card's check, and Ultra's old name until its renewal.
    await page.goto(`${baseUrl}lists/${LIST}`);
    const check1 = page.locator('ss-item-card ss-billing-check');
    await check1.waitFor({ timeout: 30000 });
    check(
      `${label}: List view's card says what changes`,
      (await textOf(check1.locator('p > span').first())) === expected,
      await textOf(check1.locator('p > span').first()),
    );
    const ultra = page.locator('ss-item-card', { hasText: 'Ultra' });
    check(
      `${label}: Ultra keeps its old name until its renewal`,
      (await textOf(ultra.locator('.plan-name'))) === 'Ultra (formerly Max 20x)',
      await textOf(ultra.locator('.plan-name')),
    );
    await check1.screenshot({ path: shot('card-check') });
    await axeCheck(page, `${label}: List view`);
    await noSideScroll(page, viewport, `${label} List view`);

    // Home: the check, by keyboard: Keep, Undo, then Switch.
    await page.goto(baseUrl);
    const homeCheck = page.locator('.warnings ss-billing-check');
    await homeCheck.waitFor({ timeout: 30000 });
    check(
      `${label}: Home says it too`,
      (await textOf(homeCheck.locator('p > span').first())) === expected,
    );
    check(
      `${label}: its link goes to the plan's page`,
      (await homeCheck.locator('a').getAttribute('href')) === 'https://claude.com/pricing',
      await homeCheck.locator('a').getAttribute('href'),
    );
    await homeCheck.screenshot({ path: shot('home-check') });
    await axeCheck(page, `${label}: Home`);
    await noSideScroll(page, viewport, `${label} Home`);

    await page.locator('main').focus();
    await tabTo(page, 'Keep Claude Pro monthly');
    await page.keyboard.press('Enter');
    await until('grandfathered', async () => (await proBilling(page))?.grandfathered === true);
    await homeCheck.waitFor({ state: 'detached' });
    check(`${label}: Keep grandfathers it and ends the check`, true);
    const snack = page.locator('ss-snack');
    await snack.waitFor();
    await sleep(600);
    await axeCheck(page, `${label}: the snackbar`);
    await snack.getByRole('button', { name: 'Undo' }).click();
    await until('Undo', async () => (await proBilling(page))?.grandfathered === undefined);
    await homeCheck.waitFor({ timeout: 10000 });
    check(`${label}: Undo brings the check back`, true);

    await page.locator('main').focus();
    await tabTo(page, 'Switch Claude Pro to yearly');
    await page.keyboard.press('Enter');
    await until('switched', async () => (await proBilling(page))?.billing.interval === 'year');
    const billing = (await proBilling(page)).billing;
    check(
      `${label}: Switch bills it yearly from its renewal`,
      billing.interval === 'year' && billing.anchorDate === '2026-11-12',
      JSON.stringify(billing),
    );
    await homeCheck.waitFor({ state: 'detached' });
  } catch (error) {
    check(`${label}: ran to the end`, false, error.message.split('\n')[0]);
    await page.screenshot({ path: shot('failure') });
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

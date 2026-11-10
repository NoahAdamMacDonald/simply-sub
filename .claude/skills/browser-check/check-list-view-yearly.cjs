// List view's yearly total (P4, 2026-11-10) in the system Edge, on the real catalog (data:build's files) for a Canadian
// in Alberta with budgets of $60 a month and $500 a year: Streaming has Netflix Standard (all year) and Crave Premium
// from June 1, so this year's total and the next 12 months' differ. "Yearly total" is a labelled radio group of This
// year and Next 12 months above the totals, This year chosen by default; by keyboard alone, Tab reaches it and an arrow
// chooses Next 12 months, which the annual line names ("in the next 12 months"), its bar and breakdown follow, and
// this device keeps (settings.yearlyTotal in IndexedDB) through a reload; the annual budget warning still checks this
// calendar year. In both themes at 1280, 960 and 360 px, with axe, screenshots and no horizontal scroll. GET /fx is
// answered with fixed rates.
// Usage: node check-list-view-yearly.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
const fs = require('fs');
const path = require('path');

const [depsDir, outDir, baseUrl] = process.argv.slice(2);
const { chromium } = require(path.join(depsDir, 'node_modules', 'playwright-core'));
const axeSource = fs.readFileSync(
  path.join(depsDir, 'node_modules', 'axe-core', 'axe.min.js'),
  'utf8',
);
fs.mkdirSync(outDir, { recursive: true });

const checks = [];
const consoleProblems = [];
function check(name, ok, detail = '') {
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const LIST = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4f';
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };

const cadRates = { CHF: 0.581, EUR: 0.6372, GBP: 0.5571, SEK: 7.097, USD: 0.7243 };
function fxBody(base) {
  const perCad = (currency) => (currency === 'CAD' ? 1 : cadRates[currency]);
  const rates = Object.fromEntries(
    ['CAD', ...Object.keys(cadRates)]
      .filter((currency) => currency !== base)
      .map((currency) => [currency, Number((perCad(currency) / perCad(base)).toPrecision(6))]),
  );
  return {
    data: { base, date: '2026-10-26', source: 'European Central Bank via Frankfurter', rates },
    meta: { fetchedAt: '2026-10-26T06:00:02Z', stale: false },
  };
}

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

function idb(page, store, mode, value) {
  return page.evaluate(
    ([table, how, record]) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('simply-sub');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(table, how);
          const objects = transaction.objectStore(table);
          const result = how === 'readwrite' ? objects.put(record) : objects.getAll();
          transaction.oncomplete = () => {
            db.close();
            resolve(how === 'readwrite' ? undefined : result.result);
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    [store, mode, value],
  );
}
const readTable = (page, table) => idb(page, table, 'readonly');
const putRecord = (page, table, record) => idb(page, table, 'readwrite', record);

function item(id, planId, billing) {
  return {
    id,
    listId: LIST,
    source: { kind: 'catalog', planId },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      autoRenew: true,
      ...billing,
    },
    tagIds: [],
    rankOverrides: {},
    pinned: false,
    ...stamps,
  };
}

async function newContext(browser, colorScheme, viewport) {
  const context = await browser.newContext({
    locale: 'en-CA',
    colorScheme,
    viewport,
    serviceWorkers: 'block',
  });
  await context.route('**/api/v1/fx?**', (route) =>
    route.fulfill({ json: fxBody(new URL(route.request().url()).searchParams.get('base')) }),
  );
  const page = await context.newPage();
  const label = `${colorScheme} ${viewport.width}`;
  page.on('console', (msg) => {
    const blockedWorker = msg.text() === 'Service Worker registration blocked by Playwright';
    if ((msg.type() === 'error' || msg.type() === 'warning') && !blockedWorker) {
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  return { context, page };
}

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

async function plant(page) {
  const [settings] = await readTable(page, 'settings');
  await putRecord(page, 'settings', { ...settings, monthlyBudget: 60, annualBudget: 500 });
  await putRecord(page, 'lists', { id: LIST, name: 'Streaming', ...stamps });
  await putRecord(
    page,
    'items',
    item('0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a2b', 'netflix.standard', { anchorDate: '2026-11-12' }),
  );
  await putRecord(
    page,
    'items',
    item('0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a2c', 'crave.premium', {
      anchorDate: '2026-11-20',
      startDate: '2026-06-01',
    }),
  );
}

async function axeCheck(page, label) {
  await sleep(600);
  await page.evaluate(axeSource);
  const result = await page.evaluate(() => axe.run(document));
  const violations = result.violations.filter(
    (violation) =>
      violation.id !== 'region' ||
      !violation.nodes.every((node) => node.target.join(' ').includes('cdk-overlay')),
  );
  check(
    `axe: ${label}`,
    violations.length === 0,
    violations
      .map(
        (v) =>
          `${v.id}: ${v.nodes
            .slice(0, 3)
            .map((n) => `${n.target.join(' ')} ${n.any?.[0]?.message ?? ''}`)
            .join(' | ')}`,
      )
      .join('; '),
  );
}

async function noSideways(page, label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  check(`${label}: no horizontal scroll`, !overflow);
}

/** Presses Tab until `target` has focus, at most `limit` times. */
async function tabTo(page, target, limit = 80) {
  for (let presses = 0; presses < limit; presses++) {
    if (await target.evaluate((element) => element === document.activeElement)) return true;
    await page.keyboard.press('Tab');
    await sleep(40);
  }
  return target.evaluate((element) => element === document.activeElement);
}

/** The annual line's words, as shown. */
async function annualLine(page) {
  const totals = page.locator('ss-budget-totals').first();
  const lines = await totals.locator('.total [aria-hidden="true"]').allInnerTexts();
  return lines.find((line) => / of .+ in /.test(line)) ?? '';
}

async function run(browser, colorScheme, viewport) {
  const label = `${colorScheme} ${viewport.width}`;
  const { context, page } = await newContext(browser, colorScheme, viewport);
  try {
    await firstRun(page);
    await plant(page);
    await page.goto(`${baseUrl}lists/${LIST}`);
    await page.getByRole('heading', { name: 'Streaming' }).waitFor({ timeout: 20000 });
    await sleep(1500);

    const group = page.getByRole('radiogroup', { name: 'Yearly total' });
    const thisYear = group.getByRole('radio', { name: 'This year' });
    const next12 = group.getByRole('radio', { name: 'Next 12 months' });
    check(
      `${label}: "Yearly total" is a radio group of two`,
      (await group.getByRole('radio').count()) === 2,
    );
    check(
      `${label}: This year is chosen at first`,
      (await thisYear.getAttribute('aria-checked')) === 'true' &&
        (await next12.getAttribute('aria-checked')) === 'false',
    );
    const before = await annualLine(page);
    check(
      `${label}: the annual line names the year`,
      /^\$[\d,.]+ of \$500\.00 in 2026$/.test(before),
      before,
    );
    const warning = page.locator('ss-budget-warnings');
    const warned = (await warning.count()) ? (await warning.innerText()).replace(/\s+/g, ' ') : '';

    // The switch sits above the totals, inside the page's width.
    const [switchBox, totalsBox] = await Promise.all([
      page.locator('ss-yearly-total-switch').boundingBox(),
      page.locator('ss-budget-totals').first().boundingBox(),
    ]);
    check(
      `${label}: the switch is above the totals and inside the viewport`,
      switchBox !== null &&
        totalsBox !== null &&
        switchBox.y + switchBox.height <= totalsBox.y + 1 &&
        switchBox.x + switchBox.width <= viewport.width,
      JSON.stringify({ switchBox, totalsBox }),
    );
    await page.screenshot({
      path: path.join(outDir, `yearly-this-year-${colorScheme}-${viewport.width}.png`),
    });
    await axeCheck(page, `${label}, This year`);
    await noSideways(page, `${label} This year`);

    // Keyboard only: Tab to the chosen radio, an arrow to Next 12 months.
    await page.locator('h1').first().click();
    check(`${label}: Tab reaches the chosen choice`, await tabTo(page, thisYear));
    await page.keyboard.press('ArrowRight');
    await sleep(600);
    check(
      `${label}: an arrow chooses Next 12 months and keeps focus on it`,
      (await next12.getAttribute('aria-checked')) === 'true' &&
        (await next12.evaluate((element) => element === document.activeElement)),
    );
    const after = await annualLine(page);
    check(
      `${label}: the annual line names the next 12 months, at their total`,
      /^\$[\d,.]+ of \$500\.00 in the next 12 months$/.test(after) &&
        after.split(' ')[0] !== before.split(' ')[0],
      `${before} -> ${after}`,
    );
    check(
      `${label}: its breakdown adds up the next 12 months`,
      (await page.getByRole('button', { name: 'Breakdown of the next 12 months' }).count()) === 1,
    );
    const [settings] = await readTable(page, 'settings');
    check(
      `${label}: this device keeps the choice`,
      settings?.yearlyTotal === 'next-12-months',
      JSON.stringify(settings?.yearlyTotal),
    );
    const warnedAfter = (await warning.count())
      ? (await warning.innerText()).replace(/\s+/g, ' ')
      : '';
    check(
      `${label}: the annual warning still checks this calendar year`,
      warnedAfter === warned,
      warnedAfter,
    );
    await page.screenshot({
      path: path.join(outDir, `yearly-next-12-${colorScheme}-${viewport.width}.png`),
    });
    await axeCheck(page, `${label}, Next 12 months`);
    await noSideways(page, `${label} Next 12 months`);

    // A reload keeps it; an arrow back clears it.
    await page.reload();
    await page.getByRole('heading', { name: 'Streaming' }).waitFor({ timeout: 20000 });
    await sleep(1500);
    check(
      `${label}: a reload keeps Next 12 months`,
      (await next12.getAttribute('aria-checked')) === 'true' && (await annualLine(page)) === after,
    );
    await page.locator('h1').first().click();
    check(`${label}: Tab reaches Next 12 months`, await tabTo(page, next12));
    await page.keyboard.press('ArrowLeft');
    await sleep(600);
    const [cleared] = await readTable(page, 'settings');
    check(
      `${label}: an arrow back chooses This year, and the setting is left out again`,
      (await thisYear.getAttribute('aria-checked')) === 'true' &&
        (await annualLine(page)) === before &&
        !('yearlyTotal' in cleared),
    );
  } finally {
    await context.close();
  }
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const colorScheme of ['light', 'dark']) {
      for (const viewport of [
        { width: 1280, height: 900 },
        { width: 960, height: 900 },
        { width: 360, height: 900 },
      ]) {
        await run(browser, colorScheme, viewport);
      }
    }
  } finally {
    await browser.close();
  }
  check('no console errors or warnings', consoleProblems.length === 0, consoleProblems.join(' | '));
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

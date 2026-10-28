// M7.6 in the system Edge: the budget warning banners on `ng serve`, for a Canadian in Alberta with a $50 monthly and
// a $500 annual budget. It writes to IndexedDB Work Related (Netflix Standard on the 12th, Crave Premium billed on the
// 31st: $43.04 a month) and Family (Mullvad VPN, yearly on Jan 20, about $94.16, renewed by hand).
// In both themes at 1280 and 360 px, keyboard only:
// - Home, for every list together: January 2027 over the monthly budget (≈ $137.20) and this year over the annual one
//   (≈ $610.64), above the calendar, in a status region, each read with "Warning:"; Tab to "See January 2027 in the
//   Calendar" and Enter opens the Calendar on that month;
// - List view, for the list alone: Work Related only this year ($516.47), with no link; Family January 2027
//   (≈ $94.16), whose link opens the Calendar on it showing Family;
// - with the budgets raised to $200 and $1,000, no warning.
// With axe on each page with its warnings, and no horizontal scroll.
// Usage: node check-budget-banners.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

async function newPage(browser, label, { colorScheme = 'light', viewport = WIDE } = {}) {
  const context = await browser.newContext({ locale: 'en-CA', colorScheme, viewport });
  // GET /fx, answered with fixed rates, so no Worker is needed behind the dev proxy.
  await context.route('**/api/v1/fx?**', (route) =>
    route.fulfill({
      json: {
        data: {
          base: 'CAD',
          date: '2026-10-26',
          source: 'European Central Bank via Frankfurter',
          rates: { CHF: 0.581, EUR: 0.6372, GBP: 0.5571, SEK: 7.097, USD: 0.7243 },
        },
        meta: { fetchedAt: '2026-10-26T06:00:02Z', stale: false },
      },
    }),
  );
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  return { context, page };
}

/** Opens Home and completes the first-run dialog for Alberta. */
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

/** Every row of an IndexedDB table, as stored. */
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

/** Presses Tab until `isThere` holds for the focused element. */
async function tabTo(page, isThere, limit = 120) {
  let presses = 0;
  while (presses < limit && !(await page.evaluate(isThere))) {
    await page.keyboard.press('Tab');
    presses++;
  }
  if (!(await page.evaluate(isThere))) throw new Error(`Never reached: ${isThere}`);
}

/** Each warning as shown and as read, and its link. */
function warnings(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('ss-budget-warnings .warning')].map((warning) => {
      const link = warning.querySelector('a');
      return {
        shown: warning.querySelector('.text [aria-hidden="true"]')?.textContent.trim(),
        spoken: warning.querySelector('.text .visually-hidden')?.textContent.trim(),
        link: link ? `${link.textContent.trim()} → ${link.getAttribute('href')}` : undefined,
        status: warning.closest('[role="status"]') !== null,
      };
    }),
  );
}

const WORK = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const FAMILY = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };
const monthly = (anchorDate) => ({
  mode: 'recurring',
  interval: 'month',
  intervalCount: 1,
  anchorDate,
  autoRenew: true,
});

async function plant(page) {
  await putRecord(page, 'lists', { id: WORK, name: 'Work Related', ...stamps });
  await putRecord(page, 'lists', {
    id: FAMILY,
    name: 'Family',
    ...stamps,
    createdAt: '2026-10-21T12:00:00.000Z',
  });
  const items = [
    [WORK, 'netflix.standard', monthly('2026-11-12')],
    [WORK, 'crave.premium', monthly('2026-01-31')],
    [
      FAMILY,
      'mullvad.vpn',
      {
        mode: 'recurring',
        interval: 'year',
        intervalCount: 1,
        anchorDate: '2027-01-20',
        autoRenew: false,
      },
    ],
  ];
  for (const [index, [listId, planId, billing]] of items.entries()) {
    await putRecord(page, 'items', {
      id: `0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0${index}`,
      listId,
      source: { kind: 'catalog', planId },
      billing,
      tagIds: [],
      rankOverrides: {},
      pinned: false,
      ...stamps,
    });
  }
  await budgets(page, 50, 500);
}

/** Sets the budgets in the stored settings. */
async function budgets(page, monthlyBudget, annualBudget) {
  const [settings] = await readTable(page, 'settings');
  await putRecord(page, 'settings', { ...settings, monthlyBudget, annualBudget });
}

async function run(browser, colorScheme, viewport, width) {
  const label = `${colorScheme} ${width}`;
  const { context, page } = await newPage(browser, label, { colorScheme, viewport });
  await firstRun(page);
  await plant(page);
  await page.goto(baseUrl);
  await until('Home’s warnings', async () => (await warnings(page)).length === 2);
  const home = await warnings(page);
  check(
    `${label}: Home warns of January 2027 and this year, for every list together`,
    home[0].shown ===
      'Your payments in January 2027 add up to ≈ $137.20, over your $50.00 monthly budget.' &&
      home[1].shown ===
        'Your payments this year, past and to come, add up to ≈ $610.64, over your $500.00 annual budget.',
    home.map((warning) => warning.shown).join(' / '),
  );
  check(
    `${label}: each is read as a warning, in a status region, the monthly one with its link`,
    home.every(
      (warning) => warning.status && warning.spoken.startsWith('Warning: Your payments'),
    ) &&
      home[0].spoken.includes('about $137.20') &&
      home[0].link === 'See January 2027 in the Calendar → /calendar?month=2027-01' &&
      home[1].link === undefined,
    home.map((warning) => warning.link).join(' / '),
  );
  const above = await page.evaluate(() => {
    const banner = document.querySelector('ss-budget-warnings .warning')?.getBoundingClientRect();
    const calendar = document.querySelector('ss-mini-calendar')?.getBoundingClientRect();
    return banner !== undefined && calendar !== undefined && banner.bottom <= calendar.top;
  });
  check(`${label}: the warnings come above the calendar and the totals`, above);
  await page.screenshot({ path: path.join(outDir, `banners-home-${label}.png`) });
  await axeCheck(page, `${label}: Home with its warnings`);
  await noSideScroll(page, viewport, `${label}: Home`);
  await tabTo(page, () => document.activeElement?.matches('ss-budget-warnings a') ?? false);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/calendar\?month=2027-01$/);
  await page.locator('ss-page-header h1').waitFor();
  check(`${label}: Enter on the link opens the Calendar on January 2027`, true, page.url());

  await page.goto(`${baseUrl}lists/${WORK}`);
  await page.locator('ss-item-card').first().waitFor();
  const work = await until('Work Related’s warning', async () => {
    const found = await warnings(page);
    return found.length > 0 ? found : undefined;
  });
  check(
    `${label}: Work Related warns of its own year only, with no link`,
    work.length === 1 &&
      work[0].shown ===
        'This list’s payments this year, past and to come, add up to $516.47, over your $500.00 annual budget.' &&
      work[0].link === undefined,
    work.map((warning) => warning.shown).join(' / '),
  );
  await page.goto(`${baseUrl}lists/${FAMILY}`);
  await page.locator('ss-item-card').first().waitFor();
  const family = await until('Family’s warning', async () => {
    const found = await warnings(page);
    return found.length > 0 ? found : undefined;
  });
  check(
    `${label}: Family warns of January 2027, its link showing Family alone`,
    family.length === 1 &&
      family[0].shown ===
        'This list’s payments in January 2027 add up to ≈ $94.16, over your $50.00 monthly budget.' &&
      family[0].link ===
        `See January 2027 in the Calendar → /calendar?month=2027-01&lists=${FAMILY}`,
    family.map((warning) => `${warning.shown} ${warning.link}`).join(' / '),
  );
  await page.screenshot({ path: path.join(outDir, `banners-list-${label}.png`) });
  await axeCheck(page, `${label}: List view with its warning`);
  await noSideScroll(page, viewport, `${label}: List view`);
  await tabTo(page, () => document.activeElement?.matches('ss-budget-warnings a') ?? false);
  await page.keyboard.press('Enter');
  await page.waitForURL(new RegExp(`/calendar\\?month=2027-01&lists=${FAMILY}$`));
  const shown = await page.locator('mat-select-trigger').first().innerText();
  check(
    `${label}: the Calendar opens on January 2027, showing Family`,
    shown.trim() === 'Family',
    shown,
  );

  await budgets(page, 200, 1000);
  await page.goto(baseUrl);
  await page.locator('ss-budget-totals').first().waitFor();
  await sleep(1000);
  check(
    `${label}: within budget, Home has no warning`,
    (await warnings(page)).length === 0 &&
      (await page.locator('ss-budget-warnings [role="status"]').count()) === 1,
  );
  await context.close();
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  for (const colorScheme of ['light', 'dark']) {
    await run(browser, colorScheme, WIDE, 'wide');
    await run(browser, colorScheme, NARROW, 'narrow');
  }
  await browser.close();

  check('no console errors or warnings', consoleProblems.length === 0, consoleProblems.join(' | '));
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

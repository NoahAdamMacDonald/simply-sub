// M7.3 in the system Edge: Home (P2) on `ng serve`, for a Canadian in Alberta, with no lists, then with Work Related
// (Netflix Standard, monthly on the 12th) and Family (Mullvad VPN, yearly on Jan 20, renewed by hand) written to
// IndexedDB.
// In both themes at 1280 and 360 px, keyboard only:
// - no lists: the empty state's Create a list, Browse services and Import backup, Enter on the first;
// - the mini calendar's dot on the 12th of this month, reached with the arrow keys from today, its tooltip naming
//   Netflix as charged, and Enter opening the Calendar on that month;
// - every list's totals without budgets, with "Set a monthly budget →" taking Enter to Settings, and with budgets
//   (written to the settings, then a reload) a bar for each, the monthly one over its budget;
// - Subscription Lists by keyboard, and the next three payments;
// - the calendar beside the totals at 1280 px and above them at 360.
// Then, light at 1280 px, Home's totals against the sum of the Lists overview's cards (P2's acceptance).
// With axe on each state, and no horizontal scroll.
// Usage: node check-home.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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
  // Material renders menus, dialogs, tooltips and snackbars outside the page's landmarks (the skill's gotchas): set
  // aside `region` hits that are all inside its overlay container.
  const violations = result.violations.filter(
    (violation) =>
      violation.id !== 'region' ||
      !violation.nodes.every((node) => node.target.join(' ').includes('cdk-overlay')),
  );
  const problems = violations.map(
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

/** Presses `key` (Tab by default) until `isThere` holds for the focused element; the number of presses. */
async function keyTo(page, isThere, key = 'Tab', limit = 80) {
  let presses = 0;
  while (presses < limit && !(await page.evaluate(isThere))) {
    await page.keyboard.press(key);
    presses++;
  }
  if (!(await page.evaluate(isThere))) throw new Error(`Never reached: ${isThere}`);
  return presses;
}

const LIST = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const FAMILY = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';
const NETFLIX = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0b';
const MULLVAD = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0c';
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };

async function plant(page) {
  await putRecord(page, 'lists', { id: LIST, name: 'Work Related', ...stamps });
  await putRecord(page, 'lists', {
    id: FAMILY,
    name: 'Family',
    ...stamps,
    createdAt: '2026-10-21T12:00:00.000Z',
  });
  const item = { tagIds: [], rankOverrides: {}, pinned: false, ...stamps };
  await putRecord(page, 'items', {
    id: NETFLIX,
    listId: LIST,
    source: { kind: 'catalog', planId: 'netflix.standard' },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-11-12',
      autoRenew: true,
    },
    ...item,
  });
  await putRecord(page, 'items', {
    id: MULLVAD,
    listId: FAMILY,
    source: { kind: 'catalog', planId: 'mullvad.vpn' },
    billing: {
      mode: 'recurring',
      interval: 'year',
      intervalCount: 1,
      anchorDate: '2027-01-20',
      autoRenew: false,
    },
    ...item,
  });
}

const home = (page) => page.locator('ss-home-page');
const totals = (page) =>
  home(page)
    .locator('ss-budget-totals .total [aria-hidden]')
    .evaluateAll((spans) => spans.map((span) => span.textContent.trim()));
const focused = (page) =>
  page.evaluate(() => ({
    date: document.activeElement?.getAttribute('data-date'),
    text: document.activeElement?.textContent?.trim(),
    label: document.activeElement?.getAttribute('aria-label'),
    href: document.activeElement?.getAttribute('href'),
  }));
const pathOf = (page) => new URL(page.url()).pathname;
/** Today on this machine, as the app's clock reads it. */
const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  const today = localToday();
  const month = today.slice(0, 7);
  const payday = `${month}-12`;

  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [WIDE, NARROW]) {
      const label = `${colorScheme} ${viewport.width}`;
      const shot = (name) => path.join(outDir, `${name}-${colorScheme}-${viewport.width}.png`);
      const { context, page } = await newPage(browser, label, { colorScheme, viewport });
      await firstRun(page);

      // ── No lists: the empty state ──────────────────────────────────────────────────────────────
      await home(page).locator('ss-empty-state').waitFor({ timeout: 20000 });
      const actions = await home(page)
        .locator('ss-empty-state [actions] a, ss-empty-state [actions] button')
        .evaluateAll((elements) =>
          elements.map((element) => element.textContent.replace(/^\s*\w+\s+/, '').trim()),
        );
      check(
        `${label}: with no lists, Home offers Create a list, Browse services and Import backup`,
        actions.join(' | ') === 'Create a list | Browse services | Import backup' &&
          (await home(page).locator('h1').textContent()).trim() === 'Home',
        actions.join(' | '),
      );
      await noSideScroll(page, viewport, `${label}, no lists`);
      await page.screenshot({ path: shot('home-empty'), fullPage: true });
      await axeCheck(page, `${label}, no lists`);
      await page.locator('main').focus();
      await keyTo(page, `document.activeElement?.getAttribute('href') === '/lists/new'`);
      await page.keyboard.press('Enter');
      await until('a new list’s editor', () => /\/lists\/.+\/edit$/.test(pathOf(page)));
      check(`${label}: Enter on Create a list opens a new list's editor`, true);

      // ── Two lists ─────────────────────────────────────────────────────────────────────────────
      await plant(page);
      await page.goto(baseUrl);
      await home(page).locator('ss-mini-calendar').waitFor({ timeout: 20000 });
      await until('the dots', async () => (await home(page).locator('.day.paid').count()) > 0);
      const paid = await home(page)
        .locator('.day.paid')
        .evaluateAll((days) => days.map((day) => day.getAttribute('data-date')));
      check(
        `${label}: the mini calendar has a dot on the 12th, Netflix's day`,
        paid.join() === payday,
        paid.join(),
      );
      // Netflix's $18.99 with Alberta's 5% each month; Mullvad's €60 a year (tax included), on Jan 20.
      await until('the totals', async () => (await totals(page)).length === 2);
      check(
        `${label}: every list's totals, this month's and this year's, without budgets`,
        (await totals(page)).join(' | ') ===
          `$19.94 this month | ≈ $333.44 in ${month.slice(0, 4)}` &&
          (await home(page).locator('ss-budget-bar').count()) === 0,
        (await totals(page)).join(' | '),
      );
      const next = await home(page)
        .locator('.next li')
        .evaluateAll((items) =>
          items.map((item) => {
            const copy = item.cloneNode(true);
            copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
            return copy.textContent.replace(/\s+/g, ' ').trim();
          }),
        );
      check(
        `${label}: Next payments lists the next three, as charged`,
        next.length === 3 &&
          next.every((payment) =>
            /Netflix \$19\.94$|Mullvad VPN about \$94\.16, renew manually$/.test(payment),
          ),
        next.join(' | '),
      );
      // The calendar beside the totals from 720 px, above them on a phone.
      const calendarBox = await home(page).locator('.calendar').boundingBox();
      const budgetsBox = await home(page).locator('.budgets').boundingBox();
      check(
        `${label}: the calendar is ${viewport.width < 720 ? 'above' : 'beside'} the totals`,
        viewport.width < 720
          ? calendarBox.y + calendarBox.height <= budgetsBox.y
          : calendarBox.x + calendarBox.width <= budgetsBox.x,
      );
      await noSideScroll(page, viewport, `${label}, Home`);
      await page.screenshot({ path: shot('home'), fullPage: true });
      await axeCheck(page, `${label}, Home`);

      // The mini calendar by keyboard: the grid's one tab stop is today; the arrows reach the 12th, whose tooltip
      // names what's charged, and Enter opens the Calendar on its month.
      await page.locator('main').focus();
      await keyTo(page, `document.activeElement?.classList.contains('day')`);
      check(
        `${label}: the grid's tab stop is today`,
        (await focused(page)).date === today,
        (await focused(page)).date,
      );
      const steps = Number(today.slice(8)) - 12;
      for (let i = 0; i < Math.abs(steps); i++) {
        await page.keyboard.press(steps > 0 ? 'ArrowLeft' : 'ArrowRight');
      }
      await until('the 12th', async () => (await focused(page)).date === payday);
      const tooltip = page.locator('.mat-mdc-tooltip-show');
      await until('its tooltip', async () => (await tooltip.count()) > 0);
      check(
        `${label}: the 12th is named with its payment, and its tooltip names Netflix as charged`,
        /, 1 payment$/.test((await focused(page)).label) &&
          (await tooltip.textContent()).trim() === 'Netflix $19.94',
        `${(await focused(page)).label} / ${(await tooltip.textContent()).trim()}`,
      );
      await page.screenshot({ path: shot('home-tooltip') });
      await axeCheck(page, `${label}, the day's tooltip`);
      await page.keyboard.press('Enter');
      await until('the Calendar', () => page.url().includes(`/calendar?month=${month}`));
      check(`${label}: Enter on a day opens the Calendar on its month`, true);
      await page.goBack();
      await home(page).locator('ss-mini-calendar').waitFor({ timeout: 20000 });

      // Set a monthly budget →, by keyboard.
      await page.locator('main').focus();
      await keyTo(page, `document.activeElement?.textContent?.trim() === 'Set a monthly budget →'`);
      await page.keyboard.press('Enter');
      await until('Settings', () => pathOf(page) === '/settings');
      check(`${label}: "Set a monthly budget →" goes to Settings`, true);

      // With budgets: a bar for each, the monthly one over its $15.
      const [settings] = await readTable(page, 'settings');
      await putRecord(page, 'settings', { ...settings, monthlyBudget: 15, annualBudget: 1000 });
      await page.goto(baseUrl);
      await until(
        'the bars',
        async () => (await home(page).locator('ss-budget-bar').count()) === 2,
      );
      const bars = await home(page)
        .locator('ss-budget-bar')
        .evaluateAll((elements) =>
          elements.map(
            (bar) =>
              `${document.getElementById(bar.getAttribute('aria-labelledby')).textContent.trim()}: ${bar.getAttribute('data-level')} ${bar.querySelector('.label').textContent.trim()}`,
          ),
        );
      check(
        `${label}: with budgets, a bar for each against every list's totals, over the budget in red`,
        bars.join(' | ') === 'Monthly budget: over 133% | Annual budget: ok 33%' &&
          (await home(page).locator('a.prompt').count()) === 0,
        bars.join(' | '),
      );
      await noSideScroll(page, viewport, `${label}, with budgets`);
      await page.screenshot({ path: shot('home-budgets'), fullPage: true });
      await axeCheck(page, `${label}, with budgets`);

      // Subscription Lists, by keyboard.
      await page.locator('main').focus();
      await keyTo(page, `document.activeElement?.classList.contains('lists-button')`);
      await page.keyboard.press('Enter');
      await until('Lists', () => pathOf(page) === '/lists');
      check(`${label}: Subscription Lists opens the Lists overview`, true);

      // ── Home's totals are the sum of every list's (P2) ──────────────────────────────────────────
      if (colorScheme === 'light' && viewport === WIDE) {
        const cards = page.locator('ss-lists-overview-page li.card');
        await until('both cards', async () => (await cards.count()) === 2);
        await until('their totals', async () => (await cards.locator('.total').count()) === 4);
        const amounts = await cards.evaluateAll((elements) =>
          elements.map((card) =>
            [...card.querySelectorAll('.total [aria-hidden]')].map((span) =>
              Number(span.textContent.replace(/[^\d.]/g, '')),
            ),
          ),
        );
        await page.goto(baseUrl);
        await until('Home’s totals', async () => (await totals(page)).length === 2);
        const homeAmounts = (await totals(page)).map((total) =>
          Number(total.split(' of ')[0].replace(/[^\d.]/g, '')),
        );
        const sum = (index) =>
          Math.round(amounts.reduce((total, card) => total + card[index], 0) * 100) / 100;
        // Each total is rounded for display from full precision (§3.1), so the cards' rounded amounts can add up to a
        // cent a list away from Home's; the unit specs check the sums exactly.
        const near = (a, b) => Math.abs(a - b) <= 0.01 * amounts.length + 1e-9;
        check(
          "Home's this month and this year are the sum of every list's, to the cent each was rounded to",
          near(homeAmounts[0], sum(0)) && near(homeAmounts[1], sum(1)),
          `${homeAmounts.join(', ')} / ${sum(0)}, ${sum(1)}`,
        );
      }
      await context.close();
    }
  }

  await browser.close();
  check('no console errors or warnings', consoleProblems.length === 0, consoleProblems.join(' | '));
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((error) => {
  console.error(error);
  if (consoleProblems.length > 0) console.error(consoleProblems.join(' | '));
  process.exit(1);
});

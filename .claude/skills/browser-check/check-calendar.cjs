// M7.4 in the system Edge: the Calendar (P10) and List view's mini calendar on `ng serve`, for a Canadian in Alberta
// with a $60 monthly budget. It writes to IndexedDB Work Related (Netflix Standard, monthly on the 12th; Crave Premium,
// billed on the 31st since Jan 31) and Family (Mullvad VPN, yearly on Jan 20, renewed by hand; Netflix Standard with
// ads on Specific dates, Sep 2 to Nov 1 every year).
// In both themes at 1280 and 360 px, keyboard only:
// - the charges on their days: October's 2nd (the window's), 12th and 31st; November's 12th and 30th (the 31st's month
//   end) with no window charge; February 2027's 12th and 28th;
// - the bar: a past month paid in full, a future one at nothing, this one in between, and the budget's tick;
// - at 1280 px the grid by keyboard: today's tab stop, the arrows to the 12th, Enter opening its panel (focus on its
//   heading; the charge, its list link and how it renews), Escape putting focus back, Page Down to the next month;
// - at 360 px the agenda by date, and Enter on a payment opening its day in a bottom sheet, which Escape closes;
// - Showing by keyboard: Family alone, in the URL and remembered after a reload; Next month and Today;
// - Home's dots on the same days as the Calendar's chips this month; List view's mini calendar with the list's days,
//   folded under 960 px behind its button.
// With axe on the page, the panel, the open select, the bottom sheet and List view, and no horizontal scroll.
// Usage: node check-calendar.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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
  // Material renders menus, select panels, dialogs and sheets outside the page's landmarks (the skill's gotchas): set
  // aside `region` hits that are all inside its overlay container. An open select's panel covers what's under it, whose
  // text axe then measures against the panel: set aside contrast hits on text under a popup, as check-list-view.cjs does.
  const hidden = await page.evaluate(
    (targets) =>
      targets.map((target) => {
        const element = document.querySelector(target);
        if (!element) return false;
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return (
          (top?.closest('.cdk-overlay-pane') ?? null) !== null &&
          !element.closest('.cdk-overlay-pane')
        );
      }),
    (result.violations.find((violation) => violation.id === 'color-contrast')?.nodes ?? []).map(
      (node) => node.target.join(' '),
    ),
  );
  const violations = result.violations
    .map((violation) =>
      violation.id === 'color-contrast'
        ? { ...violation, nodes: violation.nodes.filter((_, index) => !hidden[index]) }
        : violation,
    )
    .filter(
      (violation) =>
        violation.nodes.length > 0 &&
        (violation.id !== 'region' ||
          !violation.nodes.every((node) => node.target.join(' ').includes('cdk-overlay'))),
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

/** Presses `key` (Tab by default) until `isThere` holds for the focused element. */
async function keyTo(page, isThere, key = 'Tab', limit = 120) {
  let presses = 0;
  while (presses < limit && !(await page.evaluate(isThere))) {
    await page.keyboard.press(key);
    presses++;
  }
  if (!(await page.evaluate(isThere))) throw new Error(`Never reached: ${isThere}`);
}

const WORK = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const FAMILY = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };
const monthly = (anchorDate, extra = {}) => ({
  mode: 'recurring',
  interval: 'month',
  intervalCount: 1,
  anchorDate,
  autoRenew: true,
  ...extra,
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
    [
      FAMILY,
      'netflix.standard-ads',
      {
        mode: 'limited',
        windows: [{ start: '2026-09-02', end: '2026-11-01', repeatYearly: true }],
        interval: 'month',
        intervalCount: 1,
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
  const [settings] = await readTable(page, 'settings');
  await putRecord(page, 'settings', { ...settings, monthlyBudget: 60 });
}

const calendar = (page) => page.locator('ss-calendar-page');
/** The days with chips, as "12: 19.94", or the agenda's dates. */
const chipDays = (page) =>
  calendar(page)
    .locator('.cell')
    .evaluateAll((cells) =>
      cells.flatMap((cell) => {
        const chips = [...cell.querySelectorAll('.chip-amount')];
        const date = cell.querySelector('.day').getAttribute('data-date');
        return chips.length === 0 ? [] : [`${Number(date.slice(8))}`];
      }),
    );
const agendaDays = (page) =>
  calendar(page)
    .locator('.agenda-day')
    .evaluateAll((days) =>
      days.map((day) => day.getAttribute('aria-labelledby').slice('agenda-'.length)),
    );
const daysShown = async (page, viewport) =>
  viewport === NARROW
    ? (await agendaDays(page)).map((date) => `${Number(date.slice(8))}`)
    : chipDays(page);
const barText = (page) =>
  calendar(page).locator('.month-bar ss-budget-bar').getAttribute('aria-valuetext');
const pathAndQuery = (page) => {
  const url = new URL(page.url());
  return `${url.pathname}${decodeURIComponent(url.search)}`;
};
const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  const today = localToday();
  const thisMonth = today.slice(0, 7);

  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [WIDE, NARROW]) {
      const label = `${colorScheme} ${viewport.width}`;
      const shot = (name) => path.join(outDir, `${name}-${colorScheme}-${viewport.width}.png`);
      const { context, page } = await newPage(browser, label, { colorScheme, viewport });
      await firstRun(page);
      await plant(page);

      // ── The charges on their days ─────────────────────────────────────────────────────────────
      for (const [month, expected] of [
        ['2026-10', ['2', '12', '31']],
        // The 31st's month end, and the window ended on Nov 1.
        ['2026-11', ['12', '30']],
        ['2027-02', ['12', '28']],
      ]) {
        await page.goto(`${baseUrl}calendar?month=${month}`);
        await calendar(page).locator('.month-bar').waitFor({ timeout: 20000 });
        await until(
          `${month}'s days`,
          async () => (await daysShown(page, viewport)).length > 0,
        ).catch(() => false);
        const shown = await daysShown(page, viewport);
        check(
          `${label}: ${month}'s charges are on ${expected.join(', ')}`,
          shown.join() === expected.join(),
          shown.join(),
        );
      }

      // ── The bar: past, future and this month ──────────────────────────────────────────────────
      await page.goto(`${baseUrl}calendar?month=2026-09`);
      await until('the bar', async () => (await barText(page))?.includes('of'));
      const past = await barText(page);
      const [paid, total] = past.split(', budget')[0].split(' of ');
      check(`${label}: a past month is paid in full`, paid === total, past);
      await page.goto(`${baseUrl}calendar?month=2026-12`);
      await until('the bar', async () => (await barText(page))?.startsWith('$0.00 of $'));
      check(`${label}: a future month has nothing paid yet`, true, await barText(page));
      await page.goto(`${baseUrl}calendar?month=${thisMonth}`);
      await until('the bar', async () => (await barText(page))?.includes('budget $60.00'));
      const current = await barText(page);
      const [paidNow, totalNow] = current
        .split(', budget')[0]
        .split(' of ')
        .map((amount) => Number(amount.replace(/[^\d.]/g, '')));
      check(
        `${label}: this month is paid up to today, against the budget's tick`,
        paidNow <= totalNow &&
          (await calendar(page).locator('.month-bar .marker').count()) === (totalNow >= 60 ? 1 : 0),
        current,
      );
      await noSideScroll(page, viewport, `${label}, the Calendar`);
      await page.screenshot({ path: shot('calendar'), fullPage: true });
      await axeCheck(page, `${label}, the Calendar`);

      if (viewport === WIDE) {
        // ── The grid by keyboard ──────────────────────────────────────────────────────────────
        await page.goto(`${baseUrl}calendar?month=${thisMonth}`);
        await until('the chips', async () => (await chipDays(page)).length > 0);
        await page.locator('main').focus();
        await keyTo(page, `document.activeElement?.classList.contains('day')`);
        const focusedDate = () =>
          page.evaluate(() => document.activeElement?.getAttribute('data-date'));
        check(
          `${label}: the grid's one tab stop is today`,
          (await focusedDate()) === today,
          await focusedDate(),
        );
        const steps = Number(today.slice(8)) - 12;
        for (let i = 0; i < Math.abs(steps); i++) {
          await page.keyboard.press(steps > 0 ? 'ArrowLeft' : 'ArrowRight');
        }
        await until('the 12th', async () => (await focusedDate()) === `${thisMonth}-12`);
        await page.keyboard.press('Enter');
        const panel = calendar(page).locator('ss-day-panel');
        await panel.waitFor();
        await until('focus on its heading', () =>
          page.evaluate(() => document.activeElement?.matches('ss-day-panel h2') === true),
        );
        const titles = await panel.locator('h3').allTextContents();
        check(
          `${label}: Enter opens the day's panel, focus on its heading, with Netflix, its list and its renewal`,
          titles.map((title) => title.trim()).join() === 'Netflix Standard' &&
            (await panel.locator('.list a').getAttribute('href')) === `/lists/${WORK}` &&
            (await panel.locator('.renewal').textContent()).trim() === 'Renews automatically',
          titles.join(),
        );
        await page.screenshot({ path: shot('calendar-panel') });
        await axeCheck(page, `${label}, the day's panel`);
        await page.keyboard.press('Escape');
        await panel.waitFor({ state: 'detached' });
        await until(
          'focus back on the day',
          async () => (await focusedDate()) === `${thisMonth}-12`,
        );
        check(`${label}: Escape closes the panel and puts focus back on the day`, true);
        await page.keyboard.press('PageDown');
        const nextMonth = new Date(`${thisMonth}-01T00:00:00Z`);
        nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
        const next = nextMonth.toISOString().slice(0, 7);
        await until('the next month', async () => (await focusedDate()) === `${next}-12`);
        check(
          `${label}: Page Down moves to the next month, in the URL`,
          pathAndQuery(page) === `/calendar?month=${next}`,
          pathAndQuery(page),
        );
      } else {
        // ── The agenda and its bottom sheet ───────────────────────────────────────────────────
        await page.goto(`${baseUrl}calendar?month=2026-10`);
        await until('the agenda', async () => (await agendaDays(page)).length === 3);
        check(
          `${label}: under 600 px the month is an agenda by date, with no grid`,
          (await calendar(page).locator('.grid').count()) === 0,
        );
        await page.locator('main').focus();
        await keyTo(page, `document.activeElement?.classList.contains('entry')`);
        await page.keyboard.press('Enter');
        const sheet = page.locator('ss-day-sheet');
        await sheet.waitFor();
        await until('focus in the sheet', () =>
          page.evaluate(() => !!document.activeElement?.closest('ss-day-sheet')),
        );
        // It slides up: wait for it to settle before judging it.
        await sleep(600);
        check(
          `${label}: a payment opens its day in a bottom sheet, focus on its payment's name`,
          (await sheet.locator('h2').textContent()).trim() === 'Friday, October 2' &&
            (await page.evaluate(() => document.activeElement?.matches('ss-day-sheet h3'))),
        );
        await page.screenshot({ path: shot('calendar-sheet') });
        await axeCheck(page, `${label}, the bottom sheet`);
        await page.keyboard.press('Escape');
        await sheet.waitFor({ state: 'detached' });
        check(`${label}: Escape closes the sheet`, true);
      }

      // ── Showing, by keyboard: Family alone, in the URL and remembered ──────────────────────────
      await page.goto(`${baseUrl}calendar?month=2026-10`);
      await calendar(page).locator('mat-select').first().waitFor();
      await page.locator('main').focus();
      await keyTo(page, `document.activeElement?.getAttribute('role') === 'combobox'`);
      await page.keyboard.press('Enter');
      const options = page.locator('mat-option');
      await options.first().waitFor();
      await sleep(400);
      await axeCheck(page, `${label}, Showing open`);
      // Focus starts on the first option, Work Related: Space unticks it.
      await page.keyboard.press('Space');
      await page.keyboard.press('Escape');
      await until(
        'the URL',
        async () => pathAndQuery(page) === `/calendar?month=2026-10&lists=${FAMILY}`,
      );
      await until('Family’s days', async () => (await daysShown(page, viewport)).join() === '2');
      const [saved] = await readTable(page, 'settings');
      check(
        `${label}: Showing Family alone puts it in the URL and remembers Work Related left out`,
        JSON.stringify(saved.calendarHiddenLists) === JSON.stringify([WORK]),
        JSON.stringify(saved.calendarHiddenLists),
      );
      await page.goto(`${baseUrl}calendar?month=2026-10`);
      await until('remembered', async () => (await daysShown(page, viewport)).join() === '2');
      check(
        `${label}: with no lists in the URL, the Calendar shows what it last showed here`,
        true,
      );

      // Next month and Today, by keyboard.
      await page.locator('main').focus();
      await keyTo(page, `document.activeElement?.getAttribute('aria-label') === 'Next month'`);
      await page.keyboard.press('Enter');
      await until('November', async () => pathAndQuery(page).startsWith('/calendar?month=2026-11'));
      await keyTo(page, `document.activeElement?.textContent?.trim() === 'Today'`);
      await page.keyboard.press('Enter');
      await until('this month', async () =>
        pathAndQuery(page).startsWith(`/calendar?month=${thisMonth}`),
      );
      check(`${label}: Next month and Today move the month, in the URL`, true);

      // ── Home's dots and List view's mini calendar ───────────────────────────────────────────────
      // Every list again on the Calendar, then this month's chips against Home's dots.
      const [current2] = await readTable(page, 'settings');
      delete current2.calendarHiddenLists;
      await putRecord(page, 'settings', current2);
      await page.goto(`${baseUrl}calendar?month=${thisMonth}`);
      await until('every list', async () => (await daysShown(page, viewport)).length > 0);
      const calendarDays = await daysShown(page, viewport);
      await page.goto(baseUrl);
      await page.locator('ss-home-page .day.paid').first().waitFor({ timeout: 20000 });
      const homeDays = await page
        .locator('ss-home-page .day.paid')
        .evaluateAll((days) =>
          days.map((day) => `${Number(day.getAttribute('data-date').slice(8))}`),
        );
      check(
        `${label}: Home's dots are on the Calendar's days`,
        homeDays.join() === calendarDays.join(),
        `${homeDays.join()} / ${calendarDays.join()}`,
      );

      await page.goto(`${baseUrl}lists/${WORK}`);
      await page.locator('ss-list-view-page .list-calendar').waitFor({ timeout: 20000 });
      const body = page.locator('ss-list-view-page .calendar-body');
      if (viewport === NARROW) {
        check(`${label}: List view's calendar is folded under 960 px`, !(await body.isVisible()));
        await page.locator('main').focus();
        await keyTo(page, `document.activeElement?.classList.contains('calendar-toggle')`);
        await page.keyboard.press('Enter');
        await until('it opens', () => body.isVisible());
        check(
          `${label}: its button opens it`,
          (await page
            .locator('ss-list-view-page .calendar-toggle')
            .getAttribute('aria-expanded')) === 'true',
        );
      }
      await until('its dots', async () => (await body.locator('.day.paid').count()) > 0);
      const listDays = await body
        .locator('.day.paid')
        .evaluateAll((days) =>
          days.map((day) => `${Number(day.getAttribute('data-date').slice(8))}`),
        );
      check(
        `${label}: List view's mini calendar has its own list's days (Netflix's 12th, Crave's month end)`,
        listDays.includes('12') && !listDays.includes('2'),
        listDays.join(),
      );
      await noSideScroll(page, viewport, `${label}, List view`);
      await axeCheck(page, `${label}, List view with its calendar`);
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

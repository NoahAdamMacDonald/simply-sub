// The feedback after M10, part 2, items 7 and 8 (M10.20) in the system Edge on ng serve, for a Canadian in Alberta
// with Work Related (Netflix on the 12th, Crave on the 31st) and Family (Mullvad, Netflix with ads in Sep and Oct), in
// both themes at 1280 and 360 px:
// - the Calendar's controls: Month and Year first, then Today, then ‹, the month, the year and ›, in that Tab order;
//   at 1280 px Month, Year and Today don't move when the view changes, and the arrows end the row; at 360 px Month and
//   Year on Today's row, Today at its end, and the arrows on a row of their own;
// - the year view's month cards: a click anywhere on one (its days, its total, its strip) opens its month, with the
//   pointer cursor over all of it and no text selected by a double click; Tab reaches the cards after ›;
// with axe on both views, screenshots, and no horizontal scroll.
// Usage: node check-m10-calendar-controls.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

const rates = {
  data: {
    base: 'CAD',
    date: '2026-10-26',
    source: 'European Central Bank via Frankfurter',
    rates: { CHF: 0.581, EUR: 0.6372, GBP: 0.5571, SEK: 7.097, USD: 0.7243 },
  },
  meta: { fetchedAt: '2026-10-26T06:00:02Z', stale: false },
};

async function newPage(browser, label, { colorScheme, viewport }) {
  const context = await browser.newContext({ locale: 'en-CA', colorScheme, viewport });
  await context.route('**/api/v1/fx?**', (route) => route.fulfill({ json: rates }));
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning')
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
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
  await putRecord(page, 'lists', { id: FAMILY, name: 'Family', ...stamps });
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

/** The focused control's name: its aria-label, its text, or its form field's label. */
const focusedName = (page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    const field = element?.closest('mat-form-field');
    return (
      element?.getAttribute('aria-label') ??
      (field ? `${field.querySelector('mat-label')?.textContent?.trim()} field` : null) ??
      element?.textContent?.trim()
    );
  });

/** Where the controls are: each one's box, by name. */
const layout = (page) =>
  page.evaluate(() => {
    const box = (element) => {
      if (!element) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height, right: x + width, middle: y + height / 2 };
    };
    const [month, year] = document.querySelectorAll('.views button');
    return {
      controls: box(document.querySelector('.controls')),
      month: box(month),
      year: box(year),
      today: box(document.querySelector('button.today')),
      previous: box(document.querySelector('button[aria-label^="Previous"]')),
      next: box(document.querySelector('button[aria-label^="Next"]')),
    };
  });

const tabNames = async (page, count) => {
  const names = [];
  for (let press = 0; press < count; press++) {
    await page.keyboard.press('Tab');
    names.push(await focusedName(page));
  }
  return names;
};

async function run(browser, colorScheme, viewport) {
  const label = `${colorScheme} ${viewport.width}`;
  const narrow = viewport === NARROW;
  const { context, page } = await newPage(browser, label, { colorScheme, viewport });
  try {
    await firstRun(page);
    await plant(page);
    await page.goto(`${baseUrl}calendar`);
    await page.locator('.views button').first().waitFor({ timeout: 20000 });
    await sleep(500);
    const inMonth = await layout(page);
    await page.screenshot({ path: path.join(outDir, `month-${label.replace(' ', '-')}.png`) });

    // Tab order, from the view buttons on.
    await page.locator('.views button').first().focus();
    const monthOrder = [await focusedName(page), ...(await tabNames(page, 6))];
    check(
      `${label}: Tab goes Month, Year, Today, ‹, the month, the year, ›`,
      monthOrder.join(' > ') ===
        'Month > Year > Today > Previous month > Month field > Year field > Next month',
      monthOrder.join(' > '),
    );

    if (narrow) {
      check(
        `${label}: Month and Year on Today's row, Today at its end`,
        Math.abs(inMonth.month.middle - inMonth.today.middle) < 2 &&
          Math.abs(inMonth.today.right - inMonth.controls.right) < 2 &&
          inMonth.today.x - inMonth.year.right > 16,
        JSON.stringify({ views: inMonth.month.middle, today: inMonth.today.middle }),
      );
      check(
        `${label}: the arrows on a row of their own, below`,
        inMonth.previous.y > inMonth.today.y + inMonth.today.height - 1 &&
          Math.abs(inMonth.previous.middle - inMonth.next.middle) < 2,
      );
    } else {
      check(
        `${label}: Today beside Year, and the arrows at the row's end`,
        Math.abs(inMonth.next.right - inMonth.controls.right) < 2 &&
          inMonth.today.x - inMonth.year.right < 16 &&
          Math.abs(inMonth.today.middle - inMonth.next.middle) < 2,
      );
    }
    await axeCheck(page, `${label}: the month view`);
    await noSideScroll(page, viewport, `${label}: the month view`);

    // The year view: Month and Year stay where they were.
    await page.locator('.views button', { hasText: 'Year' }).click();
    await page.waitForURL(/view=year/);
    await page.locator('ss-calendar-year .month').nth(11).waitFor();
    await sleep(500);
    const inYear = await layout(page);
    const moved = Math.max(
      Math.abs(inYear.month.x - inMonth.month.x),
      Math.abs(inYear.month.y - inMonth.month.y),
      Math.abs(inYear.year.x - inMonth.year.x),
      Math.abs(inYear.today.x - inMonth.today.x),
      Math.abs(inYear.today.y - inMonth.today.y),
    );
    check(
      `${label}: Month, Year and Today don't move when the view changes`,
      moved < 1,
      `${moved} px`,
    );
    await page.locator('.views button').first().focus();
    const yearOrder = [await focusedName(page), ...(await tabNames(page, 6))];
    check(
      `${label}: in the year view, Tab goes Month, Year, Today, ‹, the year, ›, then January`,
      yearOrder.slice(0, 6).join(' > ') ===
        'Month > Year > Today > Previous year > Year field > Next year' &&
        yearOrder[6].startsWith('January'),
      yearOrder.join(' > '),
    );

    // A month card is one target: what's at points across March's card is its link.
    const march = page.locator('ss-calendar-year .month').nth(2);
    await march.scrollIntoViewIfNeeded();
    const card = await march.boundingBox();
    const hits = await page.evaluate(
      ({ x, y, width, height }) =>
        [
          [0.5, 0.15],
          [0.2, 0.35],
          [0.5, 0.45],
          [0.15, 0.7],
          [0.85, 0.9],
        ].map(([fx, fy]) => {
          const at = document.elementFromPoint(x + width * fx, y + height * fy);
          return {
            link: at?.matches('ss-calendar-year .month a.name') === true,
            cursor: at ? getComputedStyle(at).cursor : '',
          };
        }),
      card,
    );
    check(
      `${label}: every point of a card is its link, with the pointer cursor`,
      hits.every((hit) => hit.link && hit.cursor === 'pointer'),
      JSON.stringify(hits),
    );
    const selectable = await march.evaluate((element) => getComputedStyle(element).userSelect);
    const total = await march.locator('.total').boundingBox();
    await page.mouse.dblclick(total.x + total.width / 2, total.y + total.height / 2);
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    check(
      `${label}: a double click selects none of a card's text`,
      selectable === 'none' && selected === '',
      `${selectable} / "${selected}"`,
    );
    await page.waitForURL(/month=\d{4}-03(?!.*view)/, { timeout: 5000 }).catch(() => undefined);
    await page.goto(`${baseUrl}calendar?view=year`);
    await page.locator('ss-calendar-year .month').nth(11).waitFor();
    await axeCheck(page, `${label}: the year view`);
    await noSideScroll(page, viewport, `${label}: the year view`);
    await page.screenshot({
      path: path.join(outDir, `year-${label.replace(' ', '-')}.png`),
      fullPage: true,
    });

    // A click on March's days opens March.
    await page.locator('ss-calendar-year .month').nth(2).scrollIntoViewIfNeeded();
    const days = await page
      .locator('ss-calendar-year .month')
      .nth(2)
      .locator('.days')
      .boundingBox();
    await page.mouse.click(days.x + days.width * 0.6, days.y + days.height * 0.6);
    await page.waitForURL(/month=\d{4}-03(?!.*view)/, { timeout: 5000 }).catch(() => undefined);
    check(
      `${label}: a click on a card's days opens its month`,
      /month=\d{4}-03$/.test(page.url()),
      page.url(),
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

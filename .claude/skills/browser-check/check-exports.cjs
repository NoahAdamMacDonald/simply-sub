// M7.5 in the system Edge: the exports on `ng serve`, for a Canadian in Alberta. It writes to IndexedDB Work Related
// (Netflix Standard on the 12th, tagged Family and with a tag deleted since; Crave Premium billed on the 31st) and Family
// (Mullvad VPN, yearly on Jan 20, renewed by hand).
// In both themes at 1280 and 360 px, keyboard only:
// - List view's Export menu: each format downloads with this list only. The CSV has a byte order mark, its header and
//   a row per item with live tags only; the workbook parses (exceljs) with Summary, the list's sheet and Payments; the
//   JSON holds the list, its items and the live tag; the text names the list and its items; the .ics has an all-day
//   event per charge, Crave's in every one of 12 months. "Saved <name>" follows each.
// - The Calendar's Export to file: the main button's .ics for the lists shown, the menu's payment schedule (.csv, in
//   date order) and Excel (both lists' sheets).
// - Sync calendar: each app downloads the .ics and opens its steps, focus on the heading; Escape closes them, with focus
//   back on Sync calendar.
// - Offline, a library not loaded yet: the snack bar says the file couldn't be made.
// With axe on List view's open menu, the Calendar's open menu and each app's steps, and no horizontal scroll.
// Usage: node check-exports.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
const fs = require('fs');
const path = require('path');

const [depsDir, outDir, baseUrl] = process.argv.slice(2);
const { chromium } = require(path.join(depsDir, 'node_modules', 'playwright-core'));
// The repository's own exceljs (its Node build) reads the workbooks back.
const { Workbook } = require(path.join(__dirname, '..', '..', '..', 'node_modules', 'exceljs'));
const axeSource = fs.readFileSync(
  path.join(depsDir, 'node_modules', 'axe-core', 'axe.min.js'),
  'utf8',
);
fs.mkdirSync(outDir, { recursive: true });

const WIDE = { width: 1280, height: 900 };
/** The menu that's open, not one still fading out. */
const OPEN_MENU = '.mat-mdc-menu-panel:not(.mat-menu-panel-exit-animation)';
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
  const context = await browser.newContext({
    locale: 'en-CA',
    colorScheme,
    viewport,
    acceptDownloads: true,
  });
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
  // Material renders menus and dialogs outside the page's landmarks: set aside `region` hits all inside its overlay
  // container. Set aside contrast hits on text under an open popup, as check-list-view.cjs does.
  const hidden = await page.evaluate(
    (targets) =>
      targets.map((target) => {
        const element = document.querySelector(target);
        if (!element) return false;
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return (
          (top?.closest('.cdk-overlay-pane, .cdk-overlay-backdrop') ?? null) !== null &&
          !element.closest('.cdk-overlay-pane')
        );
      }),
    (result.violations.find((violation) => violation.id === 'color-contrast')?.nodes ?? []).map(
      (node) => node.target.join(' '),
    ),
  );
  // A menu item's selector doesn't name the overlay it's in, so ask the page.
  const inOverlay = await page.evaluate(
    (targets) =>
      targets.map(
        (target) => document.querySelector(target)?.closest('.cdk-overlay-container') != null,
      ),
    (result.violations.find((violation) => violation.id === 'region')?.nodes ?? []).map((node) =>
      node.target.join(' '),
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
        (violation.id !== 'region' || !violation.nodes.every((_, index) => inOverlay[index])),
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

/** Tabs to the element `selector` names. */
function tabTo(page, selector) {
  return keyTo(page, `document.activeElement?.matches(${JSON.stringify(selector)}) ?? false`);
}

/** Presses Enter on a menu item `downs` items below the first, and returns what downloaded: its name and bytes. */
async function chooseAndDownload(page, downs) {
  await focusMenuItem(page, downs);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Enter'),
  ]);
  return { name: download.suggestedFilename(), bytes: fs.readFileSync(await download.path()) };
}

/** Moves focus `downs` items below the open menu's first. */
async function focusMenuItem(page, downs) {
  await page.locator(OPEN_MENU).waitFor();
  // The menu puts focus on its first item as it opens: keys pressed before then land elsewhere. The last menu may still
  // be fading out.
  const focused = () =>
    page.evaluate(() => {
      const item = document.activeElement?.closest('[mat-menu-item]');
      const panel = item?.closest('.mat-mdc-menu-panel');
      return panel ? [...panel.querySelectorAll('[mat-menu-item]')].indexOf(item) : -1;
    });
  await until('focus on the menu’s first item', async () => (await focused()) === 0);
  for (let index = 0; index < downs; index++) await page.keyboard.press('ArrowDown');
  await until(`focus on the menu’s item ${downs}`, async () => (await focused()) === downs);
}

/**
 * Offline, a library this page hasn't loaded (exceljs) can't load: the snack bar, loaded ahead, says the file couldn't
 * be made, and nothing downloads. The errors that logs are expected.
 */
async function offline(page, context, label) {
  const logged = consoleProblems.length;
  await context.setOffline(true);
  await tabTo(page, 'ss-split-button .more');
  await page.keyboard.press('Enter');
  await focusMenuItem(page, 2);
  let downloaded = false;
  page.once('download', () => (downloaded = true));
  await page.keyboard.press('Enter');
  const said = await page
    .locator('.mat-mdc-snack-bar-label', { hasText: 'The file couldn’t be made' })
    .first()
    .waitFor({ timeout: 10000 })
    .then(
      () => true,
      () => false,
    );
  check(
    `${label}: offline, Excel says the file couldn't be made, and nothing downloads`,
    said && !downloaded,
  );
  await context.setOffline(false);
  consoleProblems.splice(logged);
}

/** Presses Enter on the focused button and returns what downloaded. */
async function enterAndDownload(page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Enter'),
  ]);
  return { name: download.suggestedFilename(), bytes: fs.readFileSync(await download.path()) };
}

/** A CSV's rows, after its byte order mark, which it must have. */
function csvRows({ bytes }) {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  return {
    bom,
    rows: bytes
      .subarray(bom ? 3 : 0)
      .toString('utf8')
      .split('\r\n'),
  };
}

async function workbook({ bytes }) {
  const book = new Workbook();
  await book.xlsx.load(bytes);
  return book;
}

/** Each VEVENT's DTSTART (YYYYMMDD) and SUMMARY, unfolded. */
function events({ bytes }) {
  const text = bytes.toString('utf8').replace(/\r\n[ \t]/g, '');
  return [...text.matchAll(/BEGIN:VEVENT\r\n([\s\S]*?)END:VEVENT/g)].map(([, body]) => ({
    start: /DTSTART;VALUE=DATE:(\d{8})/.exec(body)?.[1],
    end: /DTEND;VALUE=DATE:(\d{8})/.exec(body)?.[1],
    summary: /SUMMARY:(.*)/.exec(body)?.[1],
  }));
}

async function snackBar(page, name) {
  try {
    // The snack bar's label, which Material nests in one of the same class.
    await page
      .locator('.mat-mdc-snack-bar-label', { hasText: `Saved ${name}` })
      .first()
      .waitFor({ timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

const WORK = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const FAMILY = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';
const FAMILY_TAG = '0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2d';
const OLD_TAG = '0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2e';
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
  await putRecord(page, 'tags', { id: FAMILY_TAG, name: 'Family', color: '#1e88e5', ...stamps });
  // Deleted on its own, as a backup from before M6.11 could leave it: Netflix still names it.
  await putRecord(page, 'tags', {
    id: OLD_TAG,
    name: 'Old',
    color: '#43a047',
    ...stamps,
    deletedAt: '2026-10-21T12:00:00.000Z',
  });
  const items = [
    [WORK, 'netflix.standard', monthly('2026-11-12'), [FAMILY_TAG, OLD_TAG]],
    [WORK, 'crave.premium', monthly('2026-01-31'), []],
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
      [],
    ],
  ];
  for (const [index, [listId, planId, billing, tagIds]] of items.entries()) {
    await putRecord(page, 'items', {
      id: `0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0${index}`,
      listId,
      source: { kind: 'catalog', planId },
      billing,
      tagIds,
      rankOverrides: {},
      pinned: false,
      ...stamps,
    });
  }
}

/** The 12 months from this one: 202610 … 202709. */
function next12Months() {
  const now = new Date();
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() + index, 1));
    return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

async function listView(page, viewport, label, everyFormat) {
  await page.goto(`${baseUrl}lists/${WORK}`);
  await page.locator('ss-item-card').first().waitFor();
  await tabTo(page, 'button.export');
  check(`${label}: Export is reached by Tab`, true);
  await page.keyboard.press('Enter');
  await page.locator(OPEN_MENU).waitFor();
  const choices = await page.locator(`${OPEN_MENU} .mat-mdc-menu-item-text`).allInnerTexts();
  check(
    `${label}: Export offers each format`,
    choices.map((choice) => choice.trim()).join(' | ') ===
      'CSV (.csv) | Excel (.xlsx) | JSON (.json) | Text (.txt) | Calendar (.ics)',
    choices.join(' | '),
  );
  await axeCheck(page, `${label}: List view, Export open`);
  await page.screenshot({ path: path.join(outDir, `exports-list-${label}.png`) });
  await noSideScroll(page, viewport, `${label}: List view`);

  const csv = await chooseAndDownload(page, 0);
  const { bom, rows } = csvRows(csv);
  check(
    `${label}: CSV named for the list`,
    /^simply-sub-work-related-\d{4}-\d\d-\d\d\.csv$/.test(csv.name),
    csv.name,
  );
  check(`${label}: CSV has a byte order mark for Excel`, bom);
  check(
    `${label}: CSV has the header and a row per item, live tags only`,
    rows[0] ===
      'List,Service,Plan,Nickname,Cost,Tax,Currency,Converted,Billed,Renews,Next charge,Ends,Status,Tags' &&
      rows.length === 3 &&
      rows[1].startsWith('Work Related,Netflix,Standard,,19.94,0.95,CAD,,Monthly,Automatically,') &&
      rows[1].endsWith(',Active,Family') &&
      rows[2].startsWith('Work Related,Crave,Premium,,23.1,1.1,CAD,') &&
      !rows.join().includes('Old'),
    rows.slice(0, 3).join(' / '),
  );
  check(`${label}: "Saved" names the CSV`, await snackBar(page, csv.name));
  if (!everyFormat) return;

  const formats = [
    [1, 'xlsx'],
    [2, 'json'],
    [3, 'txt'],
    [4, 'ics'],
  ];
  const files = {};
  for (const [downs, extension] of formats) {
    await page.keyboard.press('Escape');
    await tabTo(page, 'button.export');
    await page.keyboard.press('Enter');
    files[extension] = await chooseAndDownload(page, downs);
    check(
      `${label}: ${extension} downloads, named for the list`,
      files[extension].name.endsWith(`.${extension}`) &&
        files[extension].name.startsWith('simply-sub-work-related-'),
      files[extension].name,
    );
  }
  const book = await workbook(files.xlsx);
  const sheet = book.getWorksheet('Work Related');
  check(
    `${label}: the workbook parses, with Summary, the list's sheet and Payments`,
    book.worksheets.map((one) => one.name).join() === 'Summary,Work Related,Payments' &&
      sheet.getRow(2).getCell(1).value === 'Netflix' &&
      sheet.getRow(2).getCell(13).value === 'Family' &&
      book.getWorksheet('Payments').rowCount === 25,
    book.worksheets.map((one) => `${one.name} (${one.rowCount})`).join(', '),
  );
  const json = JSON.parse(files.json.bytes.toString('utf8'));
  check(
    `${label}: the JSON holds the list, its items and its live tag`,
    json.app === 'simply-sub' &&
      json.list.name === 'Work Related' &&
      json.items.length === 2 &&
      json.tags.map((tag) => tag.name).join() === 'Family',
  );
  const text = files.txt.bytes.toString('utf8');
  check(
    `${label}: the text names the list and its items`,
    text.startsWith('Work Related\nExported from Simply Sub on ') &&
      text.includes('Netflix Standard\n  Cost: $19.94 monthly, with $0.95 tax') &&
      text.includes('Crave Premium') &&
      !text.includes('Mullvad') &&
      !text.includes('Old'),
  );
  const calendar = events(files.ics);
  const craves = calendar.filter((event) => event.summary === 'Crave: $23.10');
  check(
    `${label}: the .ics has an all-day event per charge, this list only`,
    calendar.length === 24 && calendar.every((event) => event.start && event.end),
    `${calendar.length} events`,
  );
  check(
    `${label}: the plan billed on the 31st has an event in every month`,
    craves.map((event) => event.start.slice(0, 6)).join() === next12Months().join(),
    craves.map((event) => event.start).join(' '),
  );
  await page.keyboard.press('Escape');
}

async function calendarPage(page, viewport, label, everyFormat) {
  await page.goto(`${baseUrl}calendar`);
  await page.locator('ss-split-button .main').waitFor();
  await noSideScroll(page, viewport, `${label}: Calendar`);
  await tabTo(page, 'ss-split-button .main');
  const ics = await enterAndDownload(page);
  const calendar = events(ics);
  check(
    `${label}: Export to file's main button: the .ics for every list shown`,
    /^simply-sub-payments-\d{4}-\d\d-\d\d\.ics$/.test(ics.name) &&
      calendar.length === 25 &&
      calendar.some((event) => event.summary === 'Renew Mullvad VPN: ≈ $94.16'),
    `${ics.name}: ${calendar.length} events`,
  );
  check(`${label}: "Saved" names the .ics`, await snackBar(page, ics.name));

  await tabTo(page, 'ss-split-button .more');
  await page.keyboard.press('Enter');
  await page.locator(OPEN_MENU).waitFor();
  await axeCheck(page, `${label}: Calendar, Export to file open`);
  await page.screenshot({ path: path.join(outDir, `exports-calendar-${label}.png`) });
  const csv = await chooseAndDownload(page, 1);
  const { rows } = csvRows(csv);
  const dates = rows.slice(1).map((row) => row.slice(0, 10));
  check(
    `${label}: the payment schedule, a row per charge in date order`,
    csv.name.endsWith('.csv') &&
      rows[0] ===
        'Date,List,Service,Plan,Nickname,Amount,Tax,Currency,Converted,Renews,Last charge' &&
      rows.length === 26 &&
      dates.join() === [...dates].sort().join() &&
      rows.some((row) =>
        row.endsWith(',Family,Mullvad VPN,Mullvad VPN,,94.16,0,CAD,yes,Manually,'),
      ),
    `${rows.length - 1} rows`,
  );
  if (everyFormat) {
    await tabTo(page, 'ss-split-button .more');
    await page.keyboard.press('Enter');
    const xlsx = await chooseAndDownload(page, 2);
    const book = await workbook(xlsx);
    check(
      `${label}: the Calendar's workbook has both lists' sheets`,
      book.worksheets.map((one) => one.name).join() === 'Summary,Work Related,Family,Payments',
      book.worksheets.map((one) => one.name).join(),
    );
  }

  const apps = everyFormat
    ? ['Google Calendar', 'Apple Calendar', 'Proton Calendar']
    : ['Proton Calendar'];
  for (const app of apps) {
    await tabTo(page, 'button.sync');
    await page.keyboard.press('Enter');
    await page.locator(OPEN_MENU).waitFor();
    const index = ['Google Calendar', 'Apple Calendar', 'Proton Calendar'].indexOf(app);
    const download = await chooseAndDownload(page, index);
    const dialog = page.locator('ss-sync-dialog');
    await dialog.waitFor();
    const heading = await until(`${app}'s heading focused`, () =>
      page.evaluate(() =>
        document.activeElement?.matches('ss-sync-dialog h2')
          ? document.activeElement.textContent
          : '',
      ),
    );
    check(
      `${label}: Sync calendar, ${app}: the .ics downloads, then its steps, focus on the heading`,
      download.name.endsWith('.ics') && heading.trim() === `Add your payments to ${app}`,
      `${download.name}: ${heading.trim()}`,
    );
    const steps = await dialog.locator('li').count();
    check(`${label}: ${app}'s steps are listed`, steps >= 2, `${steps} steps`);
    await axeCheck(page, `${label}: ${app}'s steps`);
    await page.screenshot({
      path: path.join(outDir, `exports-sync-${app.split(' ')[0]}-${label}.png`),
    });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    const back = await until('focus back on Sync calendar', () =>
      page.evaluate(() => document.activeElement?.matches('button.sync') ?? false),
    );
    check(`${label}: Escape closes ${app}'s steps, focus back on Sync calendar`, back);
  }
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  for (const colorScheme of ['light', 'dark']) {
    for (const [viewport, width] of [
      [WIDE, 'wide'],
      [NARROW, 'narrow'],
    ]) {
      const label = `${colorScheme} ${width}`;
      const { context, page } = await newPage(browser, label, { colorScheme, viewport });
      await firstRun(page);
      await plant(page);
      await page.reload();
      // Every format once, light and wide; the rest open each page's menus and check one of each.
      const everyFormat = colorScheme === 'light' && width === 'wide';
      await listView(page, viewport, label, everyFormat);
      await calendarPage(page, viewport, label, everyFormat);
      if (label === 'light narrow') await offline(page, context, label);
      await context.close();
    }
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

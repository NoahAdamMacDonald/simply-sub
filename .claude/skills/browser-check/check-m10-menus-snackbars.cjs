// The feedback after M10, part 2, item 6 (M10.19) in the system Edge on ng serve, for a Canadian in Alberta, in both
// themes at 360 px (as the Home Screen app, with an iPhone's safe areas set through CDP, and touch) and 1280 px:
// - The menus you can type in close when they're left: the first-run dialog's Province, opened by typing, closes on a
//   tap that leaves focus in the field (as an iPhone's does: pointer events with no focus change), with focus kept;
//   on focus going nowhere (an iPhone keyboard's Done); and on a real tap or click on the dialog's heading; a click on a
//   choice still picks it. Search's Category (in its panel at 1280 px, its drawer at 360 px) picks a clicked choice
//   on the page, where the press takes focus nowhere, and closes on a click elsewhere and on focus going nowhere.
// - Snackbars: Lists' 🗑 → Delete gives "Deleted <list>" with Undo and ✕ (named Dismiss), 8 px above the screen's
//   bottom, or above the home indicator in the Home Screen app; Escape in a dialog opened over it closes the dialog
//   and leaves it; Tab from the page reaches Undo, then ✕, and Enter on ✕ closes it with focus back where it was;
//   Escape closes the next. At 1280 px light, hovered past its 10 s it stays, and left, it goes.
// With axe on the open lists and the snackbar, screenshots, and no horizontal scroll.
// Usage: node check-m10-menus-snackbars.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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
const insets = { top: 59, bottom: 34, left: 0, right: 0 };

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

/** A page: at 360 px the Home Screen app on a phone (its safe areas and touch), at 1280 px a browser tab. */
async function newPage(browser, label, { colorScheme, viewport }) {
  const phone = viewport === NARROW;
  const context = await browser.newContext({
    locale: 'en-CA',
    colorScheme,
    viewport,
    hasTouch: phone,
  });
  await context.route('**/api/v1/fx?**', (route) => route.fulfill({ json: rates }));
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning')
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  if (phone) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'display-mode', value: 'standalone' }],
    });
  }
  return { context, page };
}

async function axeCheck(page, label) {
  await sleep(600);
  await page.evaluate(axeSource);
  const result = await page.evaluate(() => axe.run(document));
  // Material renders menus, dialogs and snackbars outside the page's landmarks (the skill's gotchas).
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

async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
}

/** The focused element's role and name, as its accessibility snapshot's first line gives them. */
async function stop(page) {
  const snapshot = await page.locator(':focus').ariaSnapshot();
  return snapshot.split('\n')[0].replace(/^- /, '');
}

/** An autocomplete list is showing. */
const listOpen = (page) =>
  page.evaluate(() => document.querySelector('.mat-mdc-autocomplete-visible') !== null);
const choiceInput = (page, label) => page.locator(`ss-choice-field[data-label="${label}"] input`);
/** Where a user clicks a menu: its field, as an empty one's label lies over its text box. */
const choiceField = (page, label) =>
  page.locator(`ss-choice-field[data-label="${label}"] .mat-mdc-text-field-wrapper`);
const inChoice = (page, label) =>
  page.evaluate(
    (name) => document.activeElement?.closest(`ss-choice-field[data-label="${name}"]`) !== null,
    label,
  );

/** A press that leaves focus where it is, as a tap on something that can't take it does on an iPhone. */
function iphoneTap(page, selector) {
  return page.evaluate((target) => {
    const element = document.querySelector(target);
    for (const type of ['pointerdown', 'pointerup']) {
      element.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch' }));
    }
  }, selector);
}

/** The first-run dialog's Province, each way of leaving it, then a choice picked with the pointer. */
async function firstRunMenus(page, label, phone) {
  await page.goto(baseUrl);
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor({ timeout: 20000 });
  await page.waitForFunction(
    () => document.activeElement?.matches('mat-dialog-container h2') === true,
  );
  for (
    let presses = 0;
    presses < 12 && !(await inChoice(page, 'Province or territory'));
    presses++
  ) {
    await page.keyboard.press('Tab');
  }
  await page.keyboard.type('Al');
  await until('the list', () => listOpen(page));
  await sleep(300);
  await axeCheck(page, `${label}, Province's open list`);
  await shot(page, `first-run-province-open-${label.replace(' ', '-')}`);

  await iphoneTap(page, 'mat-dialog-container p.privacy');
  await sleep(300);
  check(
    `${label}: a tap on the dialog's text that leaves focus in Province closes its list, focus kept`,
    !(await listOpen(page)) && (await inChoice(page, 'Province or territory')),
    await stop(page),
  );

  await page.keyboard.type('b');
  await until('the list again', () => listOpen(page));
  await page.evaluate(() => document.activeElement.blur());
  await sleep(300);
  check(`${label}: focus going nowhere (Done) closes it`, !(await listOpen(page)));

  // A real tap (360 px) or click (1280 px) on the dialog's heading: the open list covers its text.
  await choiceField(page, 'Province or territory').click();
  await until('the list on a click', () => listOpen(page));
  if (phone) await page.tap('mat-dialog-container h2');
  else await page.click('mat-dialog-container h2');
  await sleep(300);
  check(
    `${label}: a ${phone ? 'tap' : 'click'} on the dialog's heading closes it`,
    !(await listOpen(page)),
  );

  await choiceField(page, 'Province or territory').click();
  await until('the list for a pick', () => listOpen(page));
  const alberta = page.getByRole('option', { name: 'Alberta', exact: true });
  if (phone) await alberta.tap();
  else await alberta.click();
  await until(
    'Alberta',
    async () => (await choiceInput(page, 'Province or territory').inputValue()) === 'Alberta',
  );
  await sleep(300);
  check(
    `${label}: a ${phone ? 'tap' : 'click'} on Alberta picks it and closes the list`,
    !(await listOpen(page)),
  );
  await page.getByRole('button', { name: 'Get started' }).click();
  await dialog.waitFor({ state: 'detached' });
}

/** Search's Category: in its panel at 1280 px, on the page; in its drawer at 360 px. */
async function searchCategory(page, label, phone) {
  await page.goto(`${baseUrl}search`);
  await page.locator('ss-sub-card').first().waitFor({ timeout: 20000 });
  const drawer = page.locator('mat-dialog-container');
  if (phone) {
    await page.getByRole('button', { name: /^Filters/ }).click();
    await drawer.waitFor();
  }
  const category = choiceInput(page, 'Category');
  await choiceField(page, 'Category').click();
  await until('Category’s list', () => listOpen(page));
  const vpn = page.getByRole('option', { name: 'VPN', exact: true });
  if (phone) await vpn.tap();
  else await vpn.click();
  await until('cat=vpn', () => new URL(page.url()).search.includes('cat=vpn'));
  await sleep(300);
  check(
    `${label}: a ${phone ? 'tap' : 'click'} on VPN in Category picks it ${phone ? 'in the drawer' : 'on the page'}`,
    !(await listOpen(page)) && (await category.inputValue()) === 'VPN',
    await category.inputValue(),
  );

  await choiceField(page, 'Category').click();
  await until('Category’s list again', () => listOpen(page));
  const elsewhere = phone ? 'mat-dialog-container h2' : 'p.count';
  if (phone) await page.tap(elsewhere);
  else await page.click(elsewhere);
  await sleep(300);
  check(
    `${label}: a ${phone ? 'tap' : 'click'} elsewhere closes Category’s list`,
    !(await listOpen(page)),
  );

  await choiceField(page, 'Category').click();
  await until('Category’s list a third time', () => listOpen(page));
  await iphoneTap(page, elsewhere);
  await sleep(300);
  check(
    `${label}: an iPhone-style tap elsewhere closes it, focus kept`,
    !(await listOpen(page)) && (await inChoice(page, 'Category')),
  );
  await choiceField(page, 'Category').click();
  await until('Category’s list a fourth time', () => listOpen(page));
  await page.evaluate(() => document.activeElement.blur());
  await sleep(300);
  check(`${label}: focus going nowhere closes Category’s list`, !(await listOpen(page)));
  if (phone) {
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'detached' }).catch(() => undefined);
  }
}

/** Writes a list straight to IndexedDB. */
function putList(page, list) {
  return page.evaluate(
    (value) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('simply-sub');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('lists', 'readwrite');
          transaction.objectStore('lists').put(value);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    list,
  );
}

const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };
const LISTS = [
  { id: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c41', name: 'Work Related', ...stamps },
  { id: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c42', name: 'Family', ...stamps },
  { id: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c43', name: 'Cabin', ...stamps },
];

const snack = (page) => page.locator('.mat-mdc-snack-bar-container');
const snackMessage = (page) => page.locator('ss-snack .mat-mdc-snack-bar-label');

/** 🗑 on the list `name`, then Delete in its question. */
async function deleteList(page, name) {
  await page.getByRole('button', { name: `Delete ${name}` }).click();
  const question = page.locator('mat-dialog-container');
  await question.waitFor();
  await question.getByRole('button', { name: 'Delete list', exact: true }).click();
  await question.waitFor({ state: 'detached' });
}

async function snackbars(page, label, viewport, phone, timing) {
  for (const list of LISTS) await putList(page, list);
  await page.goto(`${baseUrl}lists`);
  await page.getByRole('button', { name: 'Delete Work Related' }).waitFor({ timeout: 20000 });

  await deleteList(page, 'Work Related');
  await until('the snackbar', async () => (await snackMessage(page).count()) === 1);
  await sleep(500);
  const buttons = await snack(page)
    .getByRole('button')
    .evaluateAll((all) =>
      all.map((button) => button.getAttribute('aria-label') ?? button.textContent.trim()),
    );
  check(
    `${label}: "Deleted Work Related" has Undo and ✕, named Dismiss`,
    (await snackMessage(page).textContent()).trim() === 'Deleted Work Related' &&
      buttons.join() === 'Undo,Dismiss',
    buttons.join(', '),
  );
  const surface = await page.locator('.mat-mdc-snackbar-surface').boundingBox();
  const gap = viewport.height - (surface.y + surface.height);
  const wanted = phone ? 8 + insets.bottom : 8;
  check(
    `${label}: it sits ${wanted} px above the screen's bottom${phone ? ', clear of the home indicator' : ''}`,
    Math.abs(gap - wanted) <= 1 && surface.x >= 0 && surface.x + surface.width <= viewport.width,
    `${gap.toFixed(1)} px`,
  );
  await axeCheck(page, `${label}, the snackbar`);
  await noSideScroll(page, viewport, `${label}, the snackbar`);
  await shot(page, `snackbar-${label.replace(' ', '-')}`);

  // A dialog opened over it takes Escape first.
  await page.getByRole('button', { name: 'Delete Family' }).click();
  const question = page.locator('mat-dialog-container');
  await question.waitFor();
  await page.keyboard.press('Escape');
  await question.waitFor({ state: 'detached' });
  await sleep(300);
  check(
    `${label}: Escape in a question opened over it closes the question and leaves the snackbar`,
    (await snackMessage(page).count()) === 1,
  );

  // From the page, Tab reaches Undo, then ✕; Enter on ✕ closes it, with focus back on the page.
  await page.getByRole('button', { name: 'Delete Cabin' }).focus();
  let presses = 0;
  while (
    presses < 40 &&
    !(await page.evaluate(() => !!document.activeElement?.closest('.mat-mdc-snack-bar-container')))
  ) {
    const before = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80));
    await page.keyboard.press('Tab');
    presses++;
    if (
      await page.evaluate(() => !!document.activeElement?.closest('.mat-mdc-snack-bar-container'))
    ) {
      await page.evaluate((html) => (window.__cameFrom = html), before);
    }
  }
  const first = await stop(page);
  await page.keyboard.press('Tab');
  const second = await stop(page);
  check(
    `${label}: Tab from the page reaches Undo, then ✕`,
    first.startsWith('button "Undo"') && second.startsWith('button "Dismiss"'),
    `${first}, then ${second}`,
  );
  await shot(page, `snackbar-dismiss-focused-${label.replace(' ', '-')}`);
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  const lastOnPage = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80));
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await until('the snackbar closed', async () => (await snack(page).count()) === 0);
  const back = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80));
  check(
    `${label}: Enter on ✕ closes it, with focus back where it came from`,
    back === lastOnPage,
    back,
  );

  // Escape closes the next one.
  await deleteList(page, 'Family');
  await until('the next snackbar', async () => (await snackMessage(page).count()) === 1);
  await sleep(400);
  await page.keyboard.press('Escape');
  await until('Escape closed it', async () => (await snack(page).count()) === 0, 3000).catch(
    () => undefined,
  );
  check(`${label}: Escape closes it`, (await snack(page).count()) === 0);

  if (timing) {
    await deleteList(page, 'Cabin');
    await until('the timed snackbar', async () => (await snackMessage(page).count()) === 1);
    await snack(page).hover();
    await sleep(11_500);
    check(`${label}: hovered past its 10 s, it stays`, (await snackMessage(page).count()) === 1);
    await page.mouse.move(5, 5);
    await sleep(10_800);
    check(`${label}: left, it goes after 10 s`, (await snack(page).count()) === 0);
  }
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const colorScheme of ['light', 'dark']) {
      for (const viewport of [WIDE, NARROW]) {
        const phone = viewport === NARROW;
        const label = `${colorScheme} ${viewport.width}`;
        const { context, page } = await newPage(browser, label, { colorScheme, viewport });
        try {
          await firstRunMenus(page, label, phone);
          await searchCategory(page, label, phone);
          await snackbars(page, label, viewport, phone, colorScheme === 'light' && !phone);
        } catch (error) {
          check(`${label}: ran to the end`, false, error.message.split('\n')[0]);
          await shot(page, `failure-${label.replace(' ', '-')}`);
        } finally {
          await context.close();
        }
      }
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

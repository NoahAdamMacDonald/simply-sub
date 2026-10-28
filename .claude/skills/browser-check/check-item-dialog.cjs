// M6.5 in the system Edge: the item dialog (P6) on the real catalog, for a Canadian in Alberta, with a saved list,
// Work Related (Netflix Standard, and Mullvad VPN yearly), written to IndexedDB. In both themes at 1280 and 360 px,
// keyboard only: Search → a price → New list… → the dialog, preselected and focused on its heading, with the URL's
// request dropped in place → Add → the row, the snackbar and focus on its ✎ → Save → the list view; the dialog
// 720 px wide, or the whole screen at 360 px; Specific dates with no end and an own price of 0 refused at their
// fields; ✎ on Netflix changing its plan, an extra member, Feb 28 with its billing day by arrow keys and Auto-renews,
// then Save, a reload and the item read from IndexedDB. With axe on the dialog, its errors and the billing day choice,
// and no horizontal scroll.
// Usage: node check-item-dialog.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

const EDITOR =
  /\/lists\/([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/edit$/;
const editorId = (page) => EDITOR.exec(new URL(page.url()).pathname)?.[1];
const search = (page) => decodeURIComponent(new URL(page.url()).search);
const entries = (page) => page.evaluate(() => history.length);

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

/** Writes a record straight to an IndexedDB table. */
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
  // Material renders menus, dialogs and snackbars outside the page's landmarks (the skill's gotchas): set aside
  // `region` hits that are all inside its overlay container.
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

/** The focused element's role and name, as its accessibility snapshot's first line gives them. */
async function stop(page) {
  const snapshot = await page.locator(':focus').ariaSnapshot();
  return snapshot.split('\n')[0].replace(/^- /, '');
}

/** Presses Tab until `isThere` holds for the focused element; the number of presses. */
async function tabTo(page, isThere, limit = 60) {
  let presses = 0;
  while (presses < limit && !(await page.evaluate(isThere))) {
    await page.keyboard.press('Tab');
    presses++;
  }
  return presses;
}

async function noSideScroll(page, viewport, label) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`no horizontal scroll: ${label}`, width <= viewport.width, `${width}px`);
}

/** Presses `key` (Tab by default) until `isThere` holds for the focused element; the number of presses. */
async function keyTo(page, isThere, key = 'Tab', limit = 60) {
  let presses = 0;
  while (presses < limit && !(await page.evaluate(isThere))) {
    await page.keyboard.press(key);
    presses++;
  }
  return presses;
}

const LIST = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const NETFLIX = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0b';
const MULLVAD = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0c';
const TAG = '0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2d';
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };
const editorUrl = () => `${baseUrl}lists/${LIST}/edit`;
const pathOf = (page) => new URL(page.url()).pathname;

/** Work Related: Netflix Standard (tagged Family, one custom rank) and Mullvad VPN, which renews by hand. */
async function plantList(page) {
  const billing = {
    mode: 'recurring',
    interval: 'month',
    intervalCount: 1,
    anchorDate: '2026-11-12',
    autoRenew: true,
  };
  await putRecord(page, 'tags', { id: TAG, name: 'Family', color: '#1e88e5', ...stamps });
  await putRecord(page, 'lists', { id: LIST, name: 'Work Related', ...stamps });
  const netflix = { tagIds: [TAG], rankOverrides: { 'streaming.ad-free': 'essential' } };
  for (const [id, planId, autoRenew, extra] of [
    [NETFLIX, 'netflix.standard', true, netflix],
    [MULLVAD, 'mullvad.vpn', false, {}],
  ]) {
    await putRecord(page, 'items', {
      id,
      listId: LIST,
      source: { kind: 'catalog', planId },
      billing: { ...billing, autoRenew },
      tagIds: [],
      rankOverrides: {},
      pinned: false,
      ...stamps,
      ...extra,
    });
  }
}

async function openEditor(page) {
  await page.goto(editorUrl());
  await page.locator('li.item').nth(1).waitFor({ timeout: 20000 });
}

const nameField = (page) => page.locator('.toolbar input');
const footer = async (page) =>
  (await page.locator('ss-list-edit-page p.footer [aria-hidden]').textContent()).trim();
const titles = (page) =>
  page
    .locator('li.item .title')
    .evaluateAll((items) => items.map((item) => item.textContent.replace(/\s+/g, ' ').trim()));
const dialog = (page) => page.locator('mat-dialog-container');
const focusedName = (page) =>
  page.evaluate(
    () =>
      document.activeElement?.getAttribute('aria-label') ??
      document.activeElement?.textContent?.trim(),
  );

async function draftOf(page) {
  return (await readTable(page, 'drafts')).find((draft) => draft.listId === LIST);
}

const itemDialog = (page) => page.locator('ss-item-dialog');
const snackBar = (page) => page.locator('.mat-mdc-snack-bar-container');

/** Whether focus is on the dialog's button with this text (a function the page runs, so the text is written in). */
const onButton = (text) =>
  new Function(
    `return !!document.activeElement?.closest('ss-item-dialog') &&
       document.activeElement.textContent?.trim() === ${JSON.stringify(text)};`,
  );

/** Presses `key` until focus is in the dialog's field labelled `label` (any of its date input's parts). */
async function toField(page, label, key = 'Tab') {
  const presses = await keyTo(
    page,
    new Function(
      `const field = document.activeElement?.closest('mat-form-field');
       return !!field?.closest('ss-item-dialog') &&
         field.querySelector('mat-label')?.textContent.trim() === ${JSON.stringify(label)};`,
    ),
    key,
    120,
  );
  return presses;
}

/** The dialog's panel's size. */
async function panelSize(page) {
  const box = await page.locator('.cdk-overlay-pane.ss-wide-dialog').boundingBox();
  return { width: Math.round(box.width), height: Math.round(box.height) };
}

/** Types a date into the focused date field, over what's there, as a keyboard user does (2027-02-28). */
async function typeDate(page, date) {
  await page.keyboard.press('Control+A');
  await page.keyboard.type(date);
  await sleep(200);
}

/** The shown text of a select in the dialog: its trigger's, without the words only screen readers get. */
async function shownValue(page, selector) {
  return page.locator(`ss-item-dialog ${selector} .mat-mdc-select-value`).evaluate((value) => {
    const copy = value.cloneNode(true);
    copy.querySelectorAll('.visually-hidden').forEach((hidden) => hidden.remove());
    return copy.textContent.replace(/\s+/g, ' ').trim();
  });
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });

  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [WIDE, NARROW]) {
      const label = `${colorScheme} ${viewport.width}`;
      const shot = (name) => path.join(outDir, `${name}-${colorScheme}-${viewport.width}.png`);
      const { context, page } = await newPage(browser, label, { colorScheme, viewport });
      await firstRun(page);
      await plantList(page);

      // ── Search → a price → New list… → the dialog, preselected → Add → the row → Save → the list ──────
      await page.goto(`${baseUrl}search`);
      await page.locator('ss-sub-card').first().waitFor({ timeout: 20000 });
      await keyTo(
        page,
        () => !!document.activeElement?.closest('ss-sub-card ss-price button'),
        'Tab',
        150,
      );
      const provider = await page.evaluate(() =>
        document.activeElement.closest('ss-sub-card').querySelector('h2.name').textContent.trim(),
      );
      const before = await entries(page);
      await page.keyboard.press('Enter');
      await page.locator('.mat-mdc-menu-panel').waitFor();
      await sleep(300);
      await keyTo(
        page,
        () => document.activeElement?.textContent?.includes('New list'),
        'ArrowDown',
        10,
      );
      await page.keyboard.press('Enter');
      await itemDialog(page).waitFor({ timeout: 20000 });
      await sleep(600);
      const listId = editorId(page);
      const size = await panelSize(page);
      const subject = (await itemDialog(page).locator('.subject .name').textContent()).trim();
      const plan = await shownValue(page, '.plan');
      // A free plan has nothing to bill, so no Billed.
      const billed =
        (await itemDialog(page).locator('.billed').count()) > 0
          ? await shownValue(page, '.billed')
          : (await itemDialog(page).locator('.billing .note').textContent()).trim();
      check(
        `${label}: a price's New list… opens the new list's editor with the dialog, preselected, focus on its heading`,
        listId !== undefined &&
          subject === provider &&
          (await itemDialog(page).locator('h2').textContent()).trim() === 'Add subscription' &&
          (await page.evaluate(() => document.activeElement?.matches('ss-item-dialog h2'))) &&
          plan.length > 0 &&
          billed.length > 0,
        `${subject} / ${plan} / ${billed}`,
      );
      check(
        `${label}: the URL drops what it asked for, in place: one history entry after Search`,
        search(page) === '' && (await entries(page)) === before + 1,
        `${page.url()}, ${before} → ${await entries(page)} entries`,
      );
      check(
        `${label}: the dialog is ${viewport === NARROW ? 'the whole screen' : '720 px wide'}`,
        viewport === NARROW
          ? size.width === viewport.width && size.height === viewport.height
          : size.width === 720,
        JSON.stringify(size),
      );
      await page.screenshot({ path: shot('dialog-add') });
      await axeCheck(page, `${label}, the dialog adding`);

      await keyTo(page, onButton('Add to list'), 'Tab', 150);
      await page.keyboard.press('Enter');
      await itemDialog(page).waitFor({ state: 'detached' });
      await page.locator('ss-list-edit-page li.item').first().waitFor();
      const added = (await page.locator('ss-list-edit-page li.item .title').textContent())
        .replace(/\s+/g, ' ')
        .trim();
      const title = added.replace(' · ', ' ');
      await until(
        'focus on the row’s ✎',
        async () => (await focusedName(page)) === `Edit ${title}`,
      );
      await snackBar(page).waitFor();
      await sleep(600);
      check(
        `${label}: Add puts the row in the editor, says so, and moves focus to its ✎`,
        added.startsWith(provider) &&
          (await snackBar(page).textContent()).includes(`Added ${title}`) &&
          (await page.locator('ss-list-edit-page p.footer [aria-hidden]').textContent())
            .trim()
            .startsWith('Unsaved changes'),
        `${added} / ${await snackBar(page).textContent()}`,
      );
      await axeCheck(page, `${label}, the editor after Add, with the snackbar`);
      await keyTo(page, () => document.activeElement?.textContent?.trim() === 'Save', 'Shift+Tab');
      await page.keyboard.press('Enter');
      await until('the new list', () => pathOf(page) === `/lists/${listId}`);
      const savedNew = (await readTable(page, 'items')).filter((item) => item.listId === listId);
      check(
        `${label}: Save writes the new list and its item, and opens the list`,
        savedNew.length === 1 &&
          (await readTable(page, 'lists')).some((list) => list.id === listId) &&
          (await readTable(page, 'drafts')).length === 0,
        JSON.stringify(savedNew.map((item) => item.source)),
      );

      // ── Error states: Specific dates with no end, and an own price of 0 ───────────────────────────
      await page.goto(`${editorUrl()}?add=netflix.standard-ads&interval=month`);
      await itemDialog(page).waitFor({ timeout: 20000 });
      await sleep(500);
      // The suggested renewal's hint takes the room it needs: it ends before Auto-renews starts.
      const hintBottom = await itemDialog(page)
        .locator('mat-hint', { hasText: 'Check your account page' })
        .evaluate((hint) => hint.getBoundingClientRect().bottom);
      const autoRenewTop = await itemDialog(page)
        .locator('mat-checkbox', { hasText: 'Auto-renews' })
        .evaluate((box) => box.getBoundingClientRect().top);
      check(
        `${label}: the next renewal's hint clears Auto-renews`,
        hintBottom <= autoRenewTop,
        `${hintBottom} / ${autoRenewTop}`,
      );
      // Each date's box keeps its own height beside a field with a longer hint (the feedback after M6.8).
      const boxHeights = await itemDialog(page)
        .locator('.billing .row')
        .last()
        .locator('.mat-mdc-text-field-wrapper')
        .evaluateAll((boxes) => boxes.map((box) => Math.round(box.getBoundingClientRect().height)));
      check(
        `${label}: Next renewal, Subscribed since and Ends on are boxes of the same height`,
        boxHeights.length === 3 && new Set(boxHeights).size === 1,
        boxHeights.join(' / '),
      );
      await keyTo(page, () => !!document.activeElement?.closest('ss-item-dialog .mode'), 'Tab', 60);
      await page.keyboard.press('ArrowRight');
      await itemDialog(page).locator('.window').waitFor();
      await keyTo(page, onButton('Add to list'), 'Tab', 150);
      await page.keyboard.press('Enter');
      const windowError = itemDialog(page).locator('.window mat-error');
      await windowError.waitFor();
      check(
        `${label}: Specific dates with no end can't be added, and say so at the field, with focus on it`,
        (await windowError.textContent()).trim() === 'Enter the end date' &&
          (await page.evaluate(
            () =>
              document.activeElement?.closest('mat-form-field')?.querySelector('mat-label')
                ?.textContent === 'End',
          )),
      );
      await toField(page, 'End', 'Tab');
      await keyTo(
        page,
        () =>
          document.activeElement
            ?.closest('mat-checkbox')
            ?.textContent.includes('I pay a different price'),
        'Tab',
        60,
      );
      await page.keyboard.press('Space');
      await toField(page, 'Amount');
      await page.keyboard.type('0');
      await keyTo(page, onButton('Add to list'), 'Tab', 150);
      await page.keyboard.press('Enter');
      const priceError = itemDialog(page).locator('.own-price mat-error');
      await priceError.waitFor();
      check(
        `${label}: an own price of 0 says "Enter an amount above 0", and nothing is added`,
        (await priceError.textContent()).trim() === 'Enter an amount above 0' &&
          ((await draftOf(page))?.items ?? []).every((entry) => entry.saved !== undefined),
      );
      await noSideScroll(page, viewport, `${label}, the dialog's errors`);
      await page.screenshot({ path: shot('dialog-errors'), fullPage: true });
      await axeCheck(page, `${label}, the dialog's errors`);
      const beforeEscape = await page.evaluate(() => {
        const focused = document.activeElement;
        const panes = [...document.querySelectorAll('.cdk-overlay-pane')].map(
          (pane) => pane.className,
        );
        return `focus on ${focused?.tagName} ${focused?.getAttribute('type') ?? ''}; panes: ${panes.join(' / ')}`;
      });
      await page.keyboard.press('Escape');
      const closed = await itemDialog(page)
        .waitFor({ state: 'detached', timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      check(
        `${label}: Escape closes the dialog, adding nothing`,
        closed,
        closed ? '' : beforeEscape,
      );
      if (!closed) {
        await itemDialog(page).getByRole('button', { name: 'Cancel' }).click();
        await itemDialog(page).waitFor({ state: 'detached' });
      }

      // ── ✎ Netflix: another plan, an extra member, a billing day, no auto-renewal → Save → reload ──────
      await openEditor(page);
      await page.locator('ss-list-edit-page h1').click();
      await keyTo(
        page,
        () => document.activeElement?.getAttribute('aria-label') === 'Edit Netflix Standard',
      );
      await page.keyboard.press('Enter');
      await itemDialog(page).waitFor();
      await sleep(500);
      const renewal = itemDialog(page).locator('input.mat-datepicker-input').first();
      check(
        `${label}: ✎ opens the dialog for its item as it is`,
        (await itemDialog(page).locator('h2').textContent()).trim() === 'Edit subscription' &&
          (await renewal.inputValue()) === '2026-11-12' &&
          (await shownValue(page, '.plan')) === 'Standard — $18.99 / mo',
        await shownValue(page, '.plan'),
      );

      await keyTo(page, () => !!document.activeElement?.closest('ss-item-dialog .plan'), 'Tab', 10);
      await page.keyboard.press('Enter');
      await page.locator('.mat-mdc-select-panel').waitFor();
      await keyTo(
        page,
        () =>
          document
            .querySelector('mat-option.mat-mdc-option-active')
            ?.textContent.startsWith('Premium'),
        'ArrowDown',
        5,
      );
      await page.keyboard.press('Enter');
      await until('Premium', async () => (await shownValue(page, '.plan')).startsWith('Premium'));
      await keyTo(
        page,
        () =>
          document.activeElement?.closest('mat-checkbox')?.textContent.trim() === 'Extra member',
        'Tab',
        20,
      );
      await page.keyboard.press('Space');
      await itemDialog(page).locator('.quantity').waitFor();
      await keyTo(
        page,
        () => !!document.activeElement?.closest('ss-item-dialog .quantity'),
        'Tab',
        5,
      );
      // A closed menu's arrow keys choose the next option.
      await page.keyboard.press('ArrowDown');
      await until('two extra members', async () => (await shownValue(page, '.quantity')) === '2');

      await toField(page, 'Next renewal');
      await typeDate(page, '2027-02-28');
      const billingDay = itemDialog(page).locator('.billing-day');
      await billingDay.waitFor();
      await keyTo(
        page,
        () => !!document.activeElement?.closest('ss-item-dialog .billing-day'),
        'Tab',
        20,
      );
      for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
      await sleep(300);
      const choices = await billingDay
        .locator('mat-radio-button')
        .evaluateAll((radios) => radios.map((radio) => radio.textContent.trim()));
      const chosen = await billingDay
        .locator('input:checked')
        .evaluate((input) => input.closest('mat-radio-button').textContent.trim());
      check(
        `${label}: Feb 28 asks which day it's billed on, chosen by arrow keys`,
        choices.join(' | ') ===
          'the 28th | the 29th (the last day in shorter months) | the 30th (the last day in shorter months) | the 31st (the last day in shorter months)' &&
          chosen === 'the 31st (the last day in shorter months)',
        `${choices.join(' | ')} → ${chosen}`,
      );
      await page.screenshot({ path: shot('dialog-billing-day') });
      await axeCheck(page, `${label}, the billing day choice`);

      // Ends on from the calendar, by keyboard: its button, an arrow key to the next day, Enter.
      await keyTo(
        page,
        () =>
          document.activeElement
            ?.closest('mat-datepicker-toggle')
            ?.querySelector('button')
            ?.getAttribute('aria-label') === 'Ends on: choose a date' ||
          document.activeElement?.getAttribute('aria-label') === 'Ends on: choose a date',
        'Shift+Tab',
        20,
      );
      await page.keyboard.press('Enter');
      const calendar = page.locator('mat-datepicker-content');
      await calendar.waitFor();
      await sleep(600);
      await page.screenshot({ path: shot('dialog-calendar') });
      await axeCheck(page, `${label}, the calendar`);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter');
      await calendar.waitFor({ state: 'detached' });
      const endsOn = await itemDialog(page)
        .locator('mat-form-field', { hasText: 'Ends on' })
        .locator('input')
        .inputValue();
      check(
        `${label}: the calendar opens from its button and picks a date by keyboard, with focus back on the button`,
        /^\d{4}-\d{2}-\d{2}$/.test(endsOn) &&
          (await focusedName(page)) === 'Ends on: choose a date',
        `${endsOn} / ${await focusedName(page)}`,
      );

      await keyTo(
        page,
        () => document.activeElement?.closest('mat-checkbox')?.textContent.trim() === 'Auto-renews',
        'Tab',
        10,
      );
      await page.keyboard.press('Space');
      await noSideScroll(page, viewport, `${label}, the dialog editing`);
      await page.screenshot({ path: shot('dialog-edit'), fullPage: true });
      await itemDialog(page).locator('ss-tag-picker').scrollIntoViewIfNeeded();
      await sleep(300);
      await page.screenshot({ path: shot('dialog-tags') });
      await axeCheck(page, `${label}, the dialog editing`);
      await keyTo(page, onButton('Save'), 'Tab', 150);
      await page.keyboard.press('Enter');
      await itemDialog(page).waitFor({ state: 'detached' });
      await until(
        'focus on its ✎',
        async () => (await focusedName(page)) === 'Edit Netflix Premium',
      );
      await snackBar(page).waitFor();
      check(
        `${label}: Save changes the item in the draft, says so, and focus is back on its ✎`,
        (await snackBar(page).textContent()).includes('Saved Netflix Premium') &&
          (await titles(page))[0] === 'Netflix · Premium',
        (await titles(page)).join(' | '),
      );
      await keyTo(page, () => document.activeElement?.textContent?.trim() === 'Save', 'Shift+Tab');
      await page.keyboard.press('Enter');
      await until('the list', () => pathOf(page) === `/lists/${LIST}`);
      await page.reload();
      await page.locator('ss-root').waitFor();
      const netflix = (await readTable(page, 'items')).find((item) => item.id === NETFLIX);
      const expected = {
        source: {
          kind: 'catalog',
          planId: 'netflix.premium',
          addOns: [{ id: 'netflix.extra-member', quantity: 2 }],
        },
        billing: {
          mode: 'recurring',
          interval: 'month',
          intervalCount: 1,
          anchorDate: '2027-02-28',
          billingDay: 31,
          endDate: endsOn,
          autoRenew: false,
        },
        tagIds: [TAG],
        rankOverrides: { 'streaming.ad-free': 'essential' },
        pinned: false,
      };
      check(
        `${label}: after Save and a reload, IndexedDB has the item changed, its id, tags and ranks kept`,
        Object.entries(expected).every(
          ([key, value]) => JSON.stringify(netflix[key]) === JSON.stringify(value),
        ) && netflix.region === undefined,
        JSON.stringify(netflix),
      );
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

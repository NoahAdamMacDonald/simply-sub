// M6.4 in the system Edge: the list editor (P5) on the real catalog, for a Canadian in Alberta, with a saved list,
// Work Related (Netflix Standard, and Mullvad VPN yearly), written to IndexedDB. In both themes at 1280 and 360 px,
// keyboard only: the name, the rows and the footer; a rename kept in the draft ("Unsaved changes"); 🗑 with focus
// moving to the next row and Undo in a snackbar; [+ Add from catalog] to Search in pick mode with no question, its
// banner naming the draft's name; a price back to the editor, which opens the item dialog (M6.5) that Escape closes,
// "Resumed unsaved changes" and a reload; leaving
// elsewhere asking "Discard changes?" (focus on Cancel, Escape stays); Save writing the list and landing on it. Then,
// at 1280 px: Cancel discarding everything (checked after a reload), Back refused and history kept, a name that's
// empty, Delete list, a list there isn't, and /lists/new's Cancel. With axe and no horizontal scroll.
// Usage: node check-list-edit.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });

  // ── The editor by keyboard, both themes at both widths ─────────────────────────────────────────
  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [WIDE, NARROW]) {
      const label = `${colorScheme} ${viewport.width}`;
      const { context, page } = await newPage(browser, label, { colorScheme, viewport });
      await firstRun(page);
      await plantList(page);
      await openEditor(page);

      const shownTitles = await titles(page);
      const shownFooter = await footer(page);
      check(
        `${label}: the list's name, its items and what it costs a month`,
        (await page.locator('ss-list-edit-page h1').textContent()).trim() === 'Edit list' &&
          (await nameField(page).inputValue()) === 'Work Related' &&
          shownTitles.join(' | ') === 'Netflix · Standard | Mullvad VPN' &&
          (await page.locator('li.item .details').first().textContent()).trim() ===
            'Monthly · auto-renews · 1 custom rank' &&
          (await page.locator('li.item ss-tag-chip').first().textContent()).trim() === 'Family' &&
          /^No unsaved changes · ≈ \$\d+\.\d\d \/ mo average$/.test(shownFooter),
        `${shownTitles.join(' | ')} / ${shownFooter}`,
      );
      await noSideScroll(page, viewport, `${label}, the editor`);
      await page.screenshot({
        path: path.join(outDir, `editor-${colorScheme}-${viewport.width}.png`),
        fullPage: true,
      });
      await axeCheck(page, `${label}, the editor`);

      // A new name, typed after Tab reaches the field.
      await page.locator('ss-list-edit-page h1').click();
      await keyTo(page, () => document.activeElement?.matches('.toolbar input'));
      await page.keyboard.press('End');
      await page.keyboard.type(' Team');
      await until(
        'the name stored',
        async () => (await draftOf(page))?.name === 'Work Related Team',
      );
      await until('Unsaved changes', async () =>
        (await footer(page)).startsWith('Unsaved changes ·'),
      );
      check(
        `${label}: a new name is kept in the draft as it's typed, and the footer says so`,
        true,
      );

      // 🗑 by keyboard: focus moves to the next row, and Undo in the snackbar puts it back.
      await keyTo(
        page,
        () => document.activeElement?.getAttribute('aria-label') === 'Remove Netflix Standard',
      );
      await page.keyboard.press('Enter');
      await until('one row', async () => (await page.locator('li.item').count()) === 1);
      await until(
        'focus on the next row',
        async () => (await focusedName(page)) === 'Remove Mullvad VPN',
      );
      const snackBar = page.locator('.mat-mdc-snack-bar-container');
      await snackBar.waitFor();
      await sleep(600);
      check(
        `${label}: 🗑 removes the row, moves focus to the next row's 🗑, and offers Undo`,
        (await snackBar.textContent()).includes('Removed Netflix Standard'),
        await snackBar.textContent(),
      );
      await page.screenshot({
        path: path.join(outDir, `editor-undo-${colorScheme}-${viewport.width}.png`),
      });
      await axeCheck(page, `${label}, the Undo snackbar`);
      await snackBar.getByRole('button', { name: 'Undo' }).click();
      await until('two rows', async () => (await page.locator('li.item').count()) === 2);
      await until(
        'focus on the row put back',
        async () => (await focusedName(page)) === 'Remove Netflix Standard',
      );
      check(`${label}: Undo puts the row back, with focus on its 🗑`, true);

      // [+ Add from catalog]: Search in pick mode for this list, with no question asked.
      await keyTo(
        page,
        () => document.activeElement?.classList.contains('add-from-catalog'),
        'Shift+Tab',
      );
      await page.keyboard.press('Enter');
      const banner = page.locator('.pinned .pick p');
      await banner.waitFor({ timeout: 20000 });
      await page.locator('ss-sub-card').first().waitFor({ timeout: 20000 });
      check(
        `${label}: [+ Add from catalog] opens pick mode with no question, naming the draft's name`,
        (await banner.textContent()).replace(/\s+/g, ' ').trim() ===
          'Adding to Work Related Team' && (await dialog(page).count()) === 0,
        await banner.textContent(),
      );

      // A price by keyboard comes back to the editor, which resumes the draft and opens the item dialog for it, then
      // drops the request from the URL. Escape closes the dialog, adding nothing.
      await keyTo(page, () => !!document.activeElement?.closest('ss-sub-card ss-price'));
      await page.keyboard.press('Enter');
      await until('the editor', () => pathOf(page) === `/lists/${LIST}/edit`);
      const itemDialog = page.locator('ss-item-dialog');
      await itemDialog.waitFor({ timeout: 20000 });
      const resumed = page.locator('[role=status]', { hasText: 'Resumed unsaved changes' });
      await resumed.waitFor();
      check(
        `${label}: a price comes back to the editor, which says it resumed the changes and opens the item dialog`,
        (await nameField(page).inputValue()) === 'Work Related Team' &&
          (await itemDialog.locator('h2').textContent()).trim() === 'Add subscription' &&
          search(page) === '',
        page.url(),
      );
      await sleep(500);
      await page.keyboard.press('Escape');
      await itemDialog.waitFor({ state: 'detached' });
      await page.screenshot({
        path: path.join(outDir, `editor-resumed-${colorScheme}-${viewport.width}.png`),
        fullPage: true,
      });
      await axeCheck(page, `${label}, the resumed editor`);
      await page.reload();
      await resumed.waitFor({ timeout: 20000 });
      await page.locator('li.item').nth(1).waitFor();
      check(
        `${label}: a reload keeps the changes`,
        (await nameField(page).inputValue()) === 'Work Related Team' &&
          (await page.locator('li.item').count()) === 2,
      );

      // Anywhere else asks "Discard changes?", with focus on Cancel; Escape stays.
      if (viewport === NARROW) {
        await page.getByRole('button', { name: 'Menu' }).click();
        await sleep(600);
      }
      await page.locator('nav[aria-label=Main]').getByRole('link', { name: 'Lists' }).click();
      await dialog(page).waitFor();
      await sleep(600);
      check(
        `${label}: leaving for Lists asks "Discard changes?", with focus on Cancel`,
        (await dialog(page).locator('h2').textContent()).trim() === 'Discard changes?' &&
          (await focusedName(page)) === 'Cancel',
        await focusedName(page),
      );
      await page.screenshot({
        path: path.join(outDir, `editor-discard-${colorScheme}-${viewport.width}.png`),
      });
      await axeCheck(page, `${label}, "Discard changes?"`);
      await page.keyboard.press('Escape');
      await dialog(page).waitFor({ state: 'detached' });
      await sleep(400);
      check(
        `${label}: Escape keeps the editor and the changes`,
        pathOf(page) === `/lists/${LIST}/edit` &&
          (await draftOf(page))?.name === 'Work Related Team',
        page.url(),
      );
      if (viewport === NARROW) {
        // The drawer stayed open behind the question.
        await page.keyboard.press('Escape');
        await sleep(400);
      }

      // Save by keyboard: the list and its items written, and the list opened in the editor's place.
      await nameField(page).focus();
      await keyTo(page, () => document.activeElement?.textContent?.trim() === 'Save');
      await page.keyboard.press('Enter');
      await until('the list', () => pathOf(page) === `/lists/${LIST}`);
      const list = (await readTable(page, 'lists')).find((candidate) => candidate.id === LIST);
      const items = await readTable(page, 'items');
      check(
        `${label}: Save writes the list and lands on the list view`,
        list.name === 'Work Related Team' &&
          items.every((item) => item.deletedAt === undefined) &&
          (await draftOf(page)) === undefined,
        `${list.name}, ${items.length} items`,
      );
      await context.close();
    }
  }

  // ── Cancel, Back, the name, Delete list, a list there isn't and a new list (light, 1280 px) ──────────
  {
    const { context, page } = await newPage(browser, 'cancel');
    await firstRun(page);
    await plantList(page);

    // Cancel discards everything, checked after a reload.
    await openEditor(page);
    await page.getByRole('button', { name: 'Remove Netflix Standard' }).click();
    await until('one row', async () => (await page.locator('li.item').count()) === 1);
    await nameField(page).fill('Changed');
    await until('the name stored', async () => (await draftOf(page))?.name === 'Changed');
    await page.reload();
    await page.locator('li.item').first().waitFor({ timeout: 20000 });
    const keptOverReload =
      (await page.locator('li.item').count()) === 1 &&
      (await nameField(page).inputValue()) === 'Changed';
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dialog(page).waitFor();
    await dialog(page).getByRole('button', { name: 'Discard changes' }).click();
    await until('the list', () => pathOf(page) === `/lists/${LIST}`);
    await page.reload();
    await openEditor(page);
    check(
      'Cancel after a reload discards the changes: the list and its items are as saved',
      keptOverReload &&
        (await nameField(page).inputValue()) === 'Work Related' &&
        (await page.locator('li.item').count()) === 2 &&
        (await page.locator('ss-list-edit-page [role=status]').count()) === 0 &&
        (await readTable(page, 'items')).every((item) => item.deletedAt === undefined),
    );

    // Back with changes asks; Escape stays, with the history as it was. The editor is opened in the app, from
    // Search's Add to list menu, so Back is the router's (a page.goto would start a new document).
    await page.goto(`${baseUrl}search`);
    await page.locator('ss-sub-card ss-price button').first().click();
    await page.getByRole('menuitem', { name: /^Work Related/ }).click();
    await until('the editor', () => pathOf(page) === `/lists/${LIST}/edit`);
    await page.locator('li.item').nth(1).waitFor({ timeout: 20000 });
    // The price opens the item dialog (M6.5); Escape closes it, adding nothing.
    await page.locator('ss-item-dialog').waitFor({ timeout: 20000 });
    await sleep(500);
    await page.keyboard.press('Escape');
    await page.locator('ss-item-dialog').waitFor({ state: 'detached' });
    const before = await entries(page);
    await nameField(page).fill('Work');
    await until('the name stored', async () => (await draftOf(page))?.name === 'Work');
    await page.evaluate(() => history.back());
    await dialog(page).waitFor();
    await page.keyboard.press('Escape');
    await dialog(page).waitFor({ state: 'detached' });
    await sleep(500);
    const stayedAt = `${page.url()} ${await entries(page)} entries`;
    const stayed = pathOf(page) === `/lists/${LIST}/edit` && (await entries(page)) === before;
    await page.evaluate(() => history.back());
    await dialog(page).waitFor();
    await dialog(page).getByRole('button', { name: 'Discard changes' }).click();
    // Back changes the address at once: Search is there once the editor has gone.
    await page.locator('ss-list-edit-page').waitFor({ state: 'detached' });
    check(
      'Back with changes asks: Escape stays on the editor with the history kept, and Discard goes back',
      stayed && (await draftOf(page)) === undefined,
      `${before} entries; after Escape: ${stayedAt}`,
    );

    // An empty name can't be saved: the field says so and has focus.
    await openEditor(page);
    await nameField(page).fill('');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const error = page.locator('mat-error');
    await error.waitFor();
    check(
      'an empty name keeps the editor, with "Give the list a name" at the field and focus on it',
      (await error.textContent()).trim() === 'Give the list a name' &&
        (await nameField(page).evaluate((input) => input === document.activeElement)) &&
        pathOf(page) === `/lists/${LIST}/edit`,
    );
    await page.screenshot({ path: path.join(outDir, 'editor-no-name.png') });
    await axeCheck(page, 'light 1280, an empty name');
    await nameField(page).fill('Work Related');

    // ⋮ Delete list, after asking.
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete list' }).click();
    await dialog(page).waitFor();
    const title = (await dialog(page).locator('h2').textContent()).trim();
    await dialog(page).getByRole('button', { name: 'Delete list' }).click();
    await until('the lists', () => pathOf(page) === '/lists');
    const deleted = (await readTable(page, 'lists')).find((candidate) => candidate.id === LIST);
    check(
      '⋮ Delete list asks, then deletes the list and its items',
      title === 'Delete Work Related?' &&
        deleted.deletedAt !== undefined &&
        (await readTable(page, 'items')).every((item) => item.deletedAt !== undefined),
      title,
    );

    // A list there isn't, a deleted one included.
    await page.goto(editorUrl());
    const missing = page.locator('ss-empty-state');
    await missing.waitFor({ timeout: 20000 });
    check(
      "a deleted list's editor says it doesn't exist, with Back to lists",
      (await missing.locator('h2').textContent()).trim() === "This list doesn't exist" &&
        (await missing.getByRole('link', { name: 'Back to lists' }).getAttribute('href')) ===
          '/lists',
    );
    await page.screenshot({ path: path.join(outDir, 'editor-missing.png') });
    await axeCheck(page, "light 1280, a list that doesn't exist");

    // A new list: its own heading and tab title, and Cancel back to the lists with nothing to ask.
    await page.goto(`${baseUrl}lists/new`);
    await until('the new list editor', () => editorId(page));
    await page.locator('ss-list-edit-page p.footer').waitFor();
    const heading = (await page.locator('ss-list-edit-page h1').textContent()).trim();
    const tab = await page.title();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await until('the lists', () => pathOf(page) === '/lists');
    check(
      'a new list is headed New list, and Cancel goes to the lists without asking',
      heading === 'New list' &&
        tab === 'New list · Simply Sub' &&
        (await dialog(page).count()) === 0 &&
        (await readTable(page, 'drafts')).length === 0,
      `${heading} / ${tab}`,
    );
    await context.close();
  }

  await browser.close();
  check('no console errors or warnings', consoleProblems.length === 0, consoleProblems.join(' | '));
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

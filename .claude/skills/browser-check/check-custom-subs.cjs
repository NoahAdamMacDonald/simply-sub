// M6.6 in the system Edge: custom subscriptions (P12) on `ng serve`, for a Canadian in Alberta, with Work Related
// (Netflix Standard and Mullvad VPN) written to IndexedDB, and GET /icon answered with a logo. In both themes at 1280
// and 360 px, keyboard only: the page with none; New opening the editor (focus on its heading, 720 px wide or the
// whole screen), Save with nothing filled in showing each field's error; a name, a website, two plans, Ad free added
// at once and Video quality after its value; Save storing it (read from IndexedDB) with its row, icon, snackbar and
// focus on its ✎; the list editor's [+ Add custom subscription] menu (flow F3) adding it through the item dialog;
// ✎ with a cost changed asking how many list items it reaches; and 🗑 asking "Also remove it from 1 list." and
// deleting it with its item. With axe on the page, the editor, its errors, a feature's value, the menu and the
// questions, and no horizontal scroll.
// Usage: node check-custom-subs.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

const customDialog = (page) => page.locator('ss-custom-sub-dialog');
const itemDialog = (page) => page.locator('ss-item-dialog');
const snackBar = (page) => page.locator('.mat-mdc-snack-bar-container');
const focusedLabel = (page) =>
  page.evaluate(() =>
    document.activeElement
      ?.closest('mat-form-field')
      ?.querySelector('mat-label')
      ?.textContent?.trim(),
  );

/** Presses Tab until focus is in the field labelled `label` inside `scope`, or until the button with this text. */
function fieldIn(scope, label) {
  return new Function(
    `const field = document.activeElement?.closest('mat-form-field');
     return !!field?.closest(${JSON.stringify(scope)}) &&
       field.querySelector('mat-label')?.textContent.trim() === ${JSON.stringify(label)};`,
  );
}
function buttonIn(scope, text) {
  return new Function(
    `const el = document.activeElement;
     return !!el?.closest(${JSON.stringify(scope)}) &&
       (el.getAttribute('aria-label') === ${JSON.stringify(text)} ||
        el.textContent?.replace(/^\\s*(add|delete|close)\\s*/, '').trim() === ${JSON.stringify(text)});`,
  );
}

const rowsOf = (page) =>
  page
    .locator('ss-custom-subs-page li.sub')
    .evaluateAll((rows) =>
      rows.map(
        (row) =>
          `${row.querySelector('.name').textContent.trim()} / ${row.querySelector('.details').textContent.trim()}`,
      ),
    );

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  const logo = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'apps', 'web', 'public', 'icons', 'proton.webp'),
  );

  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [WIDE, NARROW]) {
      const label = `${colorScheme} ${viewport.width}`;
      const shot = (name) => path.join(outDir, `${name}-${colorScheme}-${viewport.width}.png`);
      const { context, page } = await newPage(browser, label, { colorScheme, viewport });
      // GET /icon, as the Worker answers for a site with an icon (no Worker behind the dev proxy).
      const iconRequests = [];
      await context.route('**/api/v1/icon?**', (route) => {
        iconRequests.push(new URL(route.request().url()).search);
        return route.fulfill({ body: logo, contentType: 'image/webp' });
      });
      await firstRun(page);
      await plantList(page);

      // ── The page with none, then New by keyboard: the editor's errors first ────────────────────────
      await page.goto(`${baseUrl}custom`);
      await page.locator('ss-custom-subs-page ss-empty-state').waitFor({ timeout: 20000 });
      check(
        `${label}: with none, the page says so under its heading and New custom subscription`,
        (await page.locator('ss-custom-subs-page h1').textContent()).trim() ===
          'Custom subscriptions' &&
          (await page.locator('ss-custom-subs-page ss-empty-state h2').textContent()).trim() ===
            'No custom subscriptions yet',
      );
      await noSideScroll(page, viewport, `${label}, no custom subscriptions`);
      await axeCheck(page, `${label}, no custom subscriptions`);
      // The back button (the feedback after M6.9): the first stop (a click on the title focuses <main>), to Lists.
      await page.locator('ss-custom-subs-page h1').click();
      await page.keyboard.press('Tab');
      check(
        `${label}: the first stop is the back button, to Lists`,
        await page.evaluate(
          () =>
            document.activeElement?.classList.contains('back') &&
            document.activeElement.getAttribute('href') === '/lists' &&
            document.activeElement.querySelector('.mdc-button__label')?.textContent.trim() ===
              'Lists',
        ),
      );

      await page.locator('ss-custom-subs-page h1').click();
      await keyTo(page, () => document.activeElement?.classList.contains('new'));
      await page.keyboard.press('Enter');
      await customDialog(page).waitFor();
      await sleep(600);
      const box = await page.locator('.cdk-overlay-pane.ss-wide-dialog').boundingBox();
      check(
        `${label}: New opens the editor, focus on its heading, ${viewport === NARROW ? 'the whole screen' : '720 px wide'}`,
        (await page.evaluate(() => document.activeElement?.matches('ss-custom-sub-dialog h2'))) &&
          (viewport === NARROW
            ? Math.round(box.width) === viewport.width && Math.round(box.height) === viewport.height
            : Math.round(box.width) === 720),
        JSON.stringify(box),
      );
      await keyTo(page, buttonIn('ss-custom-sub-dialog', 'Save'), 'Tab', 80);
      await page.keyboard.press('Enter');
      await customDialog(page).locator('mat-error').first().waitFor();
      const errors = await customDialog(page)
        .locator('mat-error')
        .evaluateAll((all) => all.map((error) => error.textContent.trim()));
      check(
        `${label}: Save with nothing filled in says what's missing at each field, with focus on the name`,
        errors.join(' | ') ===
          'Give it a name | Give the plan a name | Enter what it costs, 0 or more' &&
          (await focusedLabel(page)) === 'Name',
        errors.join(' | '),
      );
      // The errors fade in.
      await sleep(500);
      await page.screenshot({ path: shot('custom-errors') });
      await axeCheck(page, `${label}, the editor's errors`);

      // ── Filled in by keyboard: two plans, a yes-or-no feature and one that asks for its value ─────────
      await page.keyboard.type('Local Gym');
      await keyTo(page, fieldIn('ss-custom-sub-dialog', 'Website'));
      await page.keyboard.type('https://www.localgym.ca');
      await keyTo(page, fieldIn('ss-custom-sub-dialog', 'Plan name'));
      await page.keyboard.type('Basic');
      await keyTo(page, fieldIn('ss-custom-sub-dialog', 'Cost'));
      await page.keyboard.type('29.99');
      await keyTo(page, fieldIn('ss-custom-sub-dialog', 'Add a feature'), 'Tab', 20);
      await page.keyboard.type('ad free');
      await page.locator('.mat-mdc-autocomplete-panel mat-option').first().waitFor();
      await sleep(200);
      await page.keyboard.press('Enter');
      await until('Ad free listed', async () =>
        (await customDialog(page).locator('.feature-text').allTextContents()).includes('Ad free'),
      );
      await page.keyboard.type('video');
      await page.locator('.mat-mdc-autocomplete-panel mat-option').first().waitFor();
      await sleep(200);
      await page.keyboard.press('Enter');
      const value = customDialog(page).locator('.value');
      await value.waitFor();
      await until('focus on the value', () =>
        page.evaluate(() => !!document.activeElement?.closest('ss-custom-sub-dialog .value')),
      );
      await sleep(400);
      await page.screenshot({ path: shot('custom-feature-value') });
      await axeCheck(page, `${label}, a feature's value asked for`);
      await page.keyboard.press('Enter');
      await page.locator('.mat-mdc-select-panel mat-option').first().waitFor();
      await keyTo(
        page,
        () =>
          document.querySelector('mat-option.mat-mdc-option-active')?.textContent.includes('4K'),
        'ArrowDown',
        5,
      );
      await page.keyboard.press('Enter');
      await sleep(300);
      await keyTo(page, buttonIn('ss-custom-sub-dialog .value', 'Add feature'), 'Tab', 5);
      await page.keyboard.press('Enter');
      await value.waitFor({ state: 'detached' });
      const features = await customDialog(page).locator('.feature-text').allTextContents();
      check(
        `${label}: Ad free is added at once, and Video quality after its value, by keyboard`,
        features.map((text) => text.trim()).join(' | ') ===
          'Video quality: 4K (Ultra HD) | Ad free' &&
          (await focusedLabel(page)) === 'Add a feature',
        features.join(' | '),
      );

      await keyTo(page, buttonIn('ss-custom-sub-dialog', 'New plan'), 'Tab', 20);
      await page.keyboard.press('Enter');
      await until('focus on the new plan’s name', () =>
        page.evaluate(
          () => document.activeElement === document.querySelectorAll('.plan-name input')[1],
        ),
      );
      await page.keyboard.type('Premium');
      await keyTo(page, fieldIn('ss-custom-sub-dialog', 'Cost'));
      await page.keyboard.type('49.99');
      await keyTo(page, fieldIn('ss-custom-sub-dialog', 'Billed every'));
      await page.keyboard.press('Control+A');
      await page.keyboard.type('3');
      await noSideScroll(page, viewport, `${label}, the editor with two plans`);
      await page.screenshot({ path: shot('custom-editor'), fullPage: true });
      await axeCheck(page, `${label}, the editor with two plans`);
      await keyTo(page, buttonIn('ss-custom-sub-dialog', 'Save'), 'Tab', 80);
      await page.keyboard.press('Enter');
      await customDialog(page).waitFor({ state: 'detached' });
      await until('the row', async () => (await rowsOf(page)).length === 1);
      await until('focus on its ✎', async () => (await focusedName(page)) === 'Edit Local Gym');
      const [stored] = await readTable(page, 'customSubs');
      check(
        `${label}: Save stores it, shows its row with its icon and says so, with focus on its ✎`,
        (await rowsOf(page))[0] === 'Local Gym / 2 plans · not used' &&
          (await snackBar(page).textContent()).includes('Added Local Gym') &&
          iconRequests.includes('?domain=www.localgym.ca') &&
          stored.name === 'Local Gym' &&
          stored.link === 'https://www.localgym.ca' &&
          JSON.stringify(
            stored.plans.map((plan) => [plan.name, plan.price.amount, plan.price.intervalCount]),
          ) ===
            JSON.stringify([
              ['Basic', 29.99, 1],
              ['Premium', 49.99, 3],
            ]) &&
          JSON.stringify(stored.plans[0].features) ===
            JSON.stringify({ 'streaming.ad-free': true, 'video.quality': '4k' }),
        `${(await rowsOf(page)).join(' | ')} / ${iconRequests.join(' ')} / ${JSON.stringify(stored.plans)}`,
      );
      await sleep(600);
      await page.screenshot({ path: shot('custom-page') });
      await axeCheck(page, `${label}, the page with one`);

      // ── The list editor's [+ Add custom subscription], by keyboard (flow F3) ──────────────────────
      await openEditor(page);
      await page.locator('ss-list-edit-page h1').click();
      await keyTo(page, () => document.activeElement?.classList.contains('add-custom'));
      await page.keyboard.press('Enter');
      const menu = page.locator('.mat-mdc-menu-panel');
      await menu.waitFor();
      await sleep(400);
      const menuItems = await menu
        .locator('[mat-menu-item]')
        .evaluateAll((items) =>
          items.map((item) => item.textContent.replace(/^\s*add/, '').trim()),
        );
      check(
        `${label}: [+ Add custom subscription] lists them, then Create new…`,
        menuItems.join(' | ') === 'Local Gym | Create new…',
        menuItems.join(' | '),
      );
      await axeCheck(page, `${label}, the custom subscription menu`);
      await page.keyboard.press('Enter');
      await itemDialog(page).waitFor({ timeout: 20000 });
      await sleep(500);
      check(
        `${label}: picking one opens the item dialog for it`,
        (await itemDialog(page).locator('.subject .name').textContent()).trim() === 'Local Gym',
      );
      await keyTo(page, buttonIn('ss-item-dialog', 'Add to list'), 'Tab', 150);
      await page.keyboard.press('Enter');
      await itemDialog(page).waitFor({ state: 'detached' });
      await until('the row', async () => (await titles(page)).includes('Local Gym · Basic'));
      await keyTo(page, () => document.activeElement?.textContent?.trim() === 'Save', 'Shift+Tab');
      await page.keyboard.press('Enter');
      await until('the list', () => pathOf(page) === `/lists/${LIST}`);
      const custom = (await readTable(page, 'items')).find((item) => item.source.kind === 'custom');
      check(
        `${label}: Add and Save put it in the list`,
        custom?.source.customSubId === stored.id &&
          custom.source.customPlanId === stored.plans[0].id,
        JSON.stringify(custom?.source),
      );

      // ── ✎ with a change that reaches the list, then 🗑, both after asking ─────────────────────────────
      await page.goto(`${baseUrl}custom`);
      await until(
        'its use',
        async () => (await rowsOf(page))[0] === 'Local Gym / 2 plans · used in 1 list',
      );
      await page.locator('ss-custom-subs-page h1').click();
      await keyTo(
        page,
        () => document.activeElement?.getAttribute('aria-label') === 'Edit Local Gym',
      );
      await page.keyboard.press('Enter');
      await customDialog(page).waitFor();
      await sleep(500);
      await keyTo(page, fieldIn('ss-custom-sub-dialog', 'Cost'));
      await page.keyboard.press('Control+A');
      await page.keyboard.type('31.99');
      await keyTo(page, buttonIn('ss-custom-sub-dialog', 'Save'), 'Tab', 80);
      await page.keyboard.press('Enter');
      const question = page.locator('ss-confirm-dialog');
      await question.waitFor();
      await sleep(600);
      check(
        `${label}: saving a change to a plan in use says how many it reaches`,
        (await question.locator('h2').textContent()).trim() === 'Save changes to Local Gym?' &&
          (await question.locator('p').textContent()).trim() ===
            '1 subscription in your lists uses a plan you changed, and changes with it.' &&
          (await focusedName(page)) === 'Save changes',
      );
      await axeCheck(page, `${label}, the question before a change`);
      await page.keyboard.press('Enter');
      await customDialog(page).waitFor({ state: 'detached' });
      await until(
        'the change stored',
        async () => (await readTable(page, 'customSubs'))[0].plans[0].price.amount === 31.99,
      );
      check(`${label}: and then saves it`, true);

      await until('focus back on ✎', async () => (await focusedName(page)) === 'Edit Local Gym');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await question.waitFor();
      await sleep(600);
      check(
        `${label}: 🗑 asks first, saying it also leaves the list, with focus on Cancel`,
        (await question.locator('p').textContent()).trim() === 'Also remove it from 1 list.' &&
          (await focusedName(page)) === 'Cancel',
      );
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await page.locator('ss-custom-subs-page ss-empty-state').waitFor();
      await until('focus on New', () =>
        page.evaluate(() => document.activeElement?.classList.contains('new')),
      );
      const [deletedSub] = await readTable(page, 'customSubs');
      const deletedItem = (await readTable(page, 'items')).find(
        (item) => item.source.kind === 'custom',
      );
      check(
        `${label}: Delete removes it and its item together, and focus goes to New`,
        deletedSub.deletedAt !== undefined && deletedItem.deletedAt !== undefined,
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

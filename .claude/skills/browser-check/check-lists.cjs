// M6.7 in the system Edge: the Lists overview (P3) on `ng serve`, for a Canadian in Alberta. In both themes at 1280
// and 360 px, keyboard only: with no lists, the hint and New Subscription List (Enter opens a new list's editor); then
// Work Related (Netflix Standard with Ad free ranked Essential, and Mullvad VPN) and Family (empty), with 1080p ranked
// Wanted, written to IndexedDB: each card's cost, count and rank counts, the feature summary of every list, the Tab
// order, View, and 🗑 asking first (focus on Cancel), deleting the list with its subscriptions (read from IndexedDB),
// moving focus on, and Undo putting them back. With axe on the page, the question and the snackbar, and no horizontal
// scroll.
// Usage: node check-lists.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

const FAMILY = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';
const snackBar = (page) => page.locator('.mat-mdc-snack-bar-container');
/** Each card as it shows: its name, cost and count, and the ranks it counts (words only screen readers get left out). */
const cardsOf = (page) =>
  page.locator('ss-lists-overview-page li.card').evaluateAll((cards) =>
    cards.map((card) => {
      const shown = (element) => {
        const copy = element.cloneNode(true);
        copy.querySelectorAll('.visually-hidden').forEach((hidden) => hidden.remove());
        return copy.textContent.replace(/\s+/g, ' ').trim();
      };
      const ranks = [...card.querySelectorAll('ss-rank-counts li')]
        .map(shown)
        .filter((rank) => !rank.startsWith('0 '));
      return `${shown(card.querySelector('.name'))} | ${shown(card.querySelector('.cost'))} | ${ranks.join(', ')}`;
    }),
  );

/** Work Related and Family, and the profile's rank of 1080p (Netflix Standard has Ad free Essential of its own). */
async function plantLists(page) {
  await plantList(page);
  await putRecord(page, 'lists', {
    id: FAMILY,
    name: 'Family',
    ...stamps,
    createdAt: '2026-10-21T12:00:00.000Z',
  });
  await putRecord(page, 'rankings', {
    rankKey: 'video.quality=1080p',
    rank: 'wanted',
    createdAt: stamps.createdAt,
    updatedAt: stamps.updatedAt,
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

      // ── No lists: the hint and the tile, by keyboard to a new list ──────────────────────────────
      await page.goto(`${baseUrl}lists`);
      await page.locator('ss-lists-overview-page .new-list').waitFor({ timeout: 20000 });
      check(
        `${label}: with no lists, a hint and New Subscription List, and no feature column`,
        (await page.locator('ss-lists-overview-page .hint').count()) === 1 &&
          (await page.locator('ss-lists-overview-page li.card').count()) === 0 &&
          (await page.locator('ss-lists-overview-page .features').count()) === 0,
      );
      await noSideScroll(page, viewport, `${label}, no lists`);
      await page.screenshot({ path: shot('lists-empty') });
      await axeCheck(page, `${label}, no lists`);
      await page.locator('ss-lists-overview-page h1').click();
      await keyTo(page, () => document.activeElement?.classList.contains('new-list'));
      await page.keyboard.press('Enter');
      await until('a new list’s editor', () => editorId(page));
      check(`${label}: Enter on New Subscription List opens a new list’s editor`, true);

      // ── Two lists, their costs, ranks and the summary ───────────────────────────────────────
      await plantLists(page);
      await page.goto(`${baseUrl}lists`);
      await until('both cards', async () => (await cardsOf(page)).length === 2);
      await until('the prices', async () => (await cardsOf(page))[0].includes('mo average'));
      const shown = await cardsOf(page);
      const features = await page
        .locator('ss-lists-overview-page ss-feature-summary li')
        .evaluateAll((rows) =>
          rows.map(
            (row) =>
              `${row.querySelector('.label').textContent.trim()} ${row.querySelector('[aria-hidden]').textContent.trim()} (${row.querySelector('.visually-hidden').textContent.trim()})`,
          ),
        );
      check(
        `${label}: each list with what it costs, how many it has and its rank counts, in the order made`,
        /^Work Related \| ≈ \$\d+\.\d\d \/ mo average · 2 subscriptions \| 1 Essential, 1 Wanted$/.test(
          shown[0],
        ) && shown[1] === 'Family | No subscriptions yet | ',
        shown.join(' / '),
      );
      // Ranked and headline rows first, then what the items have themselves, folded after 8 (the feedback after M6.8).
      const showAll = page.locator('ss-lists-overview-page ss-feature-summary button.more');
      check(
        `${label}: the feature summary covers every list, ranked rows and the VPN headline first, read as "1 of 1 active", folded after 8`,
        features.slice(0, 3).join(' | ') ===
          'Ad free: 1 / 1 (1 of 1 active) | Video quality: 1080p (Full HD): 1 / 1 (1 of 1 active) | VPN: 1 / 1 (1 of 1 active)' &&
          features.length === 8 &&
          /^Show all \d+$/.test((await showAll.textContent()).trim()),
        features.join(' | '),
      );
      const types = await page
        .locator('ss-lists-overview-page ss-type-counts li')
        .evaluateAll((rows) =>
          rows.map(
            (row) =>
              `${row.querySelector('.label').textContent.trim()} ${row.querySelector('span:last-child').textContent.trim()}`,
          ),
        );
      check(
        `${label}: the types of every list together: a streaming service and a VPN`,
        types.length === 2 &&
          types.every((type) => type.endsWith(': 1')) &&
          types.includes('VPN: 1'),
        types.join(' | '),
      );
      await noSideScroll(page, viewport, `${label}, two lists`);
      await page.screenshot({ path: shot('lists'), fullPage: true });
      await axeCheck(page, `${label}, two lists`);

      // The Tab order: Custom subscriptions, then each card's name, 🗑 and View, then the tile.
      await page.locator('ss-lists-overview-page h1').click();
      const stops = [];
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('Tab');
        // A link's line ends in a colon, before its URL.
        stops.push((await stop(page)).replace(/:$/, ''));
      }
      const order = stops.slice(stops.indexOf('link "Custom subscriptions"'));
      check(
        `${label}: Tab goes Custom subscriptions, each card's name, 🗑 and View, then the tile`,
        order.slice(0, 8).join(' | ') ===
          [
            'link "Custom subscriptions"',
            'link "Work Related"',
            'button "Delete Work Related"',
            'link "View Work Related"',
            'link "Family"',
            'button "Delete Family"',
            'link "View Family"',
            'link "New Subscription List"',
          ].join(' | '),
        stops.join(' | '),
      );

      // View, by keyboard.
      await page.locator('ss-lists-overview-page h1').click();
      await keyTo(
        page,
        () => document.activeElement?.getAttribute('aria-label') === 'View Work Related',
      );
      await page.keyboard.press('Enter');
      await until('the list view', () => pathOf(page) === `/lists/${LIST}`);
      check(`${label}: View opens the list`, true);
      await page.goBack();
      await until('the lists', async () => (await cardsOf(page)).length === 2);

      // 🗑 by keyboard: the question (focus on Cancel), then Delete list, Undo and focus.
      await page.locator('ss-lists-overview-page h1').click();
      await keyTo(
        page,
        () => document.activeElement?.getAttribute('aria-label') === 'Delete Work Related',
      );
      await page.keyboard.press('Enter');
      const question = page.locator('ss-confirm-dialog');
      await question.waitFor();
      await sleep(600);
      check(
        `${label}: 🗑 asks first, saying what goes with it, with focus on Cancel`,
        (await question.locator('h2').textContent()).trim() === 'Delete “Work Related”?' &&
          (await question.locator('p').textContent()).trim() ===
            'Its 2 subscriptions will be removed.' &&
          (await focusedName(page)) === 'Cancel',
      );
      await axeCheck(page, `${label}, the question`);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await until('one card', async () => (await cardsOf(page)).length === 1);
      await until('focus on Family’s 🗑', async () => (await focusedName(page)) === 'Delete Family');
      await snackBar(page).waitFor();
      await sleep(700);
      const items = await readTable(page, 'items');
      check(
        `${label}: Delete list removes it and its subscriptions, says so with Undo, and focus moves on`,
        (await snackBar(page).textContent()).includes('Deleted Work Related') &&
          (await readTable(page, 'lists')).find((list) => list.id === LIST)?.deletedAt !==
            undefined &&
          items
            .filter((item) => item.listId === LIST)
            .every((item) => item.deletedAt !== undefined),
      );
      await page.screenshot({ path: shot('lists-deleted') });
      await axeCheck(page, `${label}, the Undo snackbar`);
      await snackBar(page).getByRole('button', { name: 'Undo' }).click();
      await until('two cards', async () => (await cardsOf(page)).length === 2);
      await until(
        'focus back on its 🗑',
        async () => (await focusedName(page)) === 'Delete Work Related',
      );
      check(
        `${label}: Undo puts the list and its subscriptions back, with focus on its 🗑`,
        (await readTable(page, 'lists')).find((list) => list.id === LIST)?.deletedAt ===
          undefined &&
          (await readTable(page, 'items'))
            .filter((item) => item.listId === LIST)
            .every((item) => item.deletedAt === undefined),
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

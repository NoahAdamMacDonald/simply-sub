// M6.3 in the system Edge: list drafts kept in IndexedDB, on the real catalog, for a Canadian in Alberta. /lists/new
// makes a new list's draft and replaces its URL with /lists/<id>/edit (Back skips it); the editor's [+ Add from
// catalog] by keyboard opens Search in pick mode for the new list, whose banner names "Subscription List"; a price by
// keyboard comes back to the editor; a reload keeps the draft (read from IndexedDB, with nothing in the lists table)
// and pick mode's banner. Search's New list… lands on the new list's editor with one history entry, and a saved
// "Subscription List" makes the next one "Subscription List 2". Both themes at 1280 and 360 px, with axe.
// Usage: node check-drafts.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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
  const problems = result.violations.map(
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

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });

  // ── /lists/new → pick mode → a price → a reload, keyboard only, both themes at both widths ─────────
  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [WIDE, NARROW]) {
      const label = `${colorScheme} ${viewport.width}`;
      const { context, page } = await newPage(browser, label, { colorScheme, viewport });
      await firstRun(page);

      await page.goto(`${baseUrl}lists/new`);
      await until('the new list’s editor', () => editorId(page));
      const id = editorId(page);
      await page.getByRole('link', { name: 'Add from catalog' }).waitFor();
      const [draft] = await readTable(page, 'drafts');
      check(
        `${label}: /lists/new makes a new list’s draft and replaces its URL with its editor’s`,
        draft?.listId === id &&
          draft.isNew === true &&
          draft.name === 'Subscription List' &&
          draft.items.length === 0 &&
          (await readTable(page, 'lists')).length === 0,
        `${page.url()} ${JSON.stringify(draft)}`,
      );
      if (colorScheme === 'light' && viewport === WIDE) {
        await page.goBack();
        await until('Home', () => new URL(page.url()).pathname === '/');
        check('Back from the new list’s editor skips /lists/new', true, page.url());
        await page.goForward();
        await until('the editor again', () => editorId(page) === id);
      }
      await noSideScroll(page, viewport, `${label}, the new list’s editor`);
      await page.screenshot({
        path: path.join(outDir, `editor-new-${colorScheme}-${viewport.width}.png`),
      });
      await axeCheck(page, `${label}, the new list’s editor`);

      // [+ Add from catalog] by keyboard: Search in pick mode for the new list.
      await tabTo(page, () => !!document.activeElement?.matches('a[href*="addTo="]'));
      const link = await stop(page);
      await page.keyboard.press('Enter');
      const banner = page.locator('.pinned .pick');
      await banner.waitFor({ timeout: 20000 });
      await page.locator('ss-sub-card').first().waitFor({ timeout: 20000 });
      const bannerText = (await banner.locator('p').textContent()).replace(/\s+/g, ' ').trim();
      check(
        `${label}: [+ Add from catalog] by keyboard opens pick mode, its banner naming Subscription List`,
        link.startsWith('link "Add from catalog"') &&
          search(page) === `?addTo=${id}` &&
          bannerText === 'Adding to Subscription List',
        `${link} → ${page.url()} / ${bannerText}`,
      );
      await noSideScroll(page, viewport, `${label}, pick mode for the new list`);
      await page.screenshot({
        path: path.join(outDir, `pick-new-${colorScheme}-${viewport.width}.png`),
      });
      await axeCheck(page, `${label}, pick mode for the new list`);

      // A price by keyboard adds to it at once, back on the editor.
      await tabTo(page, () => !!document.activeElement?.closest('ss-sub-card ss-price'));
      const price = await stop(page);
      await page.keyboard.press('Enter');
      await until('the editor', () => editorId(page) === id);
      await page.locator('.adding').waitFor();
      const query = search(page);
      check(
        `${label}: Enter on a price says it adds to Subscription List, and opens its editor with the plan`,
        /^button ".*, add to Subscription List"$/.test(price) &&
          /^\?add=[a-z0-9.-]+&interval=(day|week|month|year)(&count=\d+)?$/.test(query),
        `${price} → ${query}`,
      );

      // A reload keeps the draft, read from IndexedDB, and pick mode's banner.
      await page.reload();
      await page.locator('.adding').waitFor({ timeout: 20000 });
      const drafts = await readTable(page, 'drafts');
      check(
        `${label}: after a reload the draft is still there, the same one, and the lists table is still empty`,
        editorId(page) === id &&
          search(page) === query &&
          drafts.length === 1 &&
          JSON.stringify(drafts[0]) === JSON.stringify(draft) &&
          (await readTable(page, 'lists')).length === 0,
        JSON.stringify(drafts),
      );
      await page.screenshot({
        path: path.join(outDir, `editor-reload-${colorScheme}-${viewport.width}.png`),
      });
      await axeCheck(page, `${label}, the editor after a reload`);
      await page.goto(`${baseUrl}search?addTo=${id}`);
      await banner.waitFor({ timeout: 20000 });
      check(
        `${label}: Search opened afresh keeps pick mode for the new list`,
        search(page) === `?addTo=${id}` &&
          (await banner.locator('p').textContent()).trim() === 'Adding to Subscription List',
        page.url(),
      );
      await context.close();
    }
  }

  // ── Search's New list…: one history entry, and the next default name ──────────────────────────
  {
    const { context, page } = await newPage(browser, 'new list');
    await firstRun(page);
    await page.goto(`${baseUrl}search`);
    const price = page.locator('ss-sub-card ss-price button').first();
    await price.waitFor({ timeout: 20000 });
    const before = await entries(page);
    await price.click();
    await page.getByRole('menuitem', { name: /New list/ }).click();
    await until('the new list’s editor', () => editorId(page));
    await page.locator('.adding').waitFor();
    const after = await entries(page);
    check(
      'New list… lands on the new list’s editor with the plan, one history entry after Search',
      /^\?add=[a-z0-9.-]+&interval=(day|week|month|year)(&count=\d+)?$/.test(search(page)) &&
        after === before + 1,
      `${page.url()}, ${before} → ${after} entries`,
    );
    await page.goBack();
    await until('Search', () => new URL(page.url()).pathname === '/search');
    check('Back from it goes to Search', true);

    await putRecord(page, 'lists', {
      id: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d',
      name: 'Subscription List',
      createdAt: '2026-10-20T12:00:00.000Z',
      updatedAt: '2026-10-20T12:00:00.000Z',
    });
    await page.goto(`${baseUrl}lists/new`);
    await until('the new list’s editor', () => editorId(page));
    const id = editorId(page);
    await page.getByRole('link', { name: 'Add from catalog' }).click();
    const banner = page.locator('.pinned .pick p');
    await banner.waitFor({ timeout: 20000 });
    const drafts = await readTable(page, 'drafts');
    check(
      'with a saved Subscription List, the next new list is Subscription List 2',
      (await banner.textContent()).replace(/\s+/g, ' ').trim() ===
        'Adding to Subscription List 2' &&
        drafts.find((draft) => draft.listId === id)?.name === 'Subscription List 2',
      drafts.map((draft) => draft.name).join(', '),
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

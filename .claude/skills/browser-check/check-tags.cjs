// M6.11 in the system Edge: Custom tags (P13) and the item dialog's Delete a tag (P6) on `ng serve`, for a Canadian
// in Alberta. It writes to IndexedDB Family and Work, and Work Related with Netflix Standard (tagged Family and Work)
// and Mullvad VPN (tagged Family).
// In both themes at 1280 and 360 px, keyboard only:
// - Settings' Custom tags: a row per tag with its colour named, ✎ renaming one in place (Enter saves, focus back on ✎),
//   another tag's name refused in any case (focus kept in the field) and Escape changing nothing;
// - the swatch opening the palette on the colour it has, an arrow key to the next preset, a hex colour, each saved;
// - ⊕ adding a tag in edit mode with a free colour, then ✕ deleting it at once (nothing uses it), focus moving on;
// - ✕ on a tag in use: the question ("Used by 1 subscription", focus on Cancel), then the tag gone from IndexedDB and
//   from the items;
// - the list editor's ✎ on Netflix, the dialog's Delete a tag menu by arrow keys, the question ("Used by 2
//   subscriptions"), the chip gone from the dialog, and every item and the draft without the tag;
// - List view with no tag chips, and its Sort menu's Tags turned off.
// With axe on the card, the editor, its error, the question, the menu and List view, and no horizontal scroll.
// Usage: node check-tags.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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
  // A name with a colon comes back quoted as a whole (the skill's gotchas).
  return snapshot
    .split('\n')[0]
    .replace(/^- /, '')
    .replace(/^'(.*)'$/, '$1');
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

const labelled = (name) =>
  `document.activeElement?.getAttribute('aria-label') === ${JSON.stringify(name)}`;
/** Tabs to the control named `name` (its aria-label). */
const tabToNamed = (page, name) => keyTo(page, labelled(name));

const LIST = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const NETFLIX = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0b';
const MULLVAD = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0c';
const FAMILY = '0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2d';
const WORK = '0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2e';
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };
const BLUE = '#1e88e5';
const INDIGO = '#3949ab';
// The first preset no tag has once Home is #12ab9f and Work red.
const ORANGE = '#fb8c00';

async function plant(page) {
  await putRecord(page, 'tags', { id: FAMILY, name: 'Family', color: BLUE, ...stamps });
  await putRecord(page, 'tags', {
    id: WORK,
    name: 'Work',
    color: '#e53935',
    ...stamps,
    createdAt: '2026-10-20T12:00:01.000Z',
  });
  await putRecord(page, 'lists', { id: LIST, name: 'Work Related', ...stamps });
  const billing = {
    mode: 'recurring',
    interval: 'month',
    intervalCount: 1,
    anchorDate: '2026-11-12',
    autoRenew: true,
  };
  for (const [id, planId, tagIds] of [
    [NETFLIX, 'netflix.standard', [FAMILY, WORK]],
    [MULLVAD, 'mullvad.vpn', [FAMILY]],
  ]) {
    await putRecord(page, 'items', {
      id,
      listId: LIST,
      source: { kind: 'catalog', planId },
      billing: { ...billing, autoRenew: planId !== 'mullvad.vpn' },
      tagIds,
      rankOverrides: {},
      pinned: false,
      ...stamps,
    });
  }
}

const card = (page) => page.locator('section[aria-labelledby="tags-heading"]');
const rows = (page) =>
  card(page)
    .locator('li .row')
    .evaluateAll((items) =>
      items.map(
        (row) =>
          `${row.querySelector('.name').textContent.trim()} (${row.querySelector('.swatch').getAttribute('aria-label')})`,
      ),
    );
const tagsOf = async (page) =>
  (await readTable(page, 'tags')).filter((tag) => tag.deletedAt === undefined);
const snackBar = (page) => page.locator('.mat-mdc-snack-bar-container');
const focusIsIn = (selector) => `!!document.activeElement?.closest(${JSON.stringify(selector)})`;

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });

  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [WIDE, NARROW]) {
      const label = `${colorScheme} ${viewport.width}`;
      const shot = (name) => path.join(outDir, `${name}-${colorScheme}-${viewport.width}.png`);
      const { context, page } = await newPage(browser, label, { colorScheme, viewport });
      await firstRun(page);
      await plant(page);

      // ── Settings' Custom tags ────────────────────────────────────────────────────────────
      await page.goto(`${baseUrl}settings`);
      await until('the tags', async () => (await rows(page)).length === 2);
      check(
        `${label}: Custom tags lists each tag with its colour named`,
        (await rows(page)).join(' | ') ===
          'Family (Colour of Family: Blue) | Work (Colour of Work: Red)',
        (await rows(page)).join(' | '),
      );
      await noSideScroll(page, viewport, `${label}, Settings`);
      await card(page).screenshot({ path: shot('tags-card') });
      await axeCheck(page, `${label}, Custom tags`);

      // Rename in place by keyboard.
      await page.locator('h1').click();
      await tabToNamed(page, 'Rename Family');
      await page.keyboard.press('Enter');
      await until('focus in the name', () => page.evaluate(focusIsIn('ss-tag-editor')));
      check(
        `${label}: ✎ opens the name in place, with focus in it`,
        (await stop(page)) === 'textbox "Name": Family',
        await stop(page),
      );
      await card(page).screenshot({ path: shot('tags-editing') });
      await axeCheck(page, `${label}, the editor`);
      await page.keyboard.press('Control+A');
      await page.keyboard.type('work');
      await page.keyboard.press('Enter');
      const error = card(page).locator('mat-error');
      await until('the error', async () => (await error.count()) > 0);
      check(
        `${label}: another tag's name is refused in any case, with focus kept in the field`,
        (await error.textContent()).trim() === "There's a tag called “Work” already" &&
          (await stop(page)).startsWith('textbox "Name"'),
        `${(await error.textContent()).trim()} / ${await stop(page)}`,
      );
      await axeCheck(page, `${label}, the editor's error`);
      await page.keyboard.press('Escape');
      await until('focus back on ✎', () => page.evaluate(labelled('Rename Family')));
      check(
        `${label}: Escape changes nothing and puts focus back on ✎`,
        (await tagsOf(page)).find((tag) => tag.id === FAMILY)?.name === 'Family',
      );
      await page.keyboard.press('Enter');
      await until('focus in the name', () => page.evaluate(focusIsIn('ss-tag-editor')));
      await page.keyboard.press('Control+A');
      await page.keyboard.type('Home');
      await page.keyboard.press('Enter');
      await until('the new name stored', async () =>
        (await tagsOf(page)).some((tag) => tag.id === FAMILY && tag.name === 'Home'),
      );
      await until('focus back on ✎', () => page.evaluate(labelled('Rename Home')));
      check(`${label}: Enter saves the new name, and focus goes back to its ✎`, true);

      // Recolour: the swatch opens the palette on the colour it has; an arrow key, then Save.
      await page.keyboard.press('Shift+Tab');
      check(
        `${label}: the swatch comes before ✎, named with its colour`,
        (await stop(page)) === 'button "Colour of Home: Blue"',
        await stop(page),
      );
      await page.keyboard.press('Enter');
      await until('focus on a colour', () => page.evaluate(focusIsIn('ss-tag-colours')));
      check(
        `${label}: the palette opens with focus on the colour it has`,
        (await stop(page)) === 'radio "Blue" [checked]',
        await stop(page),
      );
      await page.keyboard.press('ArrowRight');
      await until('Indigo', async () => (await stop(page)) === 'radio "Indigo" [checked]');
      await keyTo(page, `document.activeElement?.textContent?.trim() === 'Save'`);
      await page.keyboard.press('Enter');
      await until('Indigo stored', async () =>
        (await tagsOf(page)).some((tag) => tag.id === FAMILY && tag.color === INDIGO),
      );
      await until('focus back on the swatch', () =>
        page.evaluate(labelled('Colour of Home: Indigo')),
      );
      check(`${label}: an arrow key picks the next preset, saved, focus back on the swatch`, true);

      // Any hex colour.
      await page.keyboard.press('Enter');
      await until('focus on a colour', () => page.evaluate(focusIsIn('ss-tag-colours')));
      await keyTo(page, focusIsIn('mat-form-field.hex'));
      await page.keyboard.press('Control+A');
      await page.keyboard.type('#12AB9F');
      await page.keyboard.press('Enter');
      await until('the hex colour stored', async () =>
        (await tagsOf(page)).some((tag) => tag.id === FAMILY && tag.color === '#12ab9f'),
      );
      check(`${label}: a hex colour is saved in lower case`, true);

      // ⊕ New tag, then ✕ on it: nothing uses it, so it goes at once.
      await keyTo(page, `document.activeElement?.classList.contains('add')`);
      await page.keyboard.press('Enter');
      await until('focus in the new name', () => page.evaluate(focusIsIn('ss-tag-editor')));
      await page.keyboard.type('Gym');
      await page.keyboard.press('Enter');
      await until('Gym stored', async () => (await tagsOf(page)).some((tag) => tag.name === 'Gym'));
      const gym = (await tagsOf(page)).find((tag) => tag.name === 'Gym');
      await until('focus on its ✎', () => page.evaluate(labelled('Rename Gym')));
      check(
        `${label}: ⊕ adds a tag in edit mode with a colour no tag has, then focus is on its ✎`,
        gym.color === ORANGE,
        gym.color,
      );
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await until('Gym gone', async () => !(await tagsOf(page)).some((tag) => tag.name === 'Gym'));
      await snackBar(page).waitFor();
      await until('focus on the previous ✕', () => page.evaluate(labelled('Delete Work')));
      check(
        `${label}: ✕ on a tag nothing uses deletes it at once, says so, and moves focus on`,
        (await page.locator('ss-confirm-dialog').count()) === 0 &&
          (await snackBar(page).textContent()).includes('Deleted Gym'),
      );

      // ✕ on Work, which Netflix uses: the question first.
      await page.keyboard.press('Enter');
      const question = page.locator('ss-confirm-dialog');
      await question.waitFor();
      await sleep(600);
      check(
        `${label}: ✕ on a tag in use asks first, saying how many use it, with focus on Cancel`,
        (await question.locator('h2').textContent()).trim() === 'Delete “Work”?' &&
          (await question.locator('p').textContent()).trim() ===
            'Used by 1 subscription. It comes off them in every list.' &&
          (await page.evaluate(() => document.activeElement?.textContent?.trim())) === 'Cancel',
      );
      await page.screenshot({ path: shot('tags-question') });
      await axeCheck(page, `${label}, the question`);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await until('Work gone', async () => !(await tagsOf(page)).some((tag) => tag.id === WORK));
      const items = await readTable(page, 'items');
      check(
        `${label}: Delete tag takes it off every item`,
        items.every((item) => !item.tagIds.includes(WORK)) &&
          items.find((item) => item.id === NETFLIX)?.tagIds.join() === FAMILY,
      );
      await until('focus on ⊕ or a row', () =>
        page.evaluate(() => document.activeElement?.closest('ss-tags-setting') !== null),
      );
      check(
        `${label}: focus moves on to the last row's ✕`,
        (await stop(page)) === 'button "Delete Home"',
        await stop(page),
      );

      // ── The item dialog's Delete a tag ─────────────────────────────────────────────────────
      await page.goto(`${baseUrl}lists/${LIST}/edit`);
      await page.locator('li.item').nth(1).waitFor({ timeout: 20000 });
      await page.locator('h1').click();
      await keyTo(
        page,
        `/^Edit Netflix/.test(document.activeElement?.getAttribute('aria-label') ?? '')`,
      );
      await page.keyboard.press('Enter');
      const dialog = page.locator('mat-dialog-container');
      await dialog.waitFor();
      await until('the chip', async () => (await dialog.locator('mat-chip-row').count()) === 1);
      // The dialog puts focus on its heading once it's open: Tab from there.
      await until('focus on its heading', () =>
        page.evaluate(() => document.activeElement?.matches('mat-dialog-container h2') === true),
      );
      await tabToNamed(page, 'Delete a tag');
      await page.keyboard.press('Enter');
      const menu = page.locator('.mat-mdc-menu-panel');
      await menu.waitFor();
      await sleep(400);
      check(
        `${label}: Delete a tag opens a menu of the tags, with focus on the first`,
        (await menu.locator('[mat-menu-item]').allTextContents())
          .map((text) => text.trim())
          .join() === 'Home' && (await stop(page)) === 'menuitem "Home"',
        await stop(page),
      );
      await page.screenshot({ path: shot('tags-picker-menu') });
      await axeCheck(page, `${label}, the picker's menu`);
      await page.keyboard.press('Enter');
      await question.waitFor();
      await sleep(600);
      check(
        `${label}: the picker asks first too, counting the draft's items and the lists' once each`,
        (await question.locator('p').textContent()).trim() ===
          'Used by 2 subscriptions. It comes off them in every list.',
        (await question.locator('p').textContent()).trim(),
      );
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await until('Home gone', async () => (await tagsOf(page)).length === 0);
      await until(
        'the chip gone',
        async () => (await dialog.locator('mat-chip-row').count()) === 0,
      );
      const after = await readTable(page, 'items');
      const [draft] = await readTable(page, 'drafts');
      check(
        `${label}: deleting from the picker takes the tag off its chips, every item and the draft`,
        after.every((item) => item.tagIds.length === 0) &&
          draft.items.every(
            ({ item, saved }) => item.tagIds.length === 0 && (saved?.tagIds.length ?? 0) === 0,
          ),
      );
      check(
        `${label}: with no tag left, focus goes to the tag field and the menu's button goes`,
        (await dialog.locator('.delete-tags').count()) === 0 &&
          (await page.evaluate(() => document.activeElement?.matches('mat-chip-grid input'))),
      );
      await noSideScroll(page, viewport, `${label}, the item dialog`);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });

      // ── List view: no chips, and Tags turned off ──────────────────────────────────────────
      await page.goto(`${baseUrl}lists/${LIST}`);
      await page.locator('ss-item-card').nth(1).waitFor({ timeout: 20000 });
      await page.locator('h1').click();
      await keyTo(page, `document.activeElement?.classList.contains('filters-toggle')`);
      await page.keyboard.press('Enter');
      await page.locator('ss-list-filters').waitFor();
      check(
        `${label}: List view shows no tag chips, and its Tags filter says there are none`,
        (await page.locator('ss-item-card ss-tag-chip').count()) === 0 &&
          (await page.locator('ss-list-filters').textContent()).includes(
            'No subscription here has a tag',
          ),
      );
      await axeCheck(page, `${label}, List view with the Sort menu`);
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

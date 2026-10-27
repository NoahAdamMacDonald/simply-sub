// M6.2 in the system Edge: the Features page (P9) on the real catalog, for a Canadian in Alberta, in both themes at
// 1280 and 360 px. A card per feature category, all open before anything is listed; a rank chosen by keyboard, saved
// to IndexedDB at once and still there after a reload, with its colour down the row's edge; a parent's Set all by
// keyboard, which ranks every child and says so; a long set folded until opened; Find a feature and Ranked only, with
// the count they announce; Reset all through its confirmation, by keyboard; with a VPN in a list, only the categories
// the lists use start open, and rows say how many subscriptions provide them. Axe with a dropdown and the Set all menu
// open, no horizontal scroll, and no console errors. GET /fx is answered with fixed rates.
// Usage: node check-features.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

const CATEGORIES = [
  'Streaming',
  'VPN',
  'Storage',
  'Email',
  'Security & passwords',
  'AI',
  'Productivity & calendar',
  'Accounts & sharing',
];

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

async function until(what, condition, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await condition();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function newContext(browser, { colorScheme = 'light', viewport = WIDE } = {}) {
  const context = await browser.newContext({ locale: 'en-CA', colorScheme, viewport });
  await context.route('**/api/v1/fx?**', (route) =>
    route.fulfill({
      json: {
        data: {
          base: 'CAD',
          date: '2026-10-26',
          source: 'European Central Bank via Frankfurter',
          rates: { EUR: 0.6372, USD: 0.7243, GBP: 0.5571, CHF: 0.581, SEK: 7.097 },
        },
        meta: { fetchedAt: '2026-10-26T06:00:02Z', stale: false },
      },
    }),
  );
  return context;
}

async function newPage(context, label) {
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  return page;
}

/** Completes the first-run dialog for Alberta, then waits for the cards. */
async function openFeatures(page) {
  await page.goto(`${baseUrl}features`);
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
  await page.locator('ss-ranking-card').first().waitFor({ timeout: 20000 });
}

const card = (page, name) =>
  page.locator('ss-ranking-card', {
    has: page.locator('.title', { hasText: new RegExp(`^${name.replace(/[&]/g, '\\$&')}$`) }),
  });
const titles = (page) => page.locator('ss-ranking-card .title').allTextContents();

/** The focused element's role and accessible name, as an accessibility snapshot's first line gives them. */
async function stop(page) {
  const snapshot = await page.locator(':focus').ariaSnapshot();
  return snapshot.split('\n')[0].replace(/^- /, '');
}

/** Tabs until `matches` says the focused element is the one, at most `limit` times; returns how many it took. */
async function tabTo(page, matches, limit = 80) {
  for (let presses = 0; presses < limit; presses++) {
    if (await page.evaluate(matches)) return presses;
    await page.keyboard.press('Tab');
  }
  throw new Error('Tab never reached it');
}

/** The profile's ranks as stored, by key, leaving out the soft-deleted ones. */
async function storedRanks(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('simply-sub');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const all = db.transaction('rankings').objectStore('rankings').getAll();
          all.onsuccess = () => {
            db.close();
            resolve(
              Object.fromEntries(
                all.result
                  .filter((ranking) => ranking.deletedAt === undefined)
                  .map((ranking) => [ranking.rankKey, ranking.rank]),
              ),
            );
          };
        };
      }),
  );
}

/** Writes a list item to IndexedDB, as the item dialog will (M6.5), and reloads so the repositories read it. */
async function addItem(page, planId) {
  await page.evaluate(
    (value) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('simply-sub');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('items', 'readwrite');
          transaction.objectStore('items').put(value);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    {
      id: '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0b',
      listId: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d',
      source: { kind: 'catalog', planId },
      billing: {
        mode: 'recurring',
        interval: 'month',
        intervalCount: 1,
        anchorDate: '2026-09-10',
        autoRenew: true,
      },
      tagIds: [],
      rankOverrides: {},
      pinned: false,
      createdAt: '2026-10-20T12:00:00.000Z',
      updatedAt: '2026-10-20T12:00:00.000Z',
    },
  );
  await page.reload();
  await page.locator('ss-ranking-card').first().waitFor({ timeout: 20000 });
}

async function axeCheck(page, label) {
  await sleep(600);
  await page.evaluate(axeSource);
  const result = await page.evaluate(() => axe.run(document));
  // Material renders menus and select panels outside the page's landmarks (the skill's gotchas): set aside `region`
  // hits that are all inside its overlay container.
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

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });

  // ── Keyboard only: rank, Set all, fold, find, Ranked only, Reset all (light, 1280 px) ─────────────────
  {
    const context = await newContext(browser);
    const page = await newPage(context, 'keyboard');
    await openFeatures(page);

    const shownTitles = await titles(page);
    const expanded = await page
      .locator('ss-ranking-card button.toggle')
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-expanded')));
    check(
      'a card per feature category, in order, every one open before anything is listed',
      shownTitles.join() === CATEGORIES.join() && expanded.every((value) => value === 'true'),
      `${shownTitles.join(', ')} | ${expanded.join(',')}`,
    );
    check(
      'the page is "Your feature ranks", Reset all is off with nothing ranked',
      (await page.locator('h1').textContent()) === 'Your feature ranks' &&
        (await page.getByRole('button', { name: 'Reset all' }).isDisabled()),
    );

    // Tab from the top: the search box and Ranked only come before the first card.
    await tabTo(page, () => document.activeElement?.getAttribute('type') === 'search');
    await page.keyboard.press('Tab');
    const ranked = await stop(page);
    await page.keyboard.press('Tab');
    const firstToggle = await stop(page);
    check(
      'Tab goes Find a feature → Ranked only → the first card’s toggle, named with its count',
      /^checkbox "Ranked only"/.test(ranked) &&
        /^button "Streaming 0 of \d+ ranked" \[expanded\]$/.test(firstToggle),
      `${ranked} → ${firstToggle}`,
    );

    // Rank Ad free Needed by keyboard: Enter opens the dropdown, ArrowDown moves from Not ranked to Needed.
    const adFree = card(page, 'Streaming').getByRole('combobox', { name: 'Ad free' });
    await tabTo(page, () => document.activeElement?.getAttribute('aria-label') === 'Ad free');
    await page.keyboard.press('Enter');
    await page.locator('.ss-rank-select-panel').waitFor();
    await sleep(300);
    await page.screenshot({ path: path.join(outDir, 'select-open-1280.png') });
    await axeCheck(page, 'light 1280, a rank dropdown open');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await until('the rank saved', async () => (await storedRanks(page))['streaming.ad-free']);
    const row = card(page, 'Streaming').locator('.row', {
      has: page.getByRole('combobox', { name: 'Ad free' }),
    });
    check(
      'Enter and an arrow rank Ad free Needed: saved at once, the row marked in its colour',
      (await storedRanks(page))['streaming.ad-free'] === 'needed' &&
        (await row.getAttribute('data-rank')) === 'needed' &&
        (await row.evaluate((element) => getComputedStyle(element).borderLeftWidth)) === '4px' &&
        (await adFree.evaluate((element) => element === document.activeElement)),
      JSON.stringify(await storedRanks(page)),
    );
    await page.reload();
    await page.locator('ss-ranking-card').first().waitFor({ timeout: 20000 });
    check(
      'the rank is still there after a reload',
      /Needed/.test(await adFree.textContent()) &&
        /^1 of \d+ ranked$/.test(
          (await card(page, 'Streaming').locator('.count').textContent()).trim(),
        ),
      await adFree.textContent(),
    );

    // Set all in VPN, by keyboard.
    await tabTo(
      page,
      () =>
        document.activeElement?.classList.contains('set-all') &&
        document.activeElement.textContent.includes(' in VPN'),
    );
    const setAllName = await stop(page);
    await page.keyboard.press('Enter');
    const menu = page.locator('.mat-mdc-menu-panel');
    await menu.waitFor();
    await sleep(500);
    await page.screenshot({ path: path.join(outDir, 'set-all-menu-1280.png') });
    await axeCheck(page, 'light 1280, the Set all menu open');
    // Not ranked, Needed, Wanted: two down from the first.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await menu.waitFor({ state: 'detached' });
    // VPN's children's keys, some in sets that start folded: as many as Set all says it ranked.
    const said = await until('Set all to say so', async () =>
      (await page.locator('.announcement').textContent()).trim(),
    );
    const vpnChildren = Number(/^(\d+) features/.exec(said)?.[1]);
    await until(
      'Set all saved',
      async () =>
        Object.keys(await storedRanks(page)).filter(
          (key) => key.startsWith('vpn.') && key !== 'vpn.included',
        ).length === vpnChildren,
    );
    const stored = await storedRanks(page);
    const childRanks = Object.entries(stored).filter(
      ([key]) => key.startsWith('vpn.') && key !== 'vpn.included',
    );
    check(
      'Set all in VPN ranks every child Wanted, not VPN itself, and says how many',
      /^button "Set all in VPN"/.test(setAllName) &&
        vpnChildren >= 20 &&
        childRanks.every(([, rank]) => rank === 'wanted') &&
        stored['vpn.included'] === undefined &&
        said === `${vpnChildren} features set to Wanted.`,
      `${setAllName} | ${childRanks.length} of ${vpnChildren} | ${said}`,
    );

    // A long set starts folded; Enter opens it.
    const fold = card(page, 'Security & passwords').getByRole('button', {
      name: /Storable item types/,
    });
    const foldedBefore = await fold.getAttribute('aria-expanded');
    await fold.focus();
    await page.keyboard.press('Enter');
    await until(
      'the fold to open',
      async () => (await fold.getAttribute('aria-expanded')) === 'true',
    );
    const itemTypes = await card(page, 'Security & passwords').locator('.entry.child .row').count();
    check(
      'Storable item types starts folded, and Enter shows its 22 rows',
      foldedBefore === 'false' && itemTypes >= 22,
      `${foldedBefore}, ${itemTypes} rows`,
    );

    // Find a feature.
    const box = page.getByRole('searchbox', { name: 'Find a feature' });
    await box.focus();
    await box.pressSequentially('kill');
    await until('the filter', async () => (await titles(page)).join() === 'VPN');
    const killRows = await page.locator('ss-ranking-card .row .label .name').allTextContents();
    check(
      '"kill" finds the kill switch under its VPN heading, and says how many',
      killRows.join() === 'Kill switch' &&
        (await page.locator('.matches').textContent()) === '1 feature',
      `${killRows.join(', ')} | ${await page.locator('.matches').textContent()}`,
    );
    await box.fill('');
    await until('every card back', async () => (await titles(page)).length === CATEGORIES.length);

    // Ranked only, by Space.
    await page.getByRole('checkbox', { name: 'Ranked only' }).focus();
    await page.keyboard.press('Space');
    await until('Ranked only', async () => !(await titles(page)).includes('Storage'));
    const rankedRows = await page.locator('ss-ranking-card .row').count();
    check(
      'Ranked only shows the ranked rows alone',
      (await titles(page)).join() === 'Streaming,VPN' && rankedRows === vpnChildren + 1,
      `${(await titles(page)).join(', ')} | ${rankedRows} rows`,
    );
    await page.keyboard.press('Space');

    // Reset all, through its confirmation, by keyboard.
    const reset = page.getByRole('button', { name: 'Reset all' });
    await reset.focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('mat-dialog-container');
    await dialog.waitFor();
    await sleep(500);
    const onCancel = await stop(page);
    await page.screenshot({ path: path.join(outDir, 'reset-confirm-1280.png') });
    await axeCheck(page, 'light 1280, Reset all’s confirmation');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await dialog.waitFor({ state: 'detached' });
    await until(
      'every rank cleared',
      async () => Object.keys(await storedRanks(page)).length === 0,
    );
    check(
      'Reset all asks first, with focus on Cancel, then clears every rank',
      /^button "Cancel"/.test(onCancel) &&
        (await page.locator('ss-ranking-card .row.ranked').count()) === 0 &&
        (await reset.isDisabled()),
      onCancel,
    );
    await context.close();
  }

  // ── With a VPN in a list: only the categories the lists use start open, with counts ─────────────────
  {
    const context = await newContext(browser);
    const page = await newPage(context, 'listed');
    await openFeatures(page);
    await addItem(page, 'mullvad.vpn');
    const open = await page
      .locator('ss-ranking-card button.toggle')
      .evaluateAll((buttons) =>
        buttons
          .filter((button) => button.getAttribute('aria-expanded') === 'true')
          .map((button) => button.querySelector('.title').textContent),
      );
    const usage = await card(page, 'VPN')
      .locator('.row', { hasText: 'Kill switch' })
      .locator('.usage')
      .textContent();
    check(
      'with Mullvad listed, only VPN starts open, and its rows say "in 1 subscription"',
      open.join() === 'VPN' && usage.trim() === 'in 1 subscription',
      `${open.join(', ')} | ${usage}`,
    );
    await card(page, 'Streaming').locator('button.toggle').focus();
    await page.keyboard.press('Enter');
    await until(
      'Streaming open',
      async () => (await card(page, 'Streaming').locator('.row').count()) > 0,
    );
    check('Enter on a folded card opens it', true);
    await context.close();
  }

  // ── Both themes at both widths: screenshots, axe, no horizontal scroll ─────────────────────────────
  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [WIDE, NARROW]) {
      const label = `${colorScheme} ${viewport.width}`;
      const context = await newContext(browser, { colorScheme, viewport });
      const page = await newPage(context, label);
      await openFeatures(page);
      // Something ranked, so a row shows its colour.
      await card(page, 'Streaming').getByRole('combobox', { name: 'Ad free' }).click();
      await page.getByRole('option', { name: 'Needed' }).click();
      await card(page, 'VPN').getByRole('combobox', { name: 'VPN', exact: true }).click();
      await page.getByRole('option', { name: 'Unwanted' }).click();
      await until('the ranks', async () => Object.keys(await storedRanks(page)).length === 2);
      // The last dropdown fades out after its choice: a screenshot at once catches it half there.
      await sleep(600);
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      check(`no horizontal scroll: ${label}`, width <= viewport.width, `${width}px`);
      await page.screenshot({
        path: path.join(outDir, `features-${colorScheme}-${viewport.width}.png`),
        fullPage: viewport === NARROW,
      });
      await axeCheck(page, `${label}, ranked rows`);
      if (viewport === NARROW) {
        await card(page, 'Security & passwords')
          .getByRole('button', { name: /Storable item types/ })
          .click();
        const narrowWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        check(
          `${label}: an open set’s rows fit`,
          narrowWidth <= viewport.width,
          `${narrowWidth}px`,
        );
        await card(page, 'Security & passwords').screenshot({
          path: path.join(outDir, `security-${colorScheme}-360.png`),
        });
      }
      await page.getByRole('searchbox', { name: 'Find a feature' }).fill('zzz');
      await page.locator('ss-empty-state').waitFor();
      await axeCheck(page, `${label}, no match`);
      await context.close();
    }
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

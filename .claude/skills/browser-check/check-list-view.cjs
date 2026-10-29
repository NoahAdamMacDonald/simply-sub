// M6.8 in the system Edge: List view (P4) on `ng serve`, for a Canadian in Alberta, with Work Related (Netflix Standard
// tagged Family, Mullvad VPN and Crave Premium from Dec 1) and an empty list written to IndexedDB. In both themes at
// 1280 and 360 px, keyboard only: the header's average and count, the cards by price (pinned first), each card's
// status and tags, the feature summary, the header's ← Lists and Edit list, the Tab order, 📌 by keyboard (saved to the
// item, no draft, the card moving to Pinned with focus on its 📌, and still there after a reload), the search box
// finding a tag and Clear search, the Sort menu (a sort, the price slider's top thumb, the Inactive chip and a Features
// suggestion by keyboard, the count on its button, Clear all keeping the sort), a card's details and Edit opening the
// item dialog in the list editor, and Edit list at the top. Then at 1280 px: an empty list's Add from catalog, a list
// there isn't, and the note about changes not saved. With axe on the page, the open Sort menu (and the open Features
// suggestions at 1280 px), the details and the empty states, and no horizontal scroll.
// Usage: node check-list-view.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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
  // Material renders menus, selects and dialogs outside the page's landmarks (the skill's gotchas): set aside
  // `region` hits that are all inside its overlay container. An open select's panel covers the fields under it, whose
  // labels axe then measures against the panel: set aside contrast hits on text under a popup.
  const hidden = await page.evaluate(
    (targets) =>
      targets.map((target) => {
        const element = document.querySelector(target);
        if (!element) return false;
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        // The panel is in the browser's top layer, next to its field in the page, not in the overlay container.
        return (
          (top?.closest('.cdk-overlay-pane') ?? null) !== null &&
          !element.closest('.cdk-overlay-pane')
        );
      }),
    (result.violations.find((violation) => violation.id === 'color-contrast')?.nodes ?? []).map(
      (node) => node.target.join(' '),
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
        (violation.id !== 'region' ||
          !violation.nodes.every((node) => node.target.join(' ').includes('cdk-overlay'))),
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

async function noSideScroll(page, viewport, label) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`no horizontal scroll: ${label}`, width <= viewport.width, `${width}px`);
}

/** The focused element's accessible name, as its accessibility snapshot gives it; none when nothing has focus. */
async function focusedName(page) {
  const focused = await page.evaluate(
    () => document.activeElement !== null && document.activeElement !== document.body,
  );
  if (!focused) return undefined;
  return /"([^"]*)"/.exec(await stop(page))?.[1];
}

/** Presses `key` until the element named `name` has focus. */
async function keyToName(page, name, key = 'Tab', limit = 80) {
  for (let presses = 0; presses < limit; presses++) {
    if ((await focusedName(page)) === name) return;
    await page.keyboard.press(key);
  }
  throw new Error(`Couldn't reach ${name} (focus on ${await focusedName(page)})`);
}

const LIST = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const EMPTY = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';
const NETFLIX = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0b';
const MULLVAD = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0c';
const CRAVE = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0d';
const TAG = '0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2d';
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };
const viewUrl = (listId = LIST) => `${baseUrl}lists/${listId}`;
const pathOf = (page) => new URL(page.url()).pathname;

/** Work Related: Netflix Standard (tagged Family), Mullvad VPN and Crave Premium from Dec 1; and Empty, with nothing. */
async function plant(page) {
  const billing = {
    mode: 'recurring',
    interval: 'month',
    intervalCount: 1,
    anchorDate: '2026-11-12',
    autoRenew: true,
  };
  await putRecord(page, 'tags', { id: TAG, name: 'Family', color: '#1e88e5', ...stamps });
  await putRecord(page, 'lists', { id: LIST, name: 'Work Related', ...stamps });
  await putRecord(page, 'lists', {
    id: EMPTY,
    name: 'Empty',
    ...stamps,
    createdAt: '2026-10-21T12:00:00.000Z',
  });
  for (const [id, planId, extra] of [
    [NETFLIX, 'netflix.standard', { tagIds: [TAG] }],
    [MULLVAD, 'mullvad.vpn', { billing: { ...billing, autoRenew: false } }],
    [
      CRAVE,
      'crave.premium',
      { billing: { ...billing, anchorDate: '2026-12-01', startDate: '2026-12-01' } },
    ],
  ]) {
    await putRecord(page, 'items', {
      id,
      listId: LIST,
      source: { kind: 'catalog', planId },
      billing,
      tagIds: [],
      rankOverrides: {},
      pinned: false,
      ...stamps,
      ...extra,
    });
  }
}

const view = (page) => page.locator('ss-list-view-page');
/** The page's group headings ("# Pinned") and its cards' titles, in order. */
const layout = (page) =>
  view(page)
    .locator('.items h2, ss-item-card h3')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const text = element.textContent.replace(/\s+/g, ' ').trim();
        if (element.matches('h2')) return `# ${text}`;
        const plan = element.parentElement.querySelector('.plan-name');
        return plan ? `${text} ${plan.textContent.trim()}` : text;
      }),
    );
const cards = async (page) => (await layout(page)).filter((entry) => !entry.startsWith('#'));
/** The header's line as it shows, without the words only screen readers get. */
const summary = (page) =>
  view(page)
    .locator('.summary')
    .evaluate((line) => {
      const copy = line.cloneNode(true);
      copy.querySelectorAll('.visually-hidden').forEach((hidden) => hidden.remove());
      return copy.textContent.replace(/\s+/g, ' ').trim();
    });

async function openView(page, listId = LIST) {
  await page.goto(viewUrl(listId));
  await view(page).locator('h1').waitFor({ timeout: 20000 });
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
      await plant(page);

      // ── The list: header, cards by price, statuses, tags and the summary ───────────────────────
      await openView(page);
      await until('three cards', async () => (await cards(page)).length === 3);
      await until('the average', async () => (await summary(page)).includes('mo average'));
      check(
        `${label}: the header names the list, with its average a month and its count`,
        (await view(page).locator('h1').textContent()).trim() === 'Work Related' &&
          /^≈ \$\d+\.\d\d \/ mo average · 3 subscriptions$/.test(await summary(page)),
        await summary(page),
      );
      // This month and this year (M7.2): Netflix's $18.99 with Alberta's 5% and Mullvad's €5 (tax included) on the
      // 12th of each month, and Crave's $22 from Dec 1. Without budgets, the amounts alone.
      const money = view(page).locator('.money');
      const totals = () =>
        money
          .locator('.total [aria-hidden]')
          .evaluateAll((spans) => spans.map((span) => span.textContent.trim()));
      check(
        `${label}: the side gives this month's and this year's totals, with no bars without budgets`,
        (await totals()).join(' | ') === '≈ $27.79 this month | ≈ $356.54 in 2026' &&
          (await money.locator('ss-budget-bar').count()) === 0,
        (await totals()).join(' | '),
      );
      const shares = await view(page)
        .locator('ss-item-card .share')
        .evaluateAll((elements) => elements.map((element) => element.textContent.trim()));
      check(
        `${label}: each card gives its share of the next 12 months`,
        shares.length === 3 &&
          shares.every((share) => /^\d+% of list over the next 12 months$/.test(share)),
        shares.join(' | '),
      );
      // Under 960 px the totals come above the cards; from it, on their right.
      const moneyBox = await money.boundingBox();
      const cardBox = await view(page).locator('ss-item-card').first().boundingBox();
      check(
        `${label}: the totals are ${viewport.width < 960 ? 'above' : 'beside'} the cards`,
        viewport.width < 960
          ? moneyBox.y + moneyBox.height <= cardBox.y
          : moneyBox.x >= cardBox.x + cardBox.width,
      );
      // With budgets, a bar for each, named by its heading, and the totals of them.
      const [settings] = await readTable(page, 'settings');
      await putRecord(page, 'settings', { ...settings, monthlyBudget: 200, annualBudget: 1000 });
      await page.reload();
      await until('the bars', async () => (await money.locator('ss-budget-bar').count()) === 2);
      const named = await money
        .locator('ss-budget-bar')
        .evaluateAll((bars) =>
          bars.map(
            (bar) =>
              `${document.getElementById(bar.getAttribute('aria-labelledby')).textContent.trim()}: ${bar.getAttribute('aria-valuetext')}`,
          ),
        );
      check(
        `${label}: with budgets, the side has a bar for each, named by its heading, with the totals of the budgets`,
        named.join(' | ') ===
          'Monthly budget: 13%, $27.79 of $200.00 | Annual budget: 35%, $356.54 of $1,000.00' &&
          (await totals()).join(' | ') ===
            '≈ $27.79 of $200.00 this month | ≈ $356.54 of $1,000.00 in 2026',
        `${named.join(' | ')} / ${(await totals()).join(' | ')}`,
      );
      await noSideScroll(page, viewport, `${label}, with budgets`);
      await page.screenshot({ path: shot('view-budgets'), fullPage: true });
      await axeCheck(page, `${label}, with budgets`);
      await putRecord(page, 'settings', settings);
      await page.reload();
      await until('no bars', async () => (await money.locator('ss-budget-bar').count()) === 0);
      await until('three cards', async () => (await cards(page)).length === 3);
      check(
        `${label}: the cards go by price per month, highest first, under a hidden heading`,
        (await layout(page)).join(' | ') ===
          '# Subscriptions | Crave Premium | Netflix Standard | Mullvad VPN',
        (await layout(page)).join(' | '),
      );
      const statuses = await view(page)
        .locator('ss-item-card ss-status-badge')
        .evaluateAll((badges) => badges.map((badge) => badge.textContent.trim()));
      // Mullvad renews by hand (M7.1): its badge says so in words (M7.11) and when, after its icon's ligature. Netflix
      // renews by itself, and says when (M6.12).
      check(
        `${label}: each card's status, Netflix's "Auto-renews", Mullvad's "Manual · renew by", and Netflix's tag`,
        statuses.join(' | ') ===
          'Inactive · active from Dec 1, 2026 | Active Auto-renews Nov 12 | Activeautorenew Manual · renew by Nov 12' &&
          (
            await view(page).locator(`[data-item="${NETFLIX}"] ss-tag-chip`).textContent()
          ).trim() === 'Family',
        statuses.join(' | '),
      );
      const features = await view(page)
        .locator('ss-feature-summary li .label')
        .evaluateAll((rows) => rows.map((row) => row.textContent.trim()));
      check(
        `${label}: the list's feature summary`,
        features.includes('VPN:'),
        features.join(' | '),
      );
      const types = await view(page)
        .locator('ss-type-counts li')
        .evaluateAll((rows) =>
          rows.map(
            (row) =>
              `${row.querySelector('.label').textContent.trim()} ${row.querySelector('span:last-child').textContent.trim()}`,
          ),
        );
      check(
        `${label}: the list's types, most first: two streaming services and a VPN`,
        types.length === 2 && types[0].endsWith(': 2') && types[1] === 'VPN: 1',
        types.join(' | '),
      );
      await noSideScroll(page, viewport, `${label}, the list`);
      await page.screenshot({ path: shot('view'), fullPage: true });
      await axeCheck(page, `${label}, the list`);

      // The Tab order: the header's ← Lists, Edit list and Export (the feedback after M6.9, M7.5), at 360 px the
      // folded mini calendar's button above the cards, the search box, at 360 px the compact View optimizations (M6.13),
      // Sort, then each card's 📌 and details button. From 960 px the mini calendar and View optimizations are in the
      // side column, after the cards. A click on the title focuses <main> (the skip link's target), so Tab starts from
      // its top.
      await view(page).locator('h1').click();
      const stops = [];
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        // A name with a colon comes back quoted, and a link's line ends in a colon.
        stops.push((await stop(page)).replace(/:$/, '').replace(/^'(.*)'$/, '$1'));
      }
      const expected = [
        'link "Lists"',
        'link "Edit list"',
        'button "Export"',
        ...(viewport === NARROW ? ['button "Calendar"'] : []),
        'textbox "Search this list"',
        ...(viewport === NARROW
          ? ['link "View optimizations: 4 suggestions, the strongest: Recommended"']
          : []),
        'button "Sort and filter"',
        'button "Pin Crave Premium"',
        'button "Details: Crave Premium"',
        'button "Pin Netflix Standard"',
      ];
      const order = stops.slice(stops.indexOf('link "Lists"')).slice(0, expected.length);
      check(
        `${label}: Tab goes ← Lists, Edit list, Export, the search box, Sort, then each card's 📌 and details`,
        order.join(' | ') === expected.join(' | '),
        stops.join(' | '),
      );

      // ── 📌 by keyboard ──────────────────────────────────────────────────────────────────────
      await keyToName(page, 'Pin Mullvad VPN');
      await page.keyboard.press('Space');
      await until('Pinned', async () => (await layout(page))[0] === '# Pinned');
      await until('focus on its 📌', async () => (await focusedName(page)) === 'Pin Mullvad VPN');
      const pinned = (await readTable(page, 'items')).find((item) => item.id === MULLVAD);
      check(
        `${label}: 📌 saves the pin to the item with no draft, moves the card to Pinned, and keeps focus on it`,
        (await layout(page)).join(' | ') ===
          '# Pinned | Mullvad VPN | # All | Crave Premium | Netflix Standard' &&
          pinned?.pinned === true &&
          (await readTable(page, 'drafts')).length === 0 &&
          (await page.evaluate(() => document.activeElement?.getAttribute('aria-pressed'))) ===
            'true',
        (await layout(page)).join(' | '),
      );
      await page.screenshot({ path: shot('view-pinned') });
      await axeCheck(page, `${label}, a card pinned`);
      await page.reload();
      await until('the cards again', async () => (await cards(page)).length === 3);
      check(
        `${label}: a pin survives a reload`,
        (await layout(page)).slice(0, 2).join(' | ') === '# Pinned | Mullvad VPN',
      );

      // ── The search box ──────────────────────────────────────────────────────────────────────
      await view(page).locator('h1').click();
      await keyToName(page, 'Search this list');
      await page.keyboard.type('fam');
      await until('one card', async () => (await cards(page)).length === 1);
      check(
        `${label}: the search box finds a card by its tag, and says how many are shown`,
        (await cards(page))[0] === 'Netflix Standard' &&
          (await view(page).locator('.shown').textContent()).trim() === '1 of 3 shown',
      );
      await page.keyboard.press('Tab');
      check(`${label}: Clear search follows the box`, (await focusedName(page)) === 'Clear search');
      await page.keyboard.press('Enter');
      await until('three cards', async () => (await cards(page)).length === 3);
      check(
        `${label}: Clear search shows every card again, with focus back in the box`,
        (await page.evaluate(() => document.activeElement?.closest('.search') !== null)) &&
          (await view(page).locator('.search input').inputValue()) === '',
      );

      // ── The Sort menu, by keyboard ──────────────────────────────────────────────────────────
      await keyToName(page, 'Sort and filter');
      await page.keyboard.press('Enter');
      await view(page).locator('ss-list-filters').waitFor();
      check(
        `${label}: Sort opens the menu below it`,
        (await view(page).locator('.filters-toggle').getAttribute('aria-expanded')) === 'true',
      );
      // Sort by: Name, A to Z (the option after Price).
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await page.locator('.cdk-overlay-pane mat-option').first().waitFor();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await until('A to Z', async () => (await cards(page))[1] === 'Crave Premium');
      check(
        `${label}: Name, A to Z sorts the cards, the pinned one first`,
        (await layout(page)).join(' | ') ===
          '# Pinned | Mullvad VPN | # All | Crave Premium | Netflix Standard',
        (await layout(page)).join(' | '),
      );
      // Price per month (Search's slider since the feedback after M6.9): the top thumb down by arrow keys until the
      // priciest card goes, then End for Unlimited again.
      await keyToName(page, 'Highest price per month');
      for (let presses = 0; presses < 80 && (await cards(page)).length === 3; presses++) {
        await page.keyboard.press('ArrowLeft');
        await sleep(30);
      }
      check(
        `${label}: the price's top thumb, by arrow keys, leaves out the priciest card first`,
        (await cards(page)).join(' | ') === 'Mullvad VPN | Netflix Standard',
        (await cards(page)).join(' | '),
      );
      await page.keyboard.press('End');
      await until('three cards', async () => (await cards(page)).length === 3);
      // Status: Inactive, a chip that Space ticks.
      await keyToName(page, 'Inactive');
      await page.keyboard.press('Space');
      await until('one card', async () => (await cards(page)).length === 1);
      const toggleName = await view(page).locator('.filters-toggle').ariaSnapshot();
      check(
        `${label}: the Inactive chip leaves Crave, and Sort says one filter is on`,
        (await cards(page))[0] === 'Crave Premium' &&
          toggleName.includes('Sort and filter, 1 on') &&
          (await view(page).locator('.filters-toggle .badge').textContent()).trim() === '1',
        toggleName,
      );
      await page.keyboard.press('Space');
      await until('three cards', async () => (await cards(page)).length === 3);
      // Features: Search's box, suggesting only what the list's items provide.
      await keyToName(page, 'Features', 'Shift+Tab');
      await page.keyboard.type('4k');
      await page.locator('.cdk-overlay-pane mat-option').first().waitFor();
      // The suggestions open on focus with everything, and follow the typing once it has rendered.
      let suggested = [];
      for (let tries = 0; tries < 30; tries++) {
        suggested = await page
          .locator('.cdk-overlay-pane mat-option')
          .evaluateAll((options) => options.map((option) => option.textContent.trim()));
        if (suggested[0] === 'Video quality: 4K (Ultra HD)') break;
        await sleep(100);
      }
      check(
        `${label}: the Features box suggests 4K, which a card in the list has`,
        suggested[0] === 'Video quality: 4K (Ultra HD)',
        suggested.join(' | '),
      );
      if (viewport === WIDE) {
        await page.screenshot({ path: shot('view-suggestions') });
        await axeCheck(page, `${label}, the Features suggestions open`);
      }
      await page.keyboard.press('Enter');
      await until('one card', async () => (await cards(page)).length === 1);
      check(
        `${label}: picking it adds its chip and leaves only Crave Premium`,
        (await cards(page))[0] === 'Crave Premium' &&
          (await view(page).locator('ss-feature-filter mat-chip-row').count()) === 1,
      );
      await noSideScroll(page, viewport, `${label}, the Sort menu`);
      await page.screenshot({ path: shot('view-filters'), fullPage: true });
      await axeCheck(page, `${label}, the Sort menu`);
      await keyToName(page, 'Clear all');
      await page.keyboard.press('Enter');
      await until('three cards', async () => (await cards(page)).length === 3);
      check(
        `${label}: Clear all shows every card again and keeps the sort`,
        (await layout(page)).join(' | ') ===
          '# Pinned | Mullvad VPN | # All | Crave Premium | Netflix Standard' &&
          (await view(page).locator('.filters-toggle .badge').count()) === 0,
      );
      await keyToName(page, 'Sort and filter', 'Shift+Tab');
      await page.keyboard.press('Enter');
      await view(page).locator('ss-list-filters').waitFor({ state: 'detached' });

      // ── A card's details, and Edit ──────────────────────────────────────────────────────────
      await keyToName(page, 'Details: Netflix Standard');
      await page.keyboard.press('Enter');
      const details = view(page).locator(`[data-item="${NETFLIX}"] .details-content`);
      await details.waitFor();
      await sleep(400);
      const facts = await details
        .locator('.facts li')
        .evaluateAll((items) => items.map((item) => item.textContent.trim()));
      const links = await details
        .locator('.actions a')
        .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href')));
      check(
        `${label}: the details say how it's billed, list its features, and link to its plan, cancel page, Search and Edit`,
        facts.join(' | ') === 'Monthly · auto-renews' &&
          (await details.locator('ss-feature-list li').count()) > 0 &&
          links.length === 4 &&
          links[2] === '/search?q=Netflix&plan=netflix.standard' &&
          links[3] === `/lists/${LIST}/edit?item=${NETFLIX}`,
        `${facts.join(' | ')} / ${links.join(' | ')}`,
      );
      await noSideScroll(page, viewport, `${label}, the details`);
      await page.screenshot({ path: shot('view-details'), fullPage: true });
      await axeCheck(page, `${label}, a card's details`);

      // Its next charge as charged, with Alberta's 5% (M7.1), and Wrong date? by keyboard.
      const nextCharge = async () =>
        (await details.locator('.next-charge > span').textContent()).replace(/\s+/g, ' ').trim();
      check(
        `${label}: the details give the next charge as charged, tax included`,
        (await nextCharge()).startsWith('Next charge Nov 12, 2026: $19.94, with $0.95 tax'),
        await nextCharge(),
      );
      await keyToName(page, 'Wrong date? Netflix Standard');
      await page.keyboard.press('Enter');
      const wrongDate = page.locator('ss-wrong-date-dialog');
      await wrongDate.waitFor();
      await until('focus in its field', () =>
        page.evaluate(() => !!document.activeElement?.closest('ss-wrong-date-dialog input')),
      );
      check(
        `${label}: Wrong date? asks for the next charge, filled in, with focus in the field`,
        (await wrongDate.locator('input').inputValue()) === '2026-11-12',
      );
      await page.screenshot({ path: shot('view-wrong-date') });
      await axeCheck(page, `${label}, Wrong date?`);
      await page.keyboard.press('Control+A');
      await page.keyboard.type('2026-11-14');
      await page.keyboard.press('Enter');
      await wrongDate.waitFor({ state: 'detached' });
      await until('the new anchor stored', async () =>
        (await readTable(page, 'items')).some(
          (item) => item.id === NETFLIX && item.billing.anchorDate === '2026-11-14',
        ),
      );
      await until('the card following it', async () =>
        (await nextCharge()).includes('Nov 14, 2026'),
      );
      check(
        `${label}: the date becomes the item's anchor, saved at once with no draft, and focus goes back`,
        (await readTable(page, 'drafts')).length === 0 &&
          (await page.evaluate(() => document.activeElement?.classList.contains('wrong-date'))),
      );
      // Back as it was, for what follows. The Enter that saves mustn't open it again once focus is back on its button.
      await page.keyboard.press('Enter');
      await wrongDate.waitFor();
      await until('focus in its field', () =>
        page.evaluate(() => !!document.activeElement?.closest('ss-wrong-date-dialog input')),
      );
      await page.keyboard.press('Control+A');
      await page.keyboard.type('2026-11-12');
      await page.keyboard.press('Enter');
      await until('the anchor back', async () => (await nextCharge()).includes('Nov 12, 2026'));
      await sleep(1000);
      check(
        `${label}: Enter saves and closes it, and doesn't open it again`,
        (await wrongDate.count()) === 0,
        `${await wrongDate.count()} open`,
      );

      await keyToName(page, 'Edit Netflix Standard');
      await page.keyboard.press('Enter');
      const dialog = page.locator('ss-item-dialog');
      await dialog.waitFor({ timeout: 20000 });
      await until('the URL without ?item=', () => !page.url().includes('item='));
      check(
        `${label}: Edit opens the item dialog for it in the list editor`,
        pathOf(page) === `/lists/${LIST}/edit` &&
          (await dialog.locator('h2').first().textContent()).trim() === 'Edit subscription',
      );
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });

      // ── Edit list ───────────────────────────────────────────────────────────────────────────
      await openView(page);
      await until('the cards', async () => (await cards(page)).length === 3);
      check(
        `${label}: opening the editor without changing anything leaves no note about changes`,
        (await view(page).locator('.unsaved').count()) === 0,
      );
      // View in Search, by keyboard, from a card's details.
      await view(page).locator('h1').click();
      await keyToName(page, 'Details: Netflix Standard');
      await page.keyboard.press('Enter');
      await view(page).locator(`[data-item="${NETFLIX}"] .details-content`).waitFor();
      await keyToName(page, 'View in Search, Netflix Standard');
      await page.keyboard.press('Enter');
      await until('Search', () => pathOf(page) === '/search');
      await page.locator('ss-sub-card').first().waitFor({ timeout: 20000 });
      check(
        `${label}: View in Search opens Search on the card's provider, showing its plan`,
        new URL(page.url()).searchParams.get('q') === 'Netflix' &&
          (await page.locator('ss-sub-card h2').first().textContent()).trim() === 'Netflix' &&
          (await page.locator('ss-sub-card .plan-name').first().textContent()).trim() ===
            'Standard',
      );
      await openView(page);
      await until('the cards', async () => (await cards(page)).length === 3);

      // Edit list at the top, the first stop after the title, then the one at the foot.
      check(
        `${label}: Edit list is at the foot too`,
        (await view(page).locator('.edit-list').getAttribute('href')) === `/lists/${LIST}/edit`,
      );
      await view(page).locator('h1').click();
      await keyToName(page, 'Edit list');
      await page.keyboard.press('Enter');
      await until('the editor', () => pathOf(page) === `/lists/${LIST}/edit`);
      check(`${label}: Edit list at the top opens the list editor`, true);

      if (viewport === WIDE) {
        // ── Changes not saved ─────────────────────────────────────────────────────────────────
        await page.locator('ss-list-edit-page .toolbar input').waitFor();
        await page.locator('ss-list-edit-page .toolbar input').fill('Work');
        await until('the draft', async () =>
          (await readTable(page, 'drafts')).some((draft) => draft.name === 'Work'),
        );
        await openView(page);
        await view(page).locator('.unsaved').waitFor();
        check(
          `${label}: the list's changes in the editor, not saved, get a note with a way back`,
          (await view(page).locator('.unsaved a').getAttribute('href')) === `/lists/${LIST}/edit`,
        );
        await axeCheck(page, `${label}, the note about changes`);

        // ── An empty list, and one there isn't ────────────────────────────────────────────────
        await openView(page, EMPTY);
        await view(page).locator('ss-empty-state').waitFor();
        check(
          `${label}: an empty list offers Add from catalog and Add custom subscription`,
          (await view(page).locator('ss-empty-state h2').textContent()).trim() ===
            'No subscriptions yet' &&
            (await view(page).locator('ss-empty-state a').getAttribute('href')) ===
              `/search?addTo=${EMPTY}`,
        );
        await page.screenshot({ path: shot('view-empty') });
        await axeCheck(page, `${label}, an empty list`);
        await view(page).locator('h1').click();
        await keyToName(page, 'Add custom subscription');
        await page.keyboard.press('Enter');
        await page.locator('.cdk-overlay-pane [mat-menu-item]').first().waitFor();
        await axeCheck(page, `${label}, the custom subscription menu`);
        await page.keyboard.press('Escape');
        await keyToName(page, 'Add from catalog', 'Shift+Tab');
        await page.keyboard.press('Enter');
        await until('pick mode', () => page.url().includes(`addTo=${EMPTY}`));
        check(`${label}: Add from catalog opens Search in pick mode for the list`, true);

        await openView(page, '0192f1c4-7b2e-7c3a-9d41-000000000000');
        await view(page).locator('ss-empty-state').waitFor();
        check(
          `${label}: a list there isn't says so`,
          (await view(page).locator('ss-empty-state h2').textContent()).trim() ===
            "This list doesn't exist",
        );
        await axeCheck(page, `${label}, a list there isn't`);
      }
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

// M9.1 in the system Edge: Payment (P11) on `ng serve`, for a Canadian in Alberta. In both themes at 1280 and 360 px,
// keyboard only: the page with no cards; Add card opening the dialog (focus on its heading, 720 px wide or the whole
// screen) with what it never asks for; Add with nothing filled in, each field's error and focus on the name; a card
// number refused in the name and the limit; a card filled in by keyboard (selects by typeahead) and stored (read from
// IndexedDB), with its tile, the snackbar and focus on its ✎; then Work Related (Netflix Standard and Mullvad VPN paid
// with it, Crave Premium with none) written to IndexedDB: the tile's network, credit, rates, this month's limit bar and
// the subscriptions with what they cost a month with tax, and "1 subscription has no card"; ✎ clearing the limit;
// and 🗑 asking with the count it pays for (focus on Cancel), then the items with no card and focus on Add card. With
// axe on the page, the dialog, its errors, the tile and the question, and no horizontal scroll.
// M9.4 adds, with three cards and Family open in the editor: the tile's over-limit warning and net; Assign best cards
// by keyboard (its preview, Family skipped, Apply and Undo); the item dialog's card menu with only the cards Netflix
// takes, the Best card chip by Tab and Enter, and Mullvad's notes; List view's net figures; and the Calendar's day over
// a card's limit, reached by the arrow keys, with its panel (a bottom sheet at 360 px).
// Usage: node check-payment.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

/** axe on the page, leaving out `exclude` (selectors of what's hidden under a popup, which axe measures anyway). */
async function axeCheck(page, label, exclude = []) {
  await sleep(600);
  await page.evaluate(axeSource);
  const result = await page.evaluate(
    (left) =>
      axe.run(
        left.length === 0 ? document : { include: [document], exclude: left.map((s) => [s]) },
      ),
    exclude,
  );
  // A select's open panel sits in the browser's top layer over the field's own hint, which axe measures against the
  // panel's colour: set aside contrast hits on text under a panel (the skill's gotchas, as check-list-view.cjs does).
  const hidden = await page.evaluate(
    (targets) =>
      targets.map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return false;
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        // Inside a dialog the panel can sit outside a .cdk-overlay-pane: its listbox is what covers the text.
        const popup = '.cdk-overlay-pane, [role="listbox"]';
        return (top?.closest(popup) ?? null) !== null && !element.closest(popup);
      }),
    (result.violations.find((violation) => violation.id === 'color-contrast')?.nodes ?? []).map(
      (node) => node.target.join(' '),
    ),
  );
  // Material renders menus, dialogs and snackbars outside the page's landmarks (the skill's gotchas): set aside
  // `region` hits that are all inside its overlay container.
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

/** Presses Tab until focus is in the field labelled `label` inside `scope`, or on the button with this name. */
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
        el.textContent?.replace(/^\\s*[a-z_]+\\s+(?=[A-Z])/, '').trim() === ${JSON.stringify(text)});`,
  );
}

const focusedName = (page) =>
  page.evaluate(
    () =>
      document.activeElement?.getAttribute('aria-label') ??
      document.activeElement?.textContent?.trim(),
  );
const cardDialog = (page) => page.locator('ss-card-dialog');
const snackBar = (page) => page.locator('.mat-mdc-snack-bar-container');
const errorsOf = (page) =>
  page
    .locator('ss-card-dialog mat-error')
    .evaluateAll((errors) => errors.map((error) => error.textContent.trim()));

/** The tiles as they read: title, badges, rates, limit, subscriptions and total. */
const tilesOf = (page) =>
  page.locator('ss-payment-page li.tile').evaluateAll((tiles) =>
    tiles.map((tile) => {
      const text = (selector) =>
        tile.querySelector(selector)?.textContent.replace(/\s+/g, ' ').trim();
      return {
        title: text('.title'),
        badges: [...tile.querySelectorAll('.badge')].map((badge) => badge.textContent.trim()),
        rates: text('.rates'),
        limit: text('.limit-total [aria-hidden="true"]') ?? text('.no-limit'),
        paid: [...tile.querySelectorAll('.paid li')].map(
          (row) =>
            `${row.querySelector('.paid-title').textContent.trim()} ${row
              .querySelector('.paid-amount [aria-hidden="true"]')
              ?.textContent.trim()}`,
        ),
        total: text('.total [aria-hidden="true"]'),
      };
    }),
  );

const LIST = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const NETFLIX = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0b';
const MULLVAD = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0c';
const CRAVE = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0d';
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };

/** This month's dates, from the machine's date as the app's ClockService reads it. */
function dates() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const next = month === 12 ? `${year + 1}-01` : `${year}-${pad(month + 1)}`;
  return {
    // Charged on the 1st of every month, this one's too.
    netflix: `${next}-01`,
    // Charged on this month's 2nd every year.
    mullvad: `${year + 1}-${pad(month)}-02`,
  };
}

/**
 * Work Related: Netflix Standard ($18.99 + 5% GST) and Mullvad VPN (€60 a year, VAT included, CA$94.16) paid with the
 * card, and Crave Premium with none.
 */
async function plantList(page, cardId) {
  const { netflix, mullvad } = dates();
  await putRecord(page, 'lists', { id: LIST, name: 'Work Related', ...stamps });
  const monthly = { mode: 'recurring', interval: 'month', intervalCount: 1, autoRenew: true };
  for (const [id, planId, billing, paid] of [
    [NETFLIX, 'netflix.standard', { ...monthly, anchorDate: netflix }, true],
    [
      MULLVAD,
      'mullvad.vpn',
      { ...monthly, interval: 'year', anchorDate: mullvad, autoRenew: false },
      true,
    ],
    [CRAVE, 'crave.premium', { ...monthly, anchorDate: netflix }, false],
  ]) {
    await putRecord(page, 'items', {
      id,
      listId: LIST,
      source: { kind: 'catalog', planId },
      billing,
      ...(paid && { cardId }),
      tagIds: [],
      rankOverrides: {},
      pinned: false,
      ...stamps,
    });
  }
}

// ── M9.4: net costs, Assign best cards, the item dialog's cards and over-limit warnings ──────────────────────────────

const FAMILY = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';
const FAMILY_CRAVE = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0e';
const EVERYDAY = '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d3e';
const DEBIT = '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d40';
const DISCOVER = '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d41';
const card = (id, name, network, cashbackPercent, extra = {}) => ({
  id,
  name,
  type: network === 'interac' ? 'debit' : 'credit',
  network,
  currency: 'CAD',
  cashbackPercent,
  fxFeePercent: 2.5,
  ...stamps,
  ...extra,
});

/** This month in words, as the app writes it: "October 2026". */
function thisMonthText() {
  const now = new Date();
  return `${now.toLocaleString('en', { month: 'long' })} ${now.getFullYear()}`;
}

/** Everyday (Mastercard, 1.5%, a $30 limit), Everyday Debit (Interac) and Rewards Discover (Discover, 2%), all in CAD. */
async function plantCards(page) {
  await putRecord(
    page,
    'cards',
    card(EVERYDAY, 'Cash Back Mastercard', 'mastercard', 1.5, {
      nickname: 'Everyday',
      monthlyLimit: 30,
    }),
  );
  await putRecord(page, 'cards', card(DEBIT, 'Everyday Debit', 'interac', 0));
  await putRecord(page, 'cards', card(DISCOVER, 'Rewards Discover', 'discover', 2));
  await plantList(page, EVERYDAY);
  // Crave Premium moves to Family, which is open in the editor (an unsaved draft).
  const { netflix } = dates();
  await putRecord(page, 'items', {
    id: CRAVE,
    listId: LIST,
    source: { kind: 'catalog', planId: 'crave.premium' },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      autoRenew: true,
      anchorDate: netflix,
    },
    tagIds: [],
    rankOverrides: {},
    pinned: false,
    ...stamps,
    deletedAt: stamps.updatedAt,
  });
  await putRecord(page, 'lists', { id: FAMILY, name: 'Family', ...stamps });
  const crave = {
    id: FAMILY_CRAVE,
    listId: FAMILY,
    source: { kind: 'catalog', planId: 'crave.premium' },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      autoRenew: true,
      anchorDate: netflix,
    },
    tagIds: [],
    rankOverrides: {},
    pinned: false,
    ...stamps,
  };
  await putRecord(page, 'items', crave);
  await putRecord(page, 'drafts', {
    listId: FAMILY,
    isNew: false,
    name: 'Family',
    startName: 'Family',
    items: [{ item: crave, saved: crave }],
    startedAt: stamps.updatedAt,
  });
}

/** The focused element's text without icons and hidden words, or its label. */
const focusedText = (page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    if (!element) return '';
    const copy = element.cloneNode(true);
    copy.querySelectorAll('mat-icon, .visually-hidden').forEach((hidden) => hidden.remove());
    return element.getAttribute('aria-label') ?? copy.textContent.replace(/\s+/g, ' ').trim();
  });

async function checkM94(page, label, viewport, shot) {
  const month = thisMonthText();
  await plantCards(page);

  // ── P11: the over-limit warning, then Assign best cards by keyboard ──────────────────────────────────────────
  await page.goto(`${baseUrl}payment`);
  await page.locator('ss-payment-page li.tile .over-limit').waitFor({ timeout: 20000 });
  const everyday = page.locator('ss-payment-page li.tile', { hasText: 'Everyday' }).first();
  const over = (
    await everyday.locator('.over-limit [aria-hidden="true"]:not(mat-icon)').textContent()
  ).trim();
  check(
    `${label}: a card over its limit says so on its tile, its bar red`,
    over === `Over its limit in ${month}: ≈ $116.46 of $30.00` &&
      (await everyday.locator('.limit ss-budget-bar').getAttribute('data-level')) === 'over',
    over,
  );
  check(
    `${label}: and gives what its subscriptions come to after cash back & FX fees`,
    (await everyday.locator('.net [aria-hidden="true"]').textContent()).trim() ===
      '≈ $27.56 after cash back & FX fees',
  );
  await noSideScroll(page, viewport, `${label}, a card over its limit`);
  await axeCheck(page, `${label}, a card over its limit`);
  await page.screenshot({ path: shot('payment-over-limit'), fullPage: true });

  await page.locator('ss-payment-page h1').click();
  await keyTo(page, buttonIn('ss-payment-page', 'Assign best cards'));
  await page.keyboard.press('Enter');
  const preview = page.locator('ss-assign-cards-dialog');
  await preview.waitFor();
  await until('focus on its heading', () =>
    page.evaluate(() => document.activeElement?.tagName === 'H2'),
  );
  const rows = await preview.locator('li').evaluateAll((items) =>
    items.map((item) => {
      const part = (selector) =>
        item.querySelector(selector)?.textContent.replace(/\s+/g, ' ').trim();
      return `${part('.item')} | ${part('.move')} | ${part('.savings [aria-hidden="true"]')}`;
    }),
  );
  check(
    `${label}: Assign best cards previews each list: Mullvad’s euros cost least on Rewards Discover`,
    JSON.stringify(rows) ===
      JSON.stringify(['Mullvad VPN | Everyday → to Rewards Discover | ≈ $0.48']) &&
      (await preview.locator('h3').first().textContent()).trim() === 'Work Related',
    JSON.stringify(rows),
  );
  check(
    `${label}: a list with unsaved edits is skipped, with a note`,
    (await preview.locator('.skipped').textContent()).replace(/\s+/g, ' ').trim() ===
      "Family has changes in the editor that aren't saved, so its subscriptions keep their cards.",
  );
  await axeCheck(page, `${label}, Assign best cards`);
  await page.screenshot({ path: shot('payment-assign') });
  await keyTo(page, buttonIn('ss-assign-cards-dialog', 'Apply'));
  await page.keyboard.press('Enter');
  await preview.waitFor({ state: 'detached' });
  await until(
    'Mullvad on Rewards Discover',
    async () =>
      (await readTable(page, 'items')).find((item) => item.id === MULLVAD)?.cardId === DISCOVER,
  );
  const snack = page.locator('.mat-mdc-snack-bar-container');
  await snack.waitFor();
  check(
    `${label}: Apply writes the card to the saved item, and says so with Undo`,
    (await snack.textContent()).includes('Assigned a card to 1 subscription') &&
      (await readTable(page, 'items')).find((item) => item.id === FAMILY_CRAVE)?.cardId ===
        undefined,
  );
  await until(
    'the warning gone',
    async () => (await page.locator('ss-payment-page .over-limit').count()) === 0,
  );
  await snack.locator('button').focus();
  await page.keyboard.press('Enter');
  await until(
    'Mullvad back on Everyday',
    async () =>
      (await readTable(page, 'items')).find((item) => item.id === MULLVAD)?.cardId === EVERYDAY,
  );
  check(`${label}: Undo puts the cards back`, true);

  // ── P6: the item dialog's cards: only the ones Netflix takes, and the Best card chip ─────────────────────────
  await page.goto(`${baseUrl}lists/${LIST}/edit`);
  await page.locator('li.item').first().waitFor({ timeout: 20000 });
  await page.locator('ss-list-edit-page h1').click();
  await keyTo(page, buttonIn('ss-list-edit-page', 'Edit Netflix Standard'));
  await page.keyboard.press('Enter');
  const dialog = page.locator('ss-item-dialog');
  await dialog.waitFor();
  await until('focus on its heading', () =>
    page.evaluate(() => document.activeElement?.tagName === 'H2'),
  );
  await keyTo(page, fieldIn('ss-item-dialog', 'Paid with'), 'Tab', 120);
  await page.keyboard.press('Enter');
  const options = page.locator('.cdk-overlay-pane mat-option');
  await options.first().waitFor();
  const optionTexts = await options.evaluateAll((all) =>
    all.map((option) => option.textContent.trim()),
  );
  check(
    `${label}: the dialog offers only the cards Netflix takes in Canada: no Interac, no Discover`,
    JSON.stringify(optionTexts) === JSON.stringify(['No card', 'Everyday (Mastercard, 1.5% back)']),
    JSON.stringify(optionTexts),
  );
  // The open menu covers the field's hint, which axe still measures, against the menu's colour.
  await axeCheck(page, `${label}, the card menu`, ['ss-item-dialog .card mat-hint']);
  // No card, by typeahead: the chip then offers Everyday.
  await page.keyboard.type('N');
  await sleep(300);
  await page.keyboard.press('Enter');
  const chip = dialog.locator('.best-card');
  await chip.waitFor();
  await page.keyboard.press('Tab');
  check(
    `${label}: with no card, the Best card chip names the saving, next in the Tab order`,
    (await focusedText(page)) === 'Best card: Everyday, saves $0.30 / mo',
    await focusedText(page),
  );
  await page.keyboard.press('Enter');
  await chip.waitFor({ state: 'detached' });
  const hint = (await dialog.locator('.card mat-hint [aria-hidden="true"]').textContent()).trim();
  check(
    `${label}: Enter on the chip pays with Everyday, and the hint gives the net`,
    hint === '$19.94 / mo with tax, $19.64 after cash back and FX fees',
    hint,
  );
  await noSideScroll(page, viewport, `${label}, the dialog's card`);
  await axeCheck(page, `${label}, the dialog's card`);
  await page.screenshot({ path: shot('item-dialog-card') });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });

  await keyTo(page, buttonIn('ss-list-edit-page', 'Edit Mullvad VPN'));
  await page.keyboard.press('Enter');
  await dialog.waitFor();
  await dialog.locator('.card-note').nth(1).waitFor();
  const notes = await dialog
    .locator('.card-note')
    .evaluateAll((all) => all.map((note) => note.textContent.replace(/\s+/g, ' ').trim()));
  check(
    `${label}: Mullvad’s card notes say acceptance isn’t confirmed, and that its euros pay the FX fee`,
    notes[0] === 'Acceptance not confirmed: Mullvad VPN doesn’t say which cards it takes.' &&
      notes[1] ===
        'Mullvad VPN charges in EUR, so this card’s 2.5% FX fee applies (estimated at the ECB’s rate). A checkout that offers to charge you in CAD instead converts at its own rate, which can cost more.',
    JSON.stringify(notes),
  );
  await axeCheck(page, `${label}, Mullvad's card notes`);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });

  // ── P4: the net beside the gross ─────────────────────────────────────────────────────────────────────────────
  await page.goto(`${baseUrl}lists/${LIST}`);
  await page.locator('ss-list-view-page .net-summary').waitFor({ timeout: 20000 });
  const net = (await page.locator('.net-summary [aria-hidden="true"]').textContent()).trim();
  const netflixLine = (
    await page.locator('ss-item-card .on-card', { hasText: '$19.94' }).textContent()
  ).replace(/\s+/g, ' ');
  check(
    `${label}: List view gives the month with tax and after cash back & FX fees, and each card's`,
    net === '≈ $27.79 / mo with tax · ≈ $27.56 after cash back & FX fees' &&
      netflixLine.includes(
        'Paid with Everyday: $19.94 / mo with tax · $19.64 after cash back & FX fees',
      ),
    `${net} | ${netflixLine}`,
  );
  await noSideScroll(page, viewport, `${label}, List view's net`);
  await axeCheck(page, `${label}, List view's net`);
  await page.screenshot({ path: shot('list-view-net'), fullPage: true });

  // ── P10: the day that takes Everyday over its limit, and the card in the day's panel ─────────────────────────
  const { mullvad } = dates();
  const overDay = `${new Date().getFullYear()}-${mullvad.slice(5)}`;
  await page.goto(`${baseUrl}calendar`);
  const warning = `Everyday goes over its $30.00 limit in ${month}: ≈ $116.46`;
  if (viewport === WIDE) {
    const day = page.locator(`.day[data-date="${overDay}"]`);
    await day.waitFor({ timeout: 20000 });
    await until('the day flagged', async () =>
      (await day.getAttribute('aria-label')).endsWith(', over a card’s limit'),
    );
    check(
      `${label}: the Calendar flags the day that takes a card over its limit`,
      (await page.locator(`.cell:has(.day[data-date="${overDay}"]) .over-limit`).count()) === 1,
    );
    // The grid's one tab stop (today), then the arrow keys to the day, as check-calendar.cjs goes.
    await page.locator('main').focus();
    await keyTo(page, () => document.activeElement?.classList.contains('day') === true);
    const focusedDate = () =>
      page.evaluate(() => document.activeElement?.getAttribute('data-date'));
    const steps = Number((await focusedDate()).slice(8)) - Number(overDay.slice(8));
    for (let i = 0; i < Math.abs(steps); i++) {
      await page.keyboard.press(steps > 0 ? 'ArrowLeft' : 'ArrowRight');
    }
    await until('the day over the limit', async () => (await focusedDate()) === overDay);
    await page.keyboard.press('Enter');
    const panel = page.locator('ss-day-panel');
    await panel.locator('.over-limit').waitFor();
    check(
      `${label}: its panel names the card, and the warning`,
      (await panel.locator('.card').first().textContent()).trim() === 'Paid with Everyday' &&
        (await panel.locator('.over-limit > span').textContent()).replace(/\s+/g, ' ').trim() ===
          `Warning: ${warning}`,
    );
    await axeCheck(page, `${label}, the day over the limit`);
    await page.screenshot({ path: shot('calendar-over-limit') });
  } else {
    const entry = page.locator('.agenda .entry', { hasText: 'Mullvad VPN' });
    await entry.waitFor({ timeout: 20000 });
    check(
      `${label}: the agenda marks the payment that takes a card over its limit`,
      (await entry.locator('.over-limit').count()) === 1 &&
        (await entry.textContent()).includes('over its card’s limit'),
    );
    await page.locator('main').focus();
    await keyTo(
      page,
      () =>
        document.activeElement?.classList.contains('entry') === true &&
        document.activeElement.textContent.includes('Mullvad VPN'),
    );
    await page.keyboard.press('Enter');
    const sheet = page.locator('ss-day-sheet');
    await sheet.locator('.over-limit').waitFor();
    await sleep(600);
    check(
      `${label}: its bottom sheet names the card, and the warning`,
      (await sheet.locator('.over-limit > span').textContent()).replace(/\s+/g, ' ').trim() ===
        `Warning: ${warning}`,
    );
    await axeCheck(page, `${label}, the sheet over the limit`);
    await page.screenshot({ path: shot('calendar-over-limit') });
    await page.keyboard.press('Escape');
  }
  await noSideScroll(page, viewport, `${label}, the Calendar with a card over its limit`);
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

      // ── No cards ─────────────────────────────────────────────────────────────────────────────────────────
      await page.goto(`${baseUrl}payment`);
      await page.locator('ss-payment-page ss-empty-state').waitFor({ timeout: 20000 });
      check(
        `${label}: with no cards, the page says so, and that it never asks for card numbers`,
        (await page.locator('ss-payment-page h1').textContent()).trim() === 'Payment cards' &&
          (await page.locator('ss-payment-page .subtitle').textContent())
            .replace(/\s+/g, ' ')
            .trim() ===
            "We never ask for card numbers, only what's needed to estimate cash back and fees." &&
          (await page.locator('ss-payment-page ss-empty-state h2').textContent()).trim() ===
            'No cards yet',
      );
      await noSideScroll(page, viewport, `${label}, no cards`);
      await axeCheck(page, `${label}, no cards`);
      await page.screenshot({ path: shot('payment-empty'), fullPage: true });

      // ── Add card by keyboard: the dialog, its errors and a card number refused ───────────────────────────
      await page.locator('ss-payment-page h1').click();
      await keyTo(page, buttonIn('ss-payment-page', 'Add card'));
      check(`${label}: Add card is reached by Tab`, (await focusedName(page)) === 'add Add card');
      await page.keyboard.press('Enter');
      await cardDialog(page).waitFor();
      await until('focus on the heading', () =>
        page.evaluate(() => document.activeElement?.tagName === 'H2'),
      );
      const box = await page.locator('mat-dialog-container').boundingBox();
      check(
        `${label}: the dialog opens with focus on its heading, ${viewport === WIDE ? '720 px wide' : 'on the whole screen'}`,
        (await page.locator('ss-card-dialog h2').textContent()).trim() === 'Add a card' &&
          (viewport === WIDE
            ? Math.round(box.width) === 720
            : Math.round(box.width) === viewport.width),
        `${Math.round(box.width)} px`,
      );
      check(
        `${label}: it says it never asks for a card number`,
        (await page.locator('ss-card-dialog .never').textContent()).includes(
          'Never enter a card number',
        ),
      );
      await axeCheck(page, `${label}, the card dialog`);
      await page.screenshot({ path: shot('payment-dialog') });

      await keyTo(page, buttonIn('ss-card-dialog', 'Add card'));
      await page.keyboard.press('Enter');
      await until('the errors', async () => (await errorsOf(page)).length === 3);
      check(
        `${label}: Add with nothing filled in shows each field's error, with focus on the name`,
        JSON.stringify(await errorsOf(page)) ===
          JSON.stringify([
            'Give the card a name',
            'Choose credit or debit',
            'Choose its network',
          ]) && (await page.evaluate(fieldIn('ss-card-dialog', 'Name'))),
      );
      await axeCheck(page, `${label}, the dialog's errors`);

      await page.keyboard.type('Cash Back 4111 1111 1111 1111');
      await keyTo(page, fieldIn('ss-card-dialog', 'Monthly limit'));
      await page.keyboard.type('5500000000000004');
      await keyTo(page, buttonIn('ss-card-dialog', 'Add card'));
      await page.keyboard.press('Enter');
      await until(
        'the card number errors',
        async () =>
          (await errorsOf(page)).filter((error) => error === 'Never enter a card number').length ===
          2,
      );
      check(
        `${label}: a card number is refused in the name and in the limit`,
        (await readTable(page, 'cards')).length === 0,
      );
      // The errors fade in.
      await sleep(600);
      await page.screenshot({ path: shot('payment-card-number') });

      // The card, field by field, as typed: the selects by typeahead.
      await keyTo(page, fieldIn('ss-card-dialog', 'Name'), 'Shift+Tab');
      await page.keyboard.press('Control+A');
      await page.keyboard.type('Cash Back Mastercard');
      await page.keyboard.press('Tab');
      await page.keyboard.type('Everyday');
      await keyTo(page, fieldIn('ss-card-dialog', 'Type'));
      await page.keyboard.type('C');
      await sleep(400);
      await keyTo(page, fieldIn('ss-card-dialog', 'Network'));
      await page.keyboard.type('M');
      await sleep(400);
      await keyTo(page, fieldIn('ss-card-dialog', 'Cash back'));
      await page.keyboard.type('1.5');
      await keyTo(page, fieldIn('ss-card-dialog', 'FX fee'));
      await page.keyboard.type('2.5');
      await keyTo(page, fieldIn('ss-card-dialog', 'Monthly limit'));
      await page.keyboard.press('Control+A');
      await page.keyboard.type('500');
      await keyTo(page, buttonIn('ss-card-dialog', 'Add card'));
      await page.keyboard.press('Enter');
      await cardDialog(page).waitFor({ state: 'detached' });
      const [card] = await until('the card stored', async () => {
        const rows = await readTable(page, 'cards');
        return rows.length === 1 && rows;
      });
      check(
        `${label}: Add stores the card, and nothing like a card number`,
        card.name === 'Cash Back Mastercard' &&
          card.nickname === 'Everyday' &&
          card.type === 'credit' &&
          card.network === 'mastercard' &&
          card.currency === 'CAD' &&
          card.cashbackPercent === 1.5 &&
          card.fxFeePercent === 2.5 &&
          card.monthlyLimit === 500 &&
          // The fields typed in, not the id and dates, whose digits run on once dashes are taken out.
          !/\d{12}/.test(
            JSON.stringify([card.name, card.nickname, card.monthlyLimit]).replace(/[ -]/g, ''),
          ),
        JSON.stringify(card),
      );
      await snackBar(page).waitFor();
      await until('focus on ✎', async () => (await focusedName(page)) === 'Edit Everyday');
      check(
        `${label}: then says so, with focus on its ✎`,
        (await snackBar(page).textContent()).includes('Added Everyday'),
      );

      // ── A card paying for subscriptions ──────────────────────────────────────────────────────────────────
      await plantList(page, card.id);
      await page.reload();
      await page.locator('ss-payment-page li.tile .paid li').nth(1).waitFor({ timeout: 20000 });
      const [tile] = await tilesOf(page);
      check(
        `${label}: the tile shows its network, credit, rates, this month's charges and limit`,
        tile.title === 'Everyday' &&
          JSON.stringify(tile.badges) === JSON.stringify(['Mastercard', 'Credit']) &&
          tile.rates === '1.5% cash back · FX fee 2.5%' &&
          // Netflix's $19.94 on the 1st, and Mullvad's CA$94.16 on the 2nd with the card's 2.5% FX fee.
          tile.limit === '≈ $116.46 of $500.00',
        JSON.stringify(tile),
      );
      check(
        `${label}: and the subscriptions it pays for, with what they cost a month with tax`,
        JSON.stringify(tile.paid) ===
          JSON.stringify(['Netflix Standard $19.94', 'Mullvad VPN ≈ $7.85']) &&
          tile.total === '≈ $27.79 / mo with tax',
        JSON.stringify(tile),
      );
      check(
        `${label}: the bar is named for the card, and Crave counted as having no card`,
        (await page.locator('ss-payment-page .limit ss-budget-bar').getAttribute('aria-label')) ===
          'Everyday, this month against its limit' &&
          (await page.locator('ss-payment-page .unassigned').textContent()).trim() ===
            '1 subscription has no card',
      );
      await noSideScroll(page, viewport, `${label}, a card in use`);
      await axeCheck(page, `${label}, a card in use`);
      await page.screenshot({ path: shot('payment-tile'), fullPage: true });

      // ── ✎ by keyboard: the limit cleared ─────────────────────────────────────────────────────────────────
      await page.locator('ss-payment-page h1').click();
      await keyTo(page, buttonIn('ss-payment-page', 'Edit Everyday'));
      await page.keyboard.press('Enter');
      await cardDialog(page).waitFor();
      await until('focus on the heading', () =>
        page.evaluate(() => document.activeElement?.tagName === 'H2'),
      );
      check(
        `${label}: ✎ opens the dialog filled in`,
        (await page.locator('ss-card-dialog h2').textContent()).trim() === 'Edit Everyday',
      );
      await keyTo(page, fieldIn('ss-card-dialog', 'Monthly limit'));
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
      await keyTo(page, buttonIn('ss-card-dialog', 'Save'));
      await page.keyboard.press('Enter');
      await cardDialog(page).waitFor({ state: 'detached' });
      await until('the limit cleared', async () => {
        const [stored] = await readTable(page, 'cards');
        return stored.monthlyLimit === undefined;
      });
      await until('the tile updated', async () => (await tilesOf(page))[0].limit === 'No limit');
      check(`${label}: a limit left empty is cleared, and the tile says No limit`, true);
      await until('focus back on ✎', async () => (await focusedName(page)) === 'Edit Everyday');

      // ── 🗑 by keyboard: asks with what it pays for, then the items have no card ─────────────────────────
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      const question = page.locator('ss-confirm-dialog');
      await question.waitFor();
      await sleep(600);
      check(
        `${label}: 🗑 asks first, with the subscriptions it pays for, focus on Cancel`,
        (await question.locator('h2').textContent()).trim() === 'Delete Everyday?' &&
          (await question.locator('p').textContent()).trim() ===
            '2 subscriptions are paid with it, and will have no card.' &&
          (await focusedName(page)) === 'Cancel',
      );
      await axeCheck(page, `${label}, the question before deleting`);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await page.locator('ss-payment-page ss-empty-state').waitFor();
      await until('focus on Add card', () =>
        page.evaluate(() => document.activeElement?.classList.contains('add')),
      );
      const [deleted] = await readTable(page, 'cards');
      const items = await readTable(page, 'items');
      check(
        `${label}: Delete card soft-deletes it, its subscriptions have no card, focus on Add card`,
        deleted.deletedAt !== undefined && items.every((item) => item.cardId === undefined),
      );

      await checkM94(page, label, viewport, shot);
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

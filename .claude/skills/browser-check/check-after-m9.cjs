// The feedback after M9 (M5.11, M5.12, M6.12–M6.16, M7.7–M7.9, M8.4) in the system Edge, on `ng serve`, for a
// Canadian in Alberta with a $50 monthly budget. In both themes at 1280 and 360 px, keyboard only, with axe and no
// horizontal scroll:
// - List view (P4): a card's add-on and its price, "Auto-renews" and "Renew by", View in Search naming the plan, the
//   budget warning's ✕ and "Show 1 hidden budget warning", the bars' one colour, and the pinned search bar with View
//   optimizations still on screen after scrolling (compact in the bar under 960 px);
// - Search (P8): the plan View in Search names is the one shown, "Auto-renews" in its status, and a policy rating's
//   way to change it;
// - the item dialog (P6): ranks shared with the provider's other plan, saved to both in the draft, and New tag's hex
//   field with the colour picker following it;
// - Optimizations (P14): Apply stays on the page, with Review changes (M8.6) and Undo;
// - the Calendar (P10): the grid keeps its width when a day opens, Upcoming beside it, the compact grid and its
//   bottom sheet on a phone, a back button from List view and none from the sidebar, and JSON and Text exports;
// - Settings (P13): the 📍 dialog's menus typed in, and a tag's colour picker beside its hex field.
// Usage: node check-after-m9.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

/** Opens Home and completes the first-run dialog for Alberta, typing in the province's menu (M6.16). */
async function firstRun(page) {
  await page.goto(baseUrl);
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor({ timeout: 20000 });
  // Focus starts on its heading, with no list open over it (M6.16); then Tab to Province.
  await until('focus on the heading', () =>
    page.evaluate(() => document.activeElement?.matches('mat-dialog-container h2') === true),
  );
  check(
    'first run: the dialog opens on its heading, with no menu open',
    (await page.locator('.cdk-overlay-pane mat-option').count()) === 0,
  );
  const province = page.locator('ss-choice-field[data-label="Province or territory"] input');
  await keyTo(
    page,
    () =>
      document.activeElement?.closest('ss-choice-field[data-label="Province or territory"]') !==
      null,
  );
  await page.keyboard.type('alb');
  await page.locator('.cdk-overlay-pane mat-option', { hasText: 'Alberta' }).waitFor();
  await sleep(300);
  await page.keyboard.press('Enter');
  await page.locator('.cdk-overlay-pane mat-option').first().waitFor({ state: 'detached' });
  check(
    'first run: typing "alb" and Enter picks Alberta',
    (await province.inputValue()) === 'Alberta',
  );
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
  // A popup sits in the browser's top layer over the text under it, which axe measures against the popup's colour:
  // set aside contrast hits on text under a popup (the skill's gotchas).
  const hidden = await page.evaluate(
    (targets) =>
      targets.map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return false;
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        const popup = '.cdk-overlay-pane, [role="listbox"]';
        return (top?.closest(popup) ?? null) !== null && !element.closest(popup);
      }),
    (result.violations.find((violation) => violation.id === 'color-contrast')?.nodes ?? []).map(
      (node) => node.target.join(' '),
    ),
  );
  // Material renders menus, dialogs and snackbars outside the page's landmarks: set aside `region` hits in its
  // overlay container.
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
async function keyTo(page, isThere, key = 'Tab', limit = 80) {
  let presses = 0;
  while (presses < limit && !(await page.evaluate(isThere))) {
    await page.keyboard.press(key);
    presses++;
  }
  if (!(await page.evaluate(isThere))) throw new Error(`Never reached ${isThere}`);
  return presses;
}

/** The focused element is a button or link in `scope` named `name` (or starting with it), its icon's word aside. */
function buttonIn(scope, name, starts = false) {
  return new Function(
    `const el = document.activeElement;
     if (!el?.closest(${JSON.stringify(scope)})) return false;
     const named = el.getAttribute('aria-label') ??
       el.textContent?.replace(/^\\s*[a-z_]+\\s+(?=[A-Z])/, '').replace(/\\s+/g, ' ').trim();
     return ${starts} ? named?.startsWith(${JSON.stringify(name)}) : named === ${JSON.stringify(name)};`,
  );
}

const text = (locator) =>
  locator.evaluate((element) => element.textContent.replace(/\s+/g, ' ').trim());
const snackBar = (page) => page.locator('.mat-mdc-snack-bar-container');

// ── The data ─────────────────────────────────────────────────────────────────────────────────────────────────────

const LIST = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c71';
const NETFLIX = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a71';
const ADS = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a72';
const MULLVAD = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a73';
const FAMILY_TAG = '0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c71';
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };

/** This month's and next month's dates, from the machine's date as the app's ClockService reads it. */
function dates() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const next = month === 12 ? `${year + 1}-01` : `${year}-${pad(month + 1)}`;
  return { next12: `${next}-12`, next20: `${next}-20`, nextYear: `${year + 1}-${pad(month)}-02` };
}

/**
 * Work Related, long enough to scroll: Netflix Standard with an extra member (tagged Family, French content Wanted),
 * Netflix Standard with ads, Mullvad VPN renewed by hand, and Crave, Disney+, Proton and TSN plans; a $50 monthly
 * budget, which it goes over.
 */
async function plant(page) {
  const { next12, next20, nextYear } = dates();
  const [settings] = await readTable(page, 'settings');
  await putRecord(page, 'settings', { ...settings, monthlyBudget: 50 });
  await putRecord(page, 'tags', { id: FAMILY_TAG, name: 'Family', color: '#1e88e5', ...stamps });
  await putRecord(page, 'lists', { id: LIST, name: 'Work Related', ...stamps });
  const monthly = (anchorDate) => ({
    mode: 'recurring',
    interval: 'month',
    intervalCount: 1,
    autoRenew: true,
    anchorDate,
  });
  const items = [
    [
      NETFLIX,
      {
        kind: 'catalog',
        planId: 'netflix.standard',
        addOns: [{ id: 'netflix.extra-member', quantity: 1 }],
      },
      monthly(next12),
      { tagIds: [FAMILY_TAG], rankOverrides: { 'streaming.french-content': 'wanted' } },
    ],
    [ADS, { kind: 'catalog', planId: 'netflix.standard-ads' }, monthly(next12)],
    [
      MULLVAD,
      { kind: 'catalog', planId: 'mullvad.vpn' },
      { ...monthly(nextYear), interval: 'year', autoRenew: false },
    ],
    [
      '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a74',
      { kind: 'catalog', planId: 'crave.premium' },
      monthly(next20),
    ],
    [
      '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a75',
      { kind: 'catalog', planId: 'disney-plus.standard' },
      monthly(next20),
    ],
    [
      '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a76',
      { kind: 'catalog', planId: 'proton.unlimited' },
      monthly(next20),
    ],
    [
      '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a77',
      { kind: 'catalog', planId: 'tsn.standard' },
      monthly(next20),
    ],
    [
      '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a78',
      { kind: 'catalog', planId: 'proton.vpn-plus' },
      monthly(next20),
    ],
  ];
  for (const [id, source, billing, extra = {}] of items) {
    await putRecord(page, 'items', {
      id,
      listId: LIST,
      source,
      billing,
      tagIds: [],
      rankOverrides: {},
      pinned: false,
      ...stamps,
      ...extra,
    });
  }
}

/** Leaves the list editor without saving: Cancel, then Discard changes, by keyboard. */
async function discardEdits(page) {
  await page.locator('ss-list-edit-page h1').click();
  await keyTo(page, buttonIn('ss-list-edit-page', 'Cancel'));
  await page.keyboard.press('Enter');
  const question = page.locator('ss-confirm-dialog');
  // It asks first when the draft has changes; it may take a moment to open.
  await until(
    'the question, or the editor gone',
    async () => (await question.count()) > 0 || !page.url().includes('/edit'),
  );
  if ((await question.count()) > 0) {
    await until('focus in the question', () =>
      page.evaluate(() => document.activeElement?.closest('ss-confirm-dialog') !== null),
    );
    await keyTo(page, buttonIn('ss-confirm-dialog', 'Discard changes'));
    await page.keyboard.press('Enter');
  }
  await until('the editor gone', async () => !page.url().includes('/edit'));
}

// ── P4: List view ───────────────────────────────────────────────────────────────────────────────────────────────

async function checkListView(page, label, viewport, shot) {
  await page.goto(`${baseUrl}lists/${LIST}`);
  const netflix = page.locator(`li[data-item="${NETFLIX}"] ss-item-card`);
  await netflix.locator('.add-ons').waitFor({ timeout: 20000 });
  const addOn = await text(
    netflix.locator('.add-ons li [aria-hidden="true"]').first().locator('..'),
  );
  check(
    `${label}: a card lists its add-on with its price (M6.12)`,
    (await text(netflix.locator('.add-ons li > span').first())) === '+ Extra member' &&
      (await netflix.locator('.add-ons li ss-price').count()) === 1,
    addOn,
  );
  const badge = await text(netflix.locator('ss-status-badge'));
  const mullvad = await text(page.locator(`li[data-item="${MULLVAD}"] ss-status-badge`));
  check(
    `${label}: one that renews by itself says when, one renewed by hand "Manual · renew by" (M6.12, M7.11)`,
    /^Active Auto-renews [A-Z][a-z]{2} 12$/.test(badge) && mullvad.includes('Manual · renew by'),
    `${badge} | ${mullvad}`,
  );

  // The budget warning's ✕, by keyboard: hidden, then shown again (M7.7).
  await page.locator('ss-list-view-page h1').click();
  await keyTo(page, buttonIn('ss-budget-warnings', 'Dismiss the', true));
  await page.keyboard.press('Enter');
  await page.locator('ss-budget-warnings .show-hidden').waitFor();
  await until('focus on Show hidden', () =>
    page.evaluate(() => document.activeElement?.classList.contains('show-hidden')),
  );
  const [settings] = await readTable(page, 'settings');
  check(
    `${label}: ✕ hides the warning, kept in the settings, with focus on Show 1 hidden budget warning (M7.7)`,
    (await page.locator('ss-budget-warnings .warning').count()) === 0 &&
      settings.dismissedBudgetWarnings?.[0]?.startsWith(LIST) === true,
    JSON.stringify(settings.dismissedBudgetWarnings),
  );
  await axeCheck(page, `${label}, a warning hidden`);
  await page.keyboard.press('Enter');
  await page.locator('ss-budget-warnings .warning').waitFor();
  check(
    `${label}: Show hidden brings it back`,
    (await page.locator('ss-budget-warnings .show-hidden').count()) === 0,
  );

  // One colour on the scale (M7.7): this month is over half again its $50, so it's all red.
  const colour = await barColour(page.locator('ss-budget-totals ss-budget-bar').first());
  check(
    `${label}: a budget bar is one colour, all red half again over its budget (M7.7)`,
    colour.image === 'none' && colour.towardYellow === '100%' && colour.towardRed === '100%',
    JSON.stringify(colour),
  );

  // Pinned while the cards scroll (M6.13).
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(400);
  const bar = await page.locator('ss-list-view-page .toolbar').boundingBox();
  const topBar = viewport === WIDE ? 0 : 56;
  check(
    `${label}: scrolled to the end, the search box and Sort stay below the top bar (M6.13)`,
    bar !== null && Math.abs(bar.y - topBar) <= 2,
    bar && `${Math.round(bar.y)} px`,
  );
  if (viewport === WIDE) {
    const link = await page.locator('.side ss-optimizations-link').boundingBox();
    const features = await page.locator('.side .features').boundingBox();
    check(
      `${label}: View optimizations stays on screen at the side column's foot, over nothing in it (M6.13)`,
      link !== null &&
        link.y >= 0 &&
        link.y + link.height <= viewport.height &&
        (features === null || features.y + features.height <= link.y + 1),
      link && `${Math.round(link.y)} px`,
    );
  } else {
    const compact = page.locator('.toolbar ss-optimizations-link a.compact');
    const box = await compact.boundingBox();
    check(
      `${label}: under 960 px a compact View optimizations is in the pinned bar (M6.13)`,
      box !== null && box.y >= 0 && box.y < topBar + 80,
      (await compact.getAttribute('aria-label')) ?? '',
    );
  }
  await noSideScroll(page, viewport, `${label}, List view scrolled`);
  await axeCheck(page, `${label}, List view scrolled`);
  await page.screenshot({ path: shot('list-view-pinned') });

  // View in Search names the plan (M5.11): Netflix's details by keyboard, then the link.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('ss-list-view-page h1').click();
  await keyTo(page, () => {
    const element = document.activeElement;
    return (
      element?.classList.contains('expand') === true &&
      element.closest('li')?.getAttribute('data-item') === '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a71'
    );
  });
  await page.keyboard.press('Enter');
  const view = netflix.locator('a.view');
  await view.waitFor();
  check(
    `${label}: View in Search names the item's plan (M5.11)`,
    (await view.getAttribute('href')) === '/search?q=Netflix&plan=netflix.standard',
    await view.getAttribute('href'),
  );
  await keyTo(page, buttonIn(`li[data-item="${NETFLIX}"]`, 'View in Search', true));
  await page.keyboard.press('Enter');
}

// ── P8: Search ──────────────────────────────────────────────────────────────────────────────────────────────────

async function checkSearch(page, label, viewport, shot) {
  await page.waitForURL(/\/search\?q=Netflix&plan=netflix\.standard/);
  const card = page.locator('ss-sub-card', {
    has: page.locator('h2.name', { hasText: /^Netflix$/ }),
  });
  await card.waitFor({ timeout: 20000 });
  const chosen = await card
    .locator('.plans input:checked')
    .evaluate((input) => input.closest('label').querySelector('span').textContent.trim());
  const status = await text(card.locator('ss-status-badge'));
  check(
    `${label}: Search shows the plan View in Search named, though the user has Standard with ads too (M5.11)`,
    chosen === 'Standard',
    chosen,
  );
  check(
    `${label}: its status says when it renews by itself (M6.12)`,
    / Auto-renews [A-Z][a-z]{2} 12$/.test(status),
    status,
  );
  // Its details, by keyboard: a policy rating's way to change it (M5.12).
  await keyTo(page, () => {
    const element = document.activeElement;
    return (
      element?.classList.contains('expand') === true &&
      element.closest('ss-sub-card')?.querySelector('h2.name')?.textContent.trim() === 'Netflix'
    );
  });
  await page.keyboard.press('Enter');
  const action = card.locator('.policies .action').first();
  await action.waitFor();
  check(
    `${label}: a rating that needs the user to change a setting links Netflix's own page for it (M5.12)`,
    (await action.getAttribute('href')) === 'https://help.netflix.com/node/100637' &&
      (await action.getAttribute('aria-label')) ===
        'How to turn off Behavioral Advertising, opens in a new tab' &&
      (await action.getAttribute('target')) === '_blank',
    await action.getAttribute('href'),
  );
  await noSideScroll(page, viewport, `${label}, Search`);
  await axeCheck(page, `${label}, Search with the policies`);
  await page.screenshot({ path: shot('search-plan-action') });
}

// ── P6: the item dialog ─────────────────────────────────────────────────────────────────────────────────────────

async function checkItemDialog(page, label, viewport, shot) {
  await page.goto(`${baseUrl}lists/${LIST}/edit`);
  await page.locator('li.item').first().waitFor({ timeout: 20000 });
  await page.locator('ss-list-edit-page h1').click();
  await keyTo(page, buttonIn('ss-list-edit-page', 'Edit Netflix Standard'));
  await page.keyboard.press('Enter');
  const dialog = page.locator('ss-item-dialog');
  await dialog.waitFor();
  await until('focus on its heading', () =>
    page.evaluate(() => document.activeElement?.matches('ss-item-dialog h2') === true),
  );
  await dialog.locator('.ranks .note').waitFor();
  check(
    `${label}: Feature ranks says which plans share them, with "Ranks for this plan only" (M6.14)`,
    (await text(dialog.locator('.ranks .note'))) ===
      'Changes here go to the same features of Netflix Standard with ads in this list too. Essential stays on this plan.' &&
      (await dialog.locator('.own-ranks').count()) === 1,
    await text(dialog.locator('.ranks .note')),
  );
  // French-language content's rank, by keyboard: Needed.
  await keyTo(page, () => {
    const element = document.activeElement;
    const ids = element?.getAttribute('aria-labelledby')?.split(' ') ?? [];
    return (
      element?.getAttribute('role') === 'combobox' &&
      ids.some(
        (id) => document.getElementById(id)?.textContent.trim() === 'French-language content',
      )
    );
  });
  await page.keyboard.press('Enter');
  await page.locator('.ss-rank-select-panel mat-option').first().waitFor();
  await page.keyboard.type('Nee');
  await sleep(300);
  await page.keyboard.press('Enter');
  await page.locator('.ss-rank-select-panel').waitFor({ state: 'detached' });
  await axeCheck(page, `${label}, the item dialog's shared ranks`);
  await keyTo(page, buttonIn('ss-item-dialog', 'Save'));
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'detached' });
  await snackBar(page).waitFor();
  const [draft] = await readTable(page, 'drafts');
  const of = (id) => draft?.items.find((entry) => entry.item.id === id)?.item.rankOverrides;
  check(
    `${label}: Save shares the rank with Standard with ads in the draft, and says so (M6.14)`,
    (await text(snackBar(page))).startsWith(
      'Saved Netflix Standard, and its ranks to 1 more plan',
    ) &&
      of(NETFLIX)?.['streaming.french-content'] === 'needed' &&
      of(ADS)?.['streaming.french-content'] === 'needed',
    JSON.stringify([of(NETFLIX), of(ADS)]),
  );

  // New tag: the hex field and the device's colour picker, each following the other (M6.15).
  await until('the snackbar gone', async () => (await snackBar(page).count()) === 0, 8000);
  await keyTo(page, buttonIn('ss-list-edit-page', 'Edit Netflix Standard'), 'Tab');
  await page.keyboard.press('Enter');
  await dialog.waitFor();
  await until('focus on its heading', () =>
    page.evaluate(() => document.activeElement?.matches('ss-item-dialog h2') === true),
  );
  await keyTo(
    page,
    () =>
      document.activeElement?.classList.contains('mat-mdc-chip-input') === true &&
      document.activeElement.closest('ss-tag-picker') !== null,
  );
  await page.keyboard.type('Gym');
  await page.locator('.cdk-overlay-pane mat-option', { hasText: 'Create tag' }).waitFor();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const create = dialog.locator('.create');
  await create.waitFor();
  const hex = create.locator('.hex input');
  const picker = create.locator('ss-colour-picker input');
  check(
    `${label}: New tag has a hex field and the colour picker, showing the same colour (M6.15)`,
    (await picker.getAttribute('type')) === 'color' &&
      (await hex.inputValue()) === (await picker.inputValue()),
    `${await hex.inputValue()} | ${await picker.inputValue()}`,
  );
  await hex.focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('#12AB9F');
  await until('the picker following', async () => (await picker.inputValue()) === '#12ab9f');
  check(`${label}: a hex typed colours the picker`, true);
  await axeCheck(page, `${label}, New tag with the colour picker`);
  await page.screenshot({ path: shot('item-dialog-new-tag') });
  await page.keyboard.press('Escape');
  await create.waitFor({ state: 'detached' });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await discardEdits(page);
}

// ── P14: Optimizations ──────────────────────────────────────────────────────────────────────────────────────────

async function checkOptimizations(page, label, viewport, shot) {
  // From no draft, so Undo drops the one Apply makes.
  for (const draft of await readTable(page, 'drafts')) {
    await page.evaluate(
      (listId) =>
        new Promise((resolve) => {
          const request = indexedDB.open('simply-sub');
          request.onsuccess = () => {
            const transaction = request.result.transaction('drafts', 'readwrite');
            transaction.objectStore('drafts').delete(listId);
            transaction.oncomplete = () => {
              request.result.close();
              resolve();
            };
          };
        }),
      draft.listId,
    );
  }
  await page.goto(`${baseUrl}lists/${LIST}/optimize`);
  await page.locator('ss-suggestion-card').first().waitFor({ timeout: 30000 });
  const before = await page.locator('ss-suggestion-card').count();
  await page.locator('ss-optimizations-page h1').click();
  await keyTo(page, buttonIn('ss-optimizations-page', 'Apply:', true));
  const applied = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
  await page.keyboard.press('Enter');
  await page.locator('ss-optimizations-page .unsaved a.review').waitFor({ timeout: 15000 });
  await snackBar(page).waitFor();
  check(
    `${label}: Apply stays on the page, with Review changes and "Applied:" with Undo (M8.4, M8.6)`,
    page.url().endsWith(`/lists/${LIST}/optimize`) &&
      (await text(snackBar(page))).startsWith('Applied:') &&
      (await readTable(page, 'drafts')).length === 1,
    applied,
  );
  await until('focus on a card or Review changes', () =>
    page.evaluate(
      () =>
        document.activeElement?.classList.contains('title') === true ||
        document.activeElement?.id === 'review',
    ),
  );
  check(
    `${label}: focus moves on to the next card (or Review changes)`,
    true,
    `${before} cards before`,
  );
  await noSideScroll(page, viewport, `${label}, Optimizations with a change applied`);
  await axeCheck(page, `${label}, Optimizations with a change applied`);
  await page.screenshot({ path: shot('optimizations-applied'), fullPage: true });
  // Undo puts the draft back: this Apply made it, so it's gone.
  await snackBar(page).getByRole('button', { name: 'Undo' }).focus();
  await page.keyboard.press('Enter');
  await until('the draft dropped', async () => (await readTable(page, 'drafts')).length === 0);
  check(`${label}: Undo drops the draft the first Apply made`, true);
  // Apply again, then Review changes (M8.6), whose Open in the editor opens the editor with it.
  await page.locator('ss-optimizations-page h1').click();
  await keyTo(page, buttonIn('ss-optimizations-page', 'Apply:', true));
  await page.keyboard.press('Enter');
  await page.locator('ss-optimizations-page .unsaved a.review').waitFor({ timeout: 15000 });
  await keyTo(page, () => document.activeElement?.id === 'review');
  await page.keyboard.press('Enter');
  await page.waitForURL(new RegExp(`/lists/${LIST}/optimize/review$`));
  await page.locator('ss-review-changes-page li.change').first().waitFor({ timeout: 20000 });
  await keyTo(page, buttonIn('ss-review-changes-page', 'Open in the editor'));
  await page.keyboard.press('Enter');
  await page.waitForURL(new RegExp(`/lists/${LIST}/edit$`));
  check(`${label}: Review changes, then Open in the editor, opens the editor`, true);
  await page.locator('li.item').first().waitFor({ timeout: 20000 });
  await discardEdits(page);
}

// ── P10: the Calendar ───────────────────────────────────────────────────────────────────────────────────────────

async function checkCalendar(page, label, viewport, shot) {
  // From List view's budget warning: a back button to it (M7.8).
  await page.goto(`${baseUrl}lists/${LIST}`);
  await page.locator('ss-budget-warnings .warning a').waitFor({ timeout: 20000 });
  await page.locator('ss-list-view-page h1').click();
  await keyTo(page, () => document.activeElement?.closest('ss-budget-warnings a') !== null);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/calendar\?/);
  const back = page.locator('ss-calendar-page ss-page-header .back');
  await back.waitFor({ timeout: 20000 });
  check(
    `${label}: opened from List view, the Calendar has "← Work Related" (M7.8)`,
    (await text(back)) === 'arrow_back Work Related' &&
      (await back.getAttribute('href')) === `/lists/${LIST}`,
    await text(back),
  );

  await page.goto(`${baseUrl}calendar`);
  await page.locator('ss-calendar-page .grid').waitFor({ timeout: 20000 });
  await page.locator('ss-calendar-page .grid .day').first().waitFor();
  if (viewport === WIDE) {
    check(
      `${label}: opened first, it has no back button`,
      (await page.locator('ss-calendar-page .back').count()) === 0,
    );
    const width = async () => (await page.locator('ss-calendar-page .grid').boundingBox()).width;
    const shut = await width();
    check(
      `${label}: a column beside the grid holds "Choose a day…" and Upcoming (M7.8)`,
      (await text(page.locator('.side .pick-day'))) === 'Choose a day to see its payments.' &&
        (await page.locator('.side ss-upcoming').count()) === 1,
    );
    await page.locator('main').focus();
    await keyTo(page, () => document.activeElement?.classList.contains('day') === true);
    await page.keyboard.press('Enter');
    await page.locator('.side ss-day-panel').waitFor();
    const open = await width();
    check(
      `${label}: opening a day keeps the grid's width (M7.8)`,
      Math.abs(open - shut) < 1,
      `${Math.round(shut)} → ${Math.round(open)} px`,
    );
    await axeCheck(page, `${label}, the Calendar with a day open`);
    await page.screenshot({ path: shot('calendar-day-open') });
    await page.keyboard.press('Escape');

    // From the sidebar: no back button.
    await page.goto(`${baseUrl}lists/${LIST}`);
    await page.locator('ss-list-view-page h1').waitFor({ timeout: 20000 });
    await page.locator('nav[aria-label="Main"] .logo').click();
    await keyTo(page, () => document.activeElement?.textContent?.trim() === 'Calendar');
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/calendar/);
    await page.locator('ss-calendar-page h1').waitFor();
    await sleep(500);
    check(
      `${label}: opened from the sidebar, it has none (M7.8)`,
      (await page.locator('ss-calendar-page .back').count()) === 0,
    );
  } else {
    check(
      `${label}: a phone has the compact grid over the agenda, a dot on the days with payments (M7.8)`,
      (await page.locator('.grid.compact').count()) === 1 &&
        (await page.locator('.grid.compact .chip').count()) === 0,
      `${await page.locator('.grid.compact .dot').count()} dots`,
    );
    await page.locator('main').focus();
    await keyTo(page, () => document.activeElement?.classList.contains('day') === true);
    await page.keyboard.press('Enter');
    const sheet = page.locator('ss-day-sheet');
    await sheet.waitFor();
    await sleep(600);
    check(
      `${label}: Enter on a day opens it in the bottom sheet`,
      (await sheet.locator('h2').count()) === 1,
    );
    await axeCheck(page, `${label}, the day's bottom sheet`);
    await page.screenshot({ path: shot('calendar-compact-sheet') });
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'detached' });
  }
  await noSideScroll(page, viewport, `${label}, the Calendar`);

  // Export to file's JSON and Text (M7.9), from its menu by keyboard.
  await page.locator('ss-calendar-page h1').click();
  await keyTo(page, buttonIn('ss-calendar-page', 'Export to file, more options'));
  await page.keyboard.press('Enter');
  const items = page.locator('.mat-mdc-menu-panel [mat-menu-item]');
  await items.first().waitFor();
  const names = await items.evaluateAll((all) =>
    all.map((item) => item.querySelector('span:not(.mat-icon)')?.textContent.trim()),
  );
  check(
    `${label}: Export to file offers JSON and Text too (M7.9)`,
    JSON.stringify(names) ===
      JSON.stringify([
        'Calendar (.ics)',
        'Payment schedule (.csv)',
        'Excel (.xlsx)',
        'JSON (.json)',
        'Text (.txt)',
      ]),
    JSON.stringify(names),
  );
  await keyTo(
    page,
    () => document.activeElement?.textContent?.includes('JSON (.json)') === true,
    'ArrowDown',
    6,
  );
  const [json] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  const file = JSON.parse(fs.readFileSync(await json.path(), 'utf8'));
  check(
    `${label}: the JSON lists the payments of the next 12 months`,
    json.suggestedFilename().endsWith('.json') &&
      file.file === 'payments' &&
      file.payments.length > 0 &&
      file.payments.some(
        (payment) => payment.name === 'Netflix' && payment.tags?.includes('Family'),
      ),
    `${json.suggestedFilename()}: ${file.payments?.length} payments`,
  );
  await keyTo(page, buttonIn('ss-calendar-page', 'Export to file, more options'));
  await page.keyboard.press('Enter');
  await items.first().waitFor();
  await keyTo(
    page,
    () => document.activeElement?.textContent?.includes('Text (.txt)') === true,
    'ArrowDown',
    6,
  );
  const [txt] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  const words = fs.readFileSync(await txt.path(), 'utf8');
  check(
    `${label}: the Text says the payments month by month`,
    words.startsWith('Simply Sub payments\n') && /\n[A-Z][a-z]+ \d{4}: /.test(words),
    words.split('\n').slice(0, 2).join(' | '),
  );
}

// ── P13: Settings ───────────────────────────────────────────────────────────────────────────────────────────────

async function checkSettings(page, label, viewport, shot) {
  await page.goto(`${baseUrl}settings`);
  await page.locator('ss-settings-page h1').waitFor({ timeout: 20000 });
  await page.locator('ss-settings-page h1').click();
  await keyTo(page, buttonIn('ss-settings-page', 'Alberta, Canada', true));
  await page.keyboard.press('Enter');
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor();
  // Focus starts on its heading (M6.16), once it's open: Tab only after that.
  await until('focus on its heading', () =>
    page.evaluate(() => document.activeElement?.matches('mat-dialog-container h2') === true),
  );
  const province = page.locator('ss-choice-field[data-label="Province or territory"] input');
  await keyTo(
    page,
    () =>
      document.activeElement?.closest('ss-choice-field[data-label="Province or territory"]') !==
      null,
  );
  await page.keyboard.press('Control+A');
  await page.keyboard.type('que');
  const options = page.locator('.cdk-overlay-pane mat-option');
  await options.first().waitFor();
  await sleep(300);
  const shown = await options.evaluateAll((all) => all.map((option) => option.textContent.trim()));
  await axeCheck(page, `${label}, the 📍 dialog's menu typed in`, ['ss-choice-field mat-hint']);
  await page.keyboard.press('Enter');
  await options.first().waitFor({ state: 'detached' });
  check(
    `${label}: Settings' province menu narrows as it's typed in, and Enter picks the first (M6.16)`,
    JSON.stringify(shown) === JSON.stringify(['Quebec']) &&
      (await province.inputValue()) === 'Quebec' &&
      (await text(dialog)).includes('Sales tax 14.975% (Quebec)'),
    JSON.stringify(shown),
  );
  await page.screenshot({ path: shot('settings-location-typed') });
  await keyTo(page, buttonIn('mat-dialog-container', 'Cancel'));
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'detached' });

  // A tag's colour picker, beside its hex field (M6.15).
  await keyTo(page, buttonIn('ss-settings-page', 'Colour of Family', true));
  await page.keyboard.press('Enter');
  const editor = page.locator('ss-tag-editor');
  await editor.waitFor();
  const picker = editor.locator('ss-colour-picker input');
  const hex = editor.locator('.hex input');
  check(
    `${label}: the tag editor has the colour picker beside Hex colour, on the tag's colour (M6.15)`,
    (await picker.inputValue()) === '#1e88e5' && (await hex.inputValue()) === '#1e88e5',
    await picker.inputValue(),
  );
  await keyTo(page, () => document.activeElement?.closest('ss-tag-editor .hex') !== null);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('#FF8800');
  await until('the picker following', async () => (await picker.inputValue()) === '#ff8800');
  check(`${label}: a hex typed colours the picker`, true);
  await noSideScroll(page, viewport, `${label}, Settings`);
  await axeCheck(page, `${label}, the tag editor with its picker`);
  await page.keyboard.press('Escape');
}

// ── Home: the bars' one colour and its warnings (M7.7) ──────────────────────────────────────────────────────────

/** A bar's fill: whether it has an image (a gradient), and where its one colour sits on the scale (M7.7). */
function barColour(bar) {
  return bar.evaluate((host) => ({
    image: getComputedStyle(host.querySelector('.fill')).backgroundImage,
    towardYellow: host.style.getPropertyValue('--toward-yellow'),
    towardRed: host.style.getPropertyValue('--toward-red'),
  }));
}

async function checkHome(page, label, viewport) {
  await page.goto(baseUrl);
  await page.locator('ss-home-page ss-budget-bar').first().waitFor({ timeout: 20000 });
  const colour = await barColour(page.locator('ss-home-page ss-budget-bar').first());
  check(
    `${label}: Home's bars are one colour on the scale, and its warnings have ✕ (M7.7)`,
    colour.image === 'none' &&
      colour.towardRed === '100%' &&
      (await page.locator('ss-home-page ss-budget-warnings .dismiss').count()) > 0,
    JSON.stringify(colour),
  );
  await noSideScroll(page, viewport, `${label}, Home`);
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
      await page.reload();

      for (const [name, run] of [
        ['List view', checkListView],
        ['Search', checkSearch],
        ['the item dialog', checkItemDialog],
        ['Optimizations', checkOptimizations],
        ['the Calendar', checkCalendar],
        ['Settings', checkSettings],
        ['Home', checkHome],
      ]) {
        try {
          await run(page, label, viewport, shot);
        } catch (error) {
          check(`${label}: ${name} ran to the end`, false, error.message.split('\n')[0]);
          await page
            .screenshot({ path: shot(`failed-${name.replace(/\W+/g, '-')}`) })
            .catch(() => {});
        }
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

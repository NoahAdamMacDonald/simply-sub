// The feedback after M3 (M5.13, M6.17–M6.19, M7.11, M8.5, M8.6, M9.6) in the system Edge, on `ng serve`. In both
// themes at 1280 and 360 px, keyboard only, with axe and no horizontal scroll:
// - a bundle that replaces two plans (M8.5): Optimizations' card for Crave Premium and Disney+ Premium, applied by
//   Enter; Review changes (M8.6) with − for each plan, which ends when what's paid for runs out, + for the bundle from
//   then, and this year's total and the next 12 months' lower by what the card said; Undo by Enter emptying it; then
//   applied again and Save changes, and List view's badges saying where each plan moves (M7.11);
// - an extra member (M8.5): two Disney+ Premium, one becoming an extra member on the other from its next charge,
//   through Review changes and Save changes, its badge saying so;
// - List view (P4): the filters staying with their pinned bar when the page scrolls (M6.17), Sort's and View
//   optimizations' icons centred in their buttons on a phone (M6.18), and a plan that auto-renews until an end date in
//   words that agree, on its card and in the item dialog (M6.19);
// - Settings' "Show every reseller" (M5.13): Search's Mullvad card lists the resellers that aren't cheaper too;
// - a buyer in the US paying with a card with no FX fee (M9.6): "Pay for Proton Unlimited in CAD", applied and
//   reviewed as their own price in CAD from the next charge, saved to IndexedDB.
// Usage: node check-after-m3.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

/** The ECB's rates of the route below, per unit of each base. */
const rates = {
  CAD: { CHF: 0.581, EUR: 0.6372, GBP: 0.5571, SEK: 7.097, USD: 0.7243 },
  USD: { CAD: 1.3806, CHF: 0.8022, EUR: 0.8797, GBP: 0.7692, SEK: 9.799 },
};

async function newPage(browser, label, { colorScheme = 'light', viewport = WIDE } = {}) {
  const context = await browser.newContext({ locale: 'en-CA', colorScheme, viewport });
  // GET /fx, answered with fixed rates for the base asked for, so no Worker is needed behind the dev proxy.
  await context.route('**/api/v1/fx?**', (route) => {
    const base = new URL(route.request().url()).searchParams.get('base') ?? 'CAD';
    return route.fulfill({
      json: {
        data: {
          base,
          date: '2026-10-26',
          source: 'European Central Bank via Frankfurter',
          rates: rates[base] ?? rates.CAD,
        },
        meta: { fetchedAt: '2026-10-26T06:00:02Z', stale: false },
      },
    });
  });
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
  await until('focus on the heading', () =>
    page.evaluate(() => document.activeElement?.matches('mat-dialog-container h2') === true),
  );
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

/** Writes a record straight to an IndexedDB table: reload after, for Dexie's live queries to see it. */
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
  // Material renders menus, dialogs and snackbars outside the page's landmarks: set aside `region` hits in its
  // overlay container.
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

async function noSideScroll(page, viewport, label) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`no horizontal scroll: ${label}`, width <= viewport.width, `${width}px`);
}

/** Presses `key` (Tab by default) until `isThere` holds for the focused element. */
async function keyTo(page, isThere, key = 'Tab', limit = 120) {
  let presses = 0;
  while (presses < limit && !(await page.evaluate(isThere))) {
    await page.keyboard.press(key);
    presses++;
  }
  if (!(await page.evaluate(isThere))) throw new Error(`Never reached ${isThere}`);
}

/** The focused element's aria-label starts with `start`. */
const labelled = (start) =>
  new Function(
    `return document.activeElement?.getAttribute('aria-label')?.startsWith(${JSON.stringify(start)}) === true;`,
  );
/** The focused element is a button or link whose words (its icon's aside) are `name`. */
const named = (name) =>
  new Function(
    `const el = document.activeElement;
     if (!el || !['A', 'BUTTON'].includes(el.tagName)) return false;
     // Its text and elements' words, not an icon's ligature or a comment Angular leaves.
     const words = [...el.childNodes]
       .map((node) => node.nodeType === 3 || (node.nodeType === 1 && !node.matches('mat-icon')) ? node.textContent : '')
       .join(' ');
     return words.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(name)};`,
  );

const text = (locator) =>
  locator.evaluate((element) => element.textContent.replace(/\s+/g, ' ').trim());
const snackBar = (page) => page.locator('.mat-mdc-snack-bar-container');

// ── The data ─────────────────────────────────────────────────────────────────────────────────────────────────────

const STREAM = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c81';
const FAMILY = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c82';
const PRIVACY = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c83';
const CRAVE = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a81';
const DISNEY = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a82';
const DISNEY_A = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a83';
const DISNEY_B = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a84';
const NETFLIX = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a85';
const PROTON = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a86';
const NO_FX = '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d81';
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };
const BUNDLE = 'Disney+ and Crave Premium Bundle';

/** Next month's 12th, 20th and 28th, from the machine's date as the app's ClockService reads it. */
function dates() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const month = now.getMonth() + 1;
  const next =
    month === 12 ? `${now.getFullYear() + 1}-01` : `${now.getFullYear()}-${pad(month + 1)}`;
  return { next12: `${next}-12`, next20: `${next}-20`, next28: `${next}-28` };
}
/** "Nov 12", as the app writes a day in this year. */
const day = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
/** "Nov 12, 2026". */
const date = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

const monthly = (anchorDate, extra = {}) => ({
  mode: 'recurring',
  interval: 'month',
  intervalCount: 1,
  anchorDate,
  autoRenew: true,
  ...extra,
});

async function putItem(page, id, listId, planId, billing, extra = {}) {
  await putRecord(page, 'items', {
    id,
    listId,
    source: planId.startsWith('bundle.')
      ? { kind: 'bundle', bundleId: planId }
      : { kind: 'catalog', planId },
    billing,
    tagIds: [],
    rankOverrides: {},
    pinned: false,
    ...stamps,
    ...extra,
  });
}

/**
 * Streaming: Crave Premium and Disney+ Premium, which their bundle replaces. Family, long enough to scroll: two
 * Disney+ Premium (one can be an extra member on the other), Netflix Standard auto-renewing until an end date, Mullvad
 * renewed by hand, and Proton, TSN, RDS and ICI TOU.TV plans.
 */
async function plant(page) {
  const { next12, next20, next28 } = dates();
  await putRecord(page, 'lists', { id: STREAM, name: 'Streaming', ...stamps });
  await putRecord(page, 'lists', { id: FAMILY, name: 'Family', ...stamps });
  await putItem(page, CRAVE, STREAM, 'crave.premium', monthly(next20));
  await putItem(page, DISNEY, STREAM, 'disney-plus.premium', monthly(next12));
  await putItem(page, DISNEY_A, FAMILY, 'disney-plus.premium', monthly(next12));
  await putItem(page, DISNEY_B, FAMILY, 'disney-plus.premium', monthly(next20));
  await putItem(page, NETFLIX, FAMILY, 'netflix.standard', monthly(next12, { endDate: next28 }));
  const rest = [
    ['mullvad.vpn', { ...monthly(next20), interval: 'year', autoRenew: false }],
    ['proton.vpn-plus', monthly(next20)],
    ['tsn.standard', monthly(next20)],
    ['rds.standard', monthly(next20)],
    ['ici-tou-tv.extra', monthly(next20)],
  ];
  for (const [index, [planId, billing]] of rest.entries()) {
    await putItem(page, `0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a9${index}`, FAMILY, planId, billing);
  }
}

/** The cards on Optimizations, once worked out. */
async function openOptimizations(page, listId) {
  await page.goto(`${baseUrl}lists/${listId}/optimize`);
  await page.locator('ss-suggestion-card').first().waitFor({ timeout: 30000 });
}

/** Applies the card whose Apply is named "Apply: <start>…", by keyboard; its title. */
async function applyCard(page, start) {
  await page.locator('ss-optimizations-page h1').click();
  await keyTo(page, labelled(`Apply: ${start}`), 'Tab', 200);
  const title = (
    await page.evaluate(() => document.activeElement.getAttribute('aria-label'))
  ).replace(/^Apply: /, '');
  await page.keyboard.press('Enter');
  await page.locator('ss-optimizations-page .unsaved a.review').waitFor({ timeout: 15000 });
  // The suggestions are worked out again; until then, none can be applied (M8.6).
  await until(
    'the suggestions worked out again',
    async () =>
      !(await page.locator('ss-optimizations-page').textContent()).includes(
        'Updating the suggestions',
      ),
    30000,
  );
  return title;
}

/** Review changes, opened from Optimizations' link by keyboard. */
async function openReview(page, listId) {
  await page.locator('ss-optimizations-page h1').click();
  await keyTo(page, () => document.activeElement?.id === 'review');
  await page.keyboard.press('Enter');
  await page.waitForURL(new RegExp(`/lists/${listId}/optimize/review$`));
  await page.locator('ss-review-changes-page li.change').first().waitFor({ timeout: 20000 });
  // The totals come once every item is priced.
  await page.locator('ss-review-changes-page dl.totals').waitFor({ timeout: 20000 });
}

/** Each of Review changes' lines, as the eye reads it: its sign, name, price and what it does. */
const reviewLines = (page) =>
  page.locator('ss-review-changes-page .lines li').evaluateAll((items) =>
    items.map((item) =>
      ['.sign', '.name', '.price', '.what']
        .map((selector) => item.querySelector(selector)?.textContent.trim())
        .filter(Boolean)
        .join(' | '),
    ),
  );

/** Review changes' totals: each row's label, and its amounts before and after. */
const reviewTotals = (page) =>
  page.locator('ss-review-changes-page dl.totals > div').evaluateAll((rows) =>
    rows.map((row) => {
      const [before, after] = [
        ...row.querySelector('dd').textContent.matchAll(/\$([\d,]+\.\d\d)/g),
      ].map((match) => Number(match[1].replace(/,/g, '')));
      return { label: row.querySelector('dt').textContent.trim(), before, after };
    }),
  );

/** Save changes on Review changes, by keyboard, landing on List view. */
async function saveReview(page, listId) {
  await page.locator('ss-review-changes-page h1').click();
  await keyTo(page, named('Save changes'));
  await page.keyboard.press('Enter');
  await page.waitForURL(new RegExp(`/lists/${listId}$`));
  await page.locator('ss-item-card').first().waitFor({ timeout: 20000 });
}

/** Each card's status badge on List view, by item id, as shown (no icon ligature). */
const badges = (page) =>
  page.locator('ss-list-view-page li[data-item]').evaluateAll((items) =>
    Object.fromEntries(
      items.map((item) => {
        const badge = item.querySelector('ss-status-badge')?.cloneNode(true);
        badge?.querySelectorAll('mat-icon, .visually-hidden').forEach((hidden) => hidden.remove());
        return [item.getAttribute('data-item'), badge?.textContent.replace(/\s+/g, ' ').trim()];
      }),
    ),
  );

// ── M8.5, M8.6, M7.11: a bundle ─────────────────────────────────────────────────────────────────────────────────

async function checkBundle(page, label, viewport, shot) {
  const { next12 } = dates();
  await openOptimizations(page, STREAM);
  const title = await applyCard(page, 'Replace ');
  check(
    `${label}: Optimizations suggests the bundle for Crave Premium and Disney+ Premium, and Apply puts it on the draft`,
    /^Replace (Crave Premium and Disney\+ Premium|Disney\+ Premium and Crave Premium) with Disney\+ and Crave Premium Bundle$/.test(
      title,
    ) && (await readTable(page, 'drafts')).some((draft) => draft.listId === STREAM),
    title,
  );
  // Worked out again for the draft, no card left changes a plan the bundle replaces (M8.6, the feedback's 5th point).
  const left = (await page.locator('ss-optimizations-page ss-suggestion-card h3').allTextContents())
    .map((heading) => heading.replaceAll(BUNDLE, ''))
    .filter((heading) => /Crave Premium|Disney\+ Premium/.test(heading));
  check(
    `${label}: once it's applied, no card is left that changes Crave Premium or Disney+ Premium`,
    left.length === 0,
    left.join(' | '),
  );
  await openReview(page, STREAM);
  // Applied's snackbar closes with Optimizations: its Undo was for that page (M8.6).
  const applied = page.locator('.mat-mdc-snack-bar-container', { hasText: 'Applied:' });
  const closed = await until(
    'Applied’s snackbar closed',
    async () => (await applied.count()) === 0,
    3000,
  )
    .then(() => true)
    .catch(() => false);
  check(`${label}: Applied's snackbar closes when Optimizations is left`, closed);
  const lines = await reviewLines(page);
  const ends = `Ends ${date(next12)}, when what's paid for runs out`;
  check(
    `${label}: Review changes shows − for each plan, ending when what's paid for runs out, and + for the bundle from then (M8.5, M8.6)`,
    lines.some((line) => line.startsWith('− | Crave Premium | $22.00 a month | Ends ')) &&
      lines.includes(`− | Disney+ Premium | $16.99 a month | ${ends}`) &&
      lines.includes(`+ | ${BUNDLE} | $29.25 a month | From ${date(next12)}`),
    lines.join(' / '),
  );
  const totals = await reviewTotals(page);
  const saves = Number(
    /\$([\d,]+\.\d\d)/
      .exec(await text(page.locator('ss-review-changes-page .change .saves').first()))?.[1]
      ?.replace(/,/g, ''),
  );
  const [year, next] = totals;
  check(
    `${label}: this year's total doesn't rise, and the next 12 months' falls by what the card said (M8.5)`,
    year?.label === 'This year' &&
      next?.label === 'Next 12 months' &&
      year.after <= year.before &&
      next.after < next.before &&
      Math.abs(next.before - next.after - saves) <= 0.02,
    `${JSON.stringify(totals)}, saves ${saves}`,
  );
  await noSideScroll(page, viewport, `${label}, Review changes`);
  await page.screenshot({ path: shot('review-bundle'), fullPage: true });
  await axeCheck(page, `${label}, Review changes`);

  // Undo by keyboard: the only change, so the draft goes and the page says there's nothing to review.
  await page.locator('ss-review-changes-page h1').click();
  await keyTo(page, labelled(`Undo: ${title}`));
  await page.keyboard.press('Enter');
  await page
    .locator('ss-review-changes-page ss-empty-state h2', { hasText: 'No changes to review' })
    .waitFor({ timeout: 15000 });
  await until('the draft gone', async () =>
    (await readTable(page, 'drafts')).every((draft) => draft.listId !== STREAM),
  );
  check(`${label}: Undo takes the change back, and the draft with it`, true);
  await axeCheck(page, `${label}, Review changes with nothing to review`);
  // axe leaves a Material button's layered background as "incomplete": measure its label against it here.
  const backButton = await page.evaluate(() => {
    const button = document.querySelector('ss-review-changes-page ss-empty-state a');
    const label = button.querySelector('.mdc-button__label');
    const rgb = (value) =>
      value
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number);
    const luminance = ([r, g, b]) =>
      [r, g, b]
        .map((c) => c / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const [a, b] = [
      luminance(rgb(getComputedStyle(label).color)),
      luminance(rgb(getComputedStyle(button).backgroundColor)),
    ].sort((x, y) => y - x);
    return {
      text: label.textContent.trim(),
      contrast: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100,
    };
  });
  check(
    `${label}: its Back to optimizations button's label shows, at least 4.5:1 on the button`,
    backButton.text === 'Back to optimizations' && backButton.contrast >= 4.5,
    JSON.stringify(backButton),
  );

  // Back to Optimizations by its button, applied again, then Save changes: List view says where each plan moves.
  await page.locator('ss-review-changes-page h1').click();
  await keyTo(page, named('Back to optimizations'));
  await page.keyboard.press('Enter');
  await page.waitForURL(new RegExp(`/lists/${STREAM}/optimize$`));
  await page.locator('ss-suggestion-card').first().waitFor({ timeout: 30000 });
  await applyCard(page, 'Replace ');
  await openReview(page, STREAM);
  await saveReview(page, STREAM);
  const items = await readTable(page, 'items');
  const bundle = items.find(
    (item) => item.listId === STREAM && item.source.kind === 'bundle' && !item.deletedAt,
  );
  check(
    `${label}: Save changes saves the bundle from ${next12} and ends both plans`,
    bundle?.billing.startDate === next12 &&
      items.find((item) => item.id === DISNEY)?.billing.endDate === next12 &&
      items.find((item) => item.id === CRAVE)?.billing.endDate !== undefined,
    JSON.stringify(bundle?.billing),
  );
  await until('the badges', async () => (await badges(page))[DISNEY]?.includes('Moves to'));
  const shown = await badges(page);
  check(
    `${label}: List view's badges say where each plan moves, and when (M7.11)`,
    shown[DISNEY] === `Active Moves to ${BUNDLE} on ${day(next12)}` &&
      /^Active Moves to Disney\+ and Crave Premium Bundle on \w{3} \d+$/.test(shown[CRAVE]),
    `${shown[DISNEY]} / ${shown[CRAVE]}`,
  );
  await noSideScroll(page, viewport, `${label}, List view with the bundle`);
  await page.screenshot({ path: shot('list-bundle'), fullPage: true });
  await axeCheck(page, `${label}, List view with the bundle`);
}

// ── P4: List view (M6.17, M6.18, M6.19) ──────────────────────────────────────────────────────────────────────────

async function checkListView(page, label, viewport, shot) {
  const { next12, next28 } = dates();
  await page.goto(`${baseUrl}lists/${FAMILY}`);
  await page.locator(`li[data-item="${NETFLIX}"] ss-status-badge`).waitFor({ timeout: 20000 });
  await until('the badges', async () => (await badges(page))[NETFLIX]?.includes('then ends'));
  const shown = await badges(page);
  check(
    `${label}: a plan that auto-renews until an end date says both, in words that agree (M6.19)`,
    shown[NETFLIX] === `Active Renews ${day(next12)}, then ends ${day(next28)}`,
    shown[NETFLIX],
  );

  // Sort's filters, opened by keyboard, stay with the pinned bar when the page scrolls (M6.17).
  await page.locator('ss-list-view-page h1').click();
  await keyTo(page, () => document.activeElement?.classList.contains('filters-toggle'));
  await page.keyboard.press('Enter');
  const filters = page.locator('ss-list-view-page ss-list-filters');
  await filters.waitFor();
  // To the last card, at the window's foot: past the list, the bar goes with it, as it should.
  await page.evaluate(() =>
    document
      .querySelector('ss-list-view-page li[data-item]:last-of-type')
      .scrollIntoView({ block: 'end' }),
  );
  await sleep(400);
  const placed = await page.evaluate(() => {
    const pinned = document.querySelector('ss-list-view-page .pinned');
    const bar = pinned.getBoundingClientRect();
    const panel = document
      .querySelector('ss-list-view-page ss-list-filters')
      .getBoundingClientRect();
    return {
      scrolled: Math.round(window.scrollY),
      stuckAt: parseFloat(getComputedStyle(pinned).top),
      bar: Math.round(bar.top),
      panelTop: Math.round(panel.top),
      panelBottom: Math.round(panel.bottom),
    };
  });
  check(
    `${label}: scrolled down, the open filters stay under their pinned bar, on screen (M6.17)`,
    placed.scrolled > 100 &&
      Math.abs(placed.bar - placed.stuckAt) <= 1 &&
      placed.panelTop >= placed.bar &&
      placed.panelTop < viewport.height &&
      placed.panelBottom > placed.panelTop,
    JSON.stringify(placed),
  );
  await page.screenshot({ path: shot('list-filters-pinned') });
  await axeCheck(page, `${label}, List view scrolled with the filters open`);
  await page.locator('ss-list-view-page .filters-toggle').click();
  await filters.waitFor({ state: 'detached' });

  // On a phone, Sort is its icon, and View optimizations its icon and count: centred in their buttons (M6.18).
  if (viewport.width < 600) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const gaps = await page.evaluate(() => {
      const box = (element) => element.getBoundingClientRect();
      const sort = document.querySelector('ss-list-view-page .filters-toggle');
      const sortIcon = box(sort.querySelector('mat-icon'));
      const link = document.querySelector('ss-list-view-page .optimize a');
      const linkIcon = box(link.querySelector('mat-icon'));
      const label = box(link.querySelector('.mdc-button__label'));
      // With a count, the icon and the count together; with none, the icon alone.
      const right = label.width > 1 ? label.right : linkIcon.right;
      return {
        sort: Math.abs(sortIcon.left - box(sort).left - (box(sort).right - sortIcon.right)),
        optimize: Math.abs(linkIcon.left - box(link).left - (box(link).right - right)),
      };
    });
    check(
      `${label}: Sort's icon and View optimizations' icon and count are centred in their buttons (M6.18)`,
      gaps.sort <= 1.5 && gaps.optimize <= 1.5,
      JSON.stringify(gaps),
    );
  }

  // The item dialog says the same (M6.19): Auto-renews until it ends, and Ends on's hint that it stops then.
  await page.goto(`${baseUrl}lists/${FAMILY}/edit`);
  await page.locator('ss-list-edit-page li.item').first().waitFor({ timeout: 20000 });
  await page.locator('ss-list-edit-page h1').click();
  await keyTo(page, labelled('Edit Netflix Standard'));
  await page.keyboard.press('Enter');
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor();
  await sleep(400);
  const renews = await text(dialog.locator('mat-checkbox', { hasText: 'Auto-renews' }));
  const hint = await text(
    dialog.locator('mat-form-field', { hasText: 'Ends on' }).locator('mat-hint'),
  );
  check(
    `${label}: the item dialog says "Auto-renews until it ends" and "It stops then: no renewal after" (M6.19)`,
    renews === 'Auto-renews until it ends' && hint === 'It stops then: no renewal after',
    `${renews} / ${hint}`,
  );
  await axeCheck(page, `${label}, the item dialog with an end date`);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  // Cancel, with nothing changed, leaves without asking.
  await page.locator('ss-list-edit-page h1').click();
  await keyTo(page, named('Cancel'));
  await page.keyboard.press('Enter');
  await until('the editor gone', async () => !page.url().includes('/edit'));
}

// ── M8.5: an extra member ───────────────────────────────────────────────────────────────────────────────────────

async function checkExtraMember(page, label, viewport, shot) {
  await openOptimizations(page, FAMILY);
  // Its title may share a card with another change of the same item.
  await page.locator('ss-optimizations-page h1').click();
  await keyTo(
    page,
    () =>
      /^Apply: .*an extra member on Disney\+ Premium/.test(
        document.activeElement?.getAttribute('aria-label') ?? '',
      ),
    'Tab',
    250,
  );
  const title = (
    await page.evaluate(() => document.activeElement.getAttribute('aria-label'))
  ).replace(/^Apply: /, '');
  await page.keyboard.press('Enter');
  await page.locator('ss-optimizations-page .unsaved a.review').waitFor({ timeout: 15000 });
  await until(
    'the suggestions worked out again',
    async () =>
      !(await page.locator('ss-optimizations-page').textContent()).includes(
        'Updating the suggestions',
      ),
    30000,
  );
  await openReview(page, FAMILY);
  const lines = await reviewLines(page);
  // The member is whichever the optimizer chose: it ends when what's paid for runs out, and joins its host then.
  const ending = lines
    .map((line) =>
      /^− \| Disney\+ Premium \| \$16\.99 a month \| Ends (\w{3} \d+, \d{4}), when what's paid for runs out$/.exec(
        line,
      ),
    )
    .find(Boolean);
  const joins = ending && day(new Date(`${ending[1]} 12:00 UTC`).toISOString().slice(0, 10));
  check(
    `${label}: Review changes ends one Disney+ Premium when it's paid for, and adds its extra member to the other from then (M8.5)`,
    joins !== undefined &&
      lines.some(
        (line) =>
          line.startsWith('~ | Disney+ Premium | ') &&
          line.includes(`Adds extra member (premium) from ${joins}`),
      ),
    `${title}: ${lines.join(' / ')}`,
  );
  await noSideScroll(page, viewport, `${label}, Review changes with an extra member`);
  await axeCheck(page, `${label}, Review changes with an extra member`);
  await saveReview(page, FAMILY);
  const items = await readTable(page, 'items');
  const member = items.find(
    (item) => [DISNEY_A, DISNEY_B].includes(item.id) && item.billing.endDate !== undefined,
  );
  const host = items.find((item) => [DISNEY_A, DISNEY_B].includes(item.id) && item !== member);
  const since = member?.billing.endDate;
  check(
    `${label}: saved: the member ends on its next charge, and its host's extra member joins that day`,
    since !== undefined &&
      host?.source.addOns?.some(
        (addOn) => addOn.id === 'disney-plus.extra-member-premium' && addOn.since === since,
      ) === true,
    JSON.stringify(host?.source),
  );
  await until('the badges', async () => (await badges(page))[member?.id]?.includes('Extra member'));
  const shown = await badges(page);
  const hostCard = await text(page.locator(`li[data-item="${host?.id}"] ss-item-card`));
  check(
    `${label}: List view says it becomes an extra member, and when it joins its host (M7.11)`,
    shown[member?.id] === `Active Extra member on Disney+ Premium from ${day(since)}` &&
      hostCard.includes(`joins ${day(since)}`),
    `${shown[member?.id]} / ${hostCard.slice(0, 200)}`,
  );
  await page.screenshot({ path: shot('list-extra-member'), fullPage: true });
}

// ── M5.13: every reseller ──────────────────────────────────────────────────────────────────────────────────────

async function dealsOf(page) {
  await page.goto(`${baseUrl}search?q=mullvad`);
  const mullvad = page.locator('ss-sub-card', {
    has: page.getByRole('heading', { name: 'Mullvad VPN', exact: true }),
  });
  await mullvad.locator('.deals li').first().waitFor({ timeout: 20000 });
  await sleep(300);
  return mullvad
    .locator('.deals li')
    .evaluateAll((items) => items.map((item) => item.querySelector('.cheaper').textContent.trim()));
}

async function checkResellers(page, label, viewport, shot) {
  const before = await dealsOf(page);
  await page.goto(`${baseUrl}settings`);
  await page.locator('ss-settings-page h3', { hasText: 'Search' }).waitFor({ timeout: 20000 });
  await page.locator('ss-settings-page h1').click();
  await keyTo(
    page,
    () =>
      document.activeElement?.closest('mat-checkbox')?.textContent.trim() ===
      "Show every reseller, even when it isn't cheaper",
  );
  await page.keyboard.press('Space');
  await until(
    'the setting saved',
    async () => (await readTable(page, 'settings'))[0]?.searchAllResellers === true,
  );
  check(`${label}: Settings' "Show every reseller" is ticked by Space and saved (M5.13)`, true);
  await axeCheck(page, `${label}, Settings with every reseller shown`);
  const after = await dealsOf(page);
  check(
    `${label}: Search then lists Mullvad's resellers that aren't cheaper too, as "Also at"`,
    before.every((word) => word === 'Cheaper at') &&
      after.length > before.length &&
      after.filter((word) => word === 'Cheaper at').length === before.length &&
      after.includes('Also at'),
    `${before.join(', ')} → ${after.join(', ')}`,
  );
  await noSideScroll(page, viewport, `${label}, Search with every reseller`);
  await page
    .locator('ss-sub-card', {
      has: page.getByRole('heading', { name: 'Mullvad VPN', exact: true }),
    })
    .locator('.deals')
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot('search-every-reseller') });
  await axeCheck(page, `${label}, Search with every reseller`);
}

// ── M9.6: another currency, for a buyer in the US ──────────────────────────────────────────────────────────────

async function checkCurrency(browser, colorScheme, viewport) {
  const label = `${colorScheme} ${viewport.width} (US)`;
  const shot = (name) => path.join(outDir, `${name}-${colorScheme}-${viewport.width}.png`);
  const { context, page } = await newPage(browser, label, { colorScheme, viewport });
  try {
    await firstRun(page);
    const { next12 } = dates();
    const [settings] = await readTable(page, 'settings');
    await putRecord(page, 'settings', {
      ...settings,
      country: 'US',
      subdivision: 'US-NY',
      currency: 'USD',
    });
    await putRecord(page, 'cards', {
      id: NO_FX,
      name: 'No FX Visa',
      type: 'credit',
      network: 'visa',
      currency: 'USD',
      cashbackPercent: 1,
      fxFeePercent: 0,
      ...stamps,
    });
    await putRecord(page, 'lists', { id: PRIVACY, name: 'Privacy', ...stamps });
    // Billed yearly already, so annual billing isn't a free change before it.
    await putItem(
      page,
      PROTON,
      PRIVACY,
      'proton.unlimited',
      { ...monthly(next12), interval: 'year' },
      {
        cardId: NO_FX,
      },
    );
    await openOptimizations(page, PRIVACY);
    const free = page.locator('ss-optimizations-page ss-suggestion-card', {
      hasText: 'Pay for Proton Unlimited in CAD',
    });
    await free.waitFor({ timeout: 20000 });
    const when = await text(free.locator('.when'));
    check(
      `${label}: a free saving: pay for Proton Unlimited in CAD, from its next charge, with the card it's paid with (M9.6)`,
      when === `From ${date(next12)}, paid with No FX Visa` &&
        (await text(free)).includes('Estimated'),
      when,
    );
    await noSideScroll(page, viewport, `${label}, Optimizations with another currency`);
    await free.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot('optimizations-currency') });
    await axeCheck(page, `${label}, Optimizations with another currency`);
    await applyCard(page, 'Pay for Proton Unlimited in CAD');
    await openReview(page, PRIVACY);
    const lines = await reviewLines(page);
    check(
      `${label}: Review changes says it's paid in CAD from the next charge, at Proton's CAD price`,
      lines.includes(
        `~ | Proton Unlimited | US$119.88 a year | Paid in CAD from ${date(next12)}: CA$149.88 a year + tax`,
      ) ||
        lines.some(
          (line) =>
            line.startsWith('~ | Proton Unlimited | ') &&
            line.endsWith(`Paid in CAD from ${date(next12)}: CA$149.88 a year + tax`),
        ),
      lines.join(' / '),
    );
    await axeCheck(page, `${label}, Review changes with another currency`);
    await saveReview(page, PRIVACY);
    const proton = (await readTable(page, 'items')).find((item) => item.id === PROTON);
    check(
      `${label}: saved as the user's own price in CAD from the next charge, plus tax`,
      JSON.stringify(proton?.priceOverride) ===
        JSON.stringify({ amount: 149.88, currency: 'CAD', since: next12, plusTax: true }),
      JSON.stringify(proton?.priceOverride),
    );
  } catch (error) {
    check(`${label}: another currency ran to the end`, false, error.message.split('\n')[0]);
    await page.screenshot({ path: shot('failed-currency') }).catch(() => {});
  }
  await context.close();
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
        ['the bundle', checkBundle],
        ['the extra member', checkExtraMember],
        ['every reseller', checkResellers],
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
      await checkCurrency(browser, colorScheme, viewport);
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

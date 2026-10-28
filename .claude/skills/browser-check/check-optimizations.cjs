// M8.2 in the system Edge: Optimizations (P14) and List view's View optimizations (P4) on `ng serve`, for a Canadian in
// Alberta, on the real catalog. It writes to IndexedDB Family: Netflix Standard twice (Mine and Sam's), Disney+
// Premium monthly, Mullvad VPN and Proton VPN Plus, with VPN ranked Needed.
//
// In both themes at 1280 and 360 px, keyboard only, it checks:
// - List view's View optimizations: its count, the strongest's colour and its name, Enter opening the page;
// - the page: the back button by the list's name, Save up to, the sections in P14's order (Free savings, Recommended,
//   Suggested, Worth a look), each card's changes, saving, Apply and Dismiss, and the rules' tooltip on Tab;
// - Dismiss by Enter: the card gone, focus on the next card's heading, the snackbar; Show dismissed by Space bringing it
//   back with Show again; a reload keeping it dismissed; List view's count one less;
// - Apply by Enter: the editor, the change on the list's draft in IndexedDB, the saved items unchanged.
// Then light at 1280 px: a list of 14 items, which the Web Worker optimizes.
// With axe on the page, the tooltip, the snackbar and List view, no horizontal scroll, and screenshots.
// Usage: node check-optimizations.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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
  // Under `wrangler dev` the production CSP applies, Trusted Types included: a violation fails the console check.
  await context.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (event) =>
      console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`),
    ),
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
  // Material renders tooltips and snackbars outside the page's landmarks (the skill's gotchas).
  const violations = result.violations.filter(
    (violation) =>
      violation.id !== 'region' ||
      !violation.nodes.every((node) => node.target.join(' ').includes('cdk-')),
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
  const focused = await page.evaluate(
    () => document.activeElement !== null && document.activeElement !== document.body,
  );
  if (!focused) return '';
  const snapshot = await page.locator(':focus').ariaSnapshot();
  return snapshot.split('\n')[0].replace(/^- /, '');
}

/**
 * The focused element's role and name. A snapshot line whose name has a colon is single-quoted, with its own quotes
 * doubled; a link's ends in a colon before its URL.
 */
async function focused(page) {
  let line = (await stop(page)).trim();
  if (line.startsWith("'")) line = line.slice(1, line.lastIndexOf("'")).replace(/''/g, "'");
  const match = /^(\w+) "((?:[^"\\]|\\.)*)"/.exec(line);
  return match ? { role: match[1], name: match[2] } : { role: '', name: '' };
}

/** Presses Tab until the focused element has `role` and a name that `pattern` matches; returns the name. */
async function tabTo(page, role, pattern, limit = 200) {
  for (let presses = 0; presses < limit; presses++) {
    const found = await focused(page);
    if (found.role === role && pattern.test(found.name)) return found.name;
    await page.keyboard.press('Tab');
    await sleep(30);
  }
  throw new Error(`Couldn't reach ${role} ${pattern} (focus on ${await stop(page)})`);
}

async function noSideScroll(page, viewport, label) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`no horizontal scroll: ${label}`, width <= viewport.width, `${width}px`);
}

const LIST = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const BIG = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4f';
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };
const id = (n) => `0192f1c5-1c2d-7e3f-8a4b-${String(n).padStart(12, '0')}`;
const monthly = (anchorDate, autoRenew = true) => ({
  mode: 'recurring',
  interval: 'month',
  intervalCount: 1,
  anchorDate,
  autoRenew,
});
const item = (n, listId, planId, billing, extra = {}) => ({
  id: id(n),
  listId,
  source: { kind: 'catalog', planId },
  billing,
  tagIds: [],
  rankOverrides: {},
  pinned: false,
  ...stamps,
  ...extra,
});
const family = [
  item(1, LIST, 'netflix.standard', monthly('2026-11-12'), { nickname: 'Mine' }),
  item(2, LIST, 'netflix.standard', monthly('2026-11-20'), { nickname: "Sam's" }),
  item(3, LIST, 'disney-plus.premium', monthly('2026-11-15')),
  item(4, LIST, 'mullvad.vpn', monthly('2026-11-21', false)),
  item(5, LIST, 'proton.vpn-plus', monthly('2026-11-08')),
];

async function plant(page) {
  await putRecord(page, 'lists', { id: LIST, name: 'Family', ...stamps });
  await putRecord(page, 'rankings', { rankKey: 'vpn.included', rank: 'needed', ...stamps });
  for (const record of family) await putRecord(page, 'items', record);
}

async function plantBig(page) {
  await putRecord(page, 'lists', { id: BIG, name: 'Everyone', ...stamps });
  const plans = [
    'netflix.premium',
    'netflix.standard',
    'netflix.standard',
    'netflix.standard-ads',
    'disney-plus.premium',
    'disney-plus.standard',
    'crave.premium',
    'crave.standard-ads',
    'proton.mail-plus',
    'proton.vpn-plus',
    'proton.pass-plus',
    'proton.drive-plus',
    'mullvad.vpn',
    'disney-plus.premium',
  ];
  for (const [index, planId] of plans.entries()) {
    const day = String(index + 2).padStart(2, '0');
    await putRecord(page, 'items', item(100 + index, BIG, planId, monthly(`2026-11-${day}`)));
  }
}

const optimize = (page) => page.locator('ss-optimizations-page');
/** Each section's heading ("# Free savings") and its cards' changes and savings. */
const layout = (page) =>
  optimize(page)
    .locator('.section h2, ss-suggestion-card')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const text = (node) => node?.textContent.replace(/\s+/g, ' ').trim() ?? '';
        if (element.matches('h2')) return `# ${text(element)}`;
        const copy = element.querySelector('.savings').cloneNode(true);
        copy.querySelectorAll('.visually-hidden, mat-icon').forEach((hidden) => hidden.remove());
        const changes = [...element.querySelectorAll('.title .change')].map(text).join(' + ');
        return `${element.dataset.severity} | ${changes} | ${text(copy)}`;
      }),
    );
const cardCount = async (page) => optimize(page).locator('ss-suggestion-card').count();
const linkText = async (page) =>
  (await page.locator('ss-optimizations-link a').ariaSnapshot()).split('\n')[0];

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  let printed = false;

  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [WIDE, NARROW]) {
      const label = `${colorScheme} ${viewport.width}`;
      const shot = (name) => path.join(outDir, `${name}-${colorScheme}-${viewport.width}.png`);
      const { context, page } = await newPage(browser, label, { colorScheme, viewport });
      await firstRun(page);
      await plant(page);

      // ── List view's View optimizations ─────────────────────────────────────────────────────────
      await page.goto(`${baseUrl}lists/${LIST}`);
      const link = page.locator('ss-optimizations-link a');
      await until('the count', async () => /View optimizations \(\d+\)/.test(await linkText(page)));
      const before = Number(/\((\d+)\)/.exec(await linkText(page))[1]);
      const strongest = await link.getAttribute('data-strongest');
      check(
        `${label}: List view's View optimizations has a count and is coloured by the strongest, which it names`,
        before > 0 &&
          ['red', 'orange', 'yellow', 'free'].includes(strongest) &&
          /the strongest: (Recommended|Suggested|Worth a look|Free savings)/.test(
            await linkText(page),
          ),
        `${await linkText(page)} [${strongest}]`,
      );
      await axeCheck(page, `${label} List view with View optimizations`);
      await link.scrollIntoViewIfNeeded();
      await page.screenshot({ path: shot('list-view-link') });
      await page.locator('h1').click();
      await tabTo(page, 'link', /^View optimizations \(\d+\), the strongest: /);
      await page.keyboard.press('Enter');
      await until('the page', async () => new URL(page.url()).pathname.endsWith('/optimize'));

      // ── The page ──────────────────────────────────────────────────────────────────────────────
      await until('the cards', async () => (await cardCount(page)) > 0, 20000);
      const cards = await layout(page);
      if (!printed) {
        console.log(`      ${cards.join('\n      ')}`);
        printed = true;
      }
      const order = cards
        .filter((entry) => entry.startsWith('# '))
        .map((heading) => heading.slice(2).split(' — ')[0]);
      const sectionOrder = ['Free savings', 'Recommended', 'Suggested', 'Worth a look'];
      check(
        `${label}: the sections come in P14's order, each card with its saving over the next 12 months`,
        order.length > 0 &&
          order.every(
            (heading, index) =>
              index === 0 || sectionOrder.indexOf(heading) > sectionOrder.indexOf(order[index - 1]),
          ) &&
          cards
            .filter((entry) => !entry.startsWith('# '))
            .every((entry) => / \| Save (≈ )?\$[\d,]+\.\d\d over the next 12 months/.test(entry)),
        order.join(', '),
      );
      check(
        `${label}: as many cards as List view counted`,
        (await cardCount(page)) === before,
        `${await cardCount(page)} cards, ${before} counted`,
      );
      // Each account is someone's: the other one never counts as covering it. A removal needs another provider's
      // overlap (Disney+ gives 1080p too), which only Worth a look offers.
      check(
        `${label}: two Netflix accounts give an extra member in Free savings, and a removal only in Worth a look`,
        cards.some(
          (entry) =>
            entry.startsWith('free | ') &&
            (entry.includes(
              "Make Sam's (Netflix Standard) an extra member on Mine (Netflix Standard)",
            ) ||
              entry.includes(
                "Make Mine (Netflix Standard) an extra member on Sam's (Netflix Standard)",
              )),
        ) &&
          cards
            .filter((entry) => /Remove (Mine|Sam's)/.test(entry))
            .every((entry) => entry.startsWith('yellow | ')),
      );
      // As it shows: the words for screen readers left out.
      const save = await optimize(page)
        .locator('.save-up-to')
        .evaluate((line) => {
          const copy = line.cloneNode(true);
          copy.querySelectorAll('.visually-hidden').forEach((hidden) => hidden.remove());
          return copy.textContent.replace(/\s+/g, ' ').trim();
        });
      check(
        `${label}: the header says Save up to`,
        /^Save up to (≈ )?\$[\d,]+\.\d\d a year$/.test(save),
        save,
      );
      check(
        `${label}: the back button goes to the list by its name`,
        (await optimize(page).locator('.back').getAttribute('href')) === `/lists/${LIST}` &&
          (await optimize(page).locator('.back').textContent()).includes('Family'),
      );
      await noSideScroll(page, viewport, `${label} page`);
      await axeCheck(page, `${label} page`);
      await page.screenshot({ path: shot('optimizations'), fullPage: true });

      // Keyboard: the back button first, then the rules' tooltip, then the first card's buttons.
      await optimize(page).locator('h1').click();
      await page.keyboard.press('Tab');
      const back = await focused(page);
      check(
        `${label}: the back button is the first stop`,
        back.role === 'link' && back.name === 'Family',
        `${back.role} ${back.name}`,
      );
      await tabTo(page, 'button', /^How suggestions are chosen$/);
      const tooltip = page.locator('.mat-mdc-tooltip-show');
      await tooltip.waitFor({ timeout: 5000 });
      check(
        `${label}: the rules' tooltip opens on Tab and explains Needed, Essential and Critical`,
        /Needed.*Essential.*Critical/.test(await tooltip.textContent()),
      );
      await axeCheck(page, `${label} with the rules' tooltip`);
      await page.screenshot({ path: shot('optimizations-tooltip') });
      const firstApply = await tabTo(page, 'button', /^Apply: /);
      await page.keyboard.press('Tab');
      const following = await focused(page);
      check(
        `${label}: Dismiss follows Apply, named for the same changes`,
        following.role === 'button' &&
          following.name === firstApply.replace('Apply: ', 'Dismiss: '),
        following.name,
      );

      // ── Dismiss, Show dismissed, a reload ─────────────────────────────────────────────────────
      const count = await cardCount(page);
      const dismissedTitle = firstApply.replace(/^Apply: /, '');
      await page.keyboard.press('Enter');
      await until('one card fewer', async () => (await cardCount(page)) === count - 1);
      await until('focus on a heading', async () =>
        page.evaluate(() => document.activeElement?.classList.contains('title')),
      );
      check(`${label}: Dismiss hides the card and puts focus on the next card's heading`, true);
      const snack = page.locator('.mat-mdc-snack-bar-label').first();
      await snack.waitFor();
      check(
        `${label}: the snackbar says so, with Undo`,
        (await snack.textContent()).includes('Dismissed until the list changes'),
      );
      await sleep(400);
      await axeCheck(page, `${label} with the snackbar`);
      await tabTo(page, 'checkbox', /^Show dismissed \(1\)$/);
      await page.keyboard.press('Space');
      await until('the dismissed card back', async () => (await cardCount(page)) === count);
      check(
        `${label}: Show dismissed brings it back with Show again`,
        (await optimize(page)
          .getByRole('button', { name: `Show again: ${dismissedTitle}` })
          .count()) === 1,
      );
      await page.keyboard.press('Space');
      await until('hidden again', async () => (await cardCount(page)) === count - 1);
      await page.reload();
      await until('the cards after a reload', async () => (await cardCount(page)) > 0, 20000);
      check(
        `${label}: a reload keeps it dismissed`,
        (await cardCount(page)) === count - 1 &&
          (await readTable(page, 'dismissedSuggestions')).length === 1,
      );
      await page.goto(`${baseUrl}lists/${LIST}`);
      await until('List view one fewer', async () =>
        (await linkText(page)).includes(`(${before - 1})`),
      );
      check(`${label}: List view counts one fewer`, true);
      await page.goBack();
      await until('the cards again', async () => (await cardCount(page)) === count - 1, 20000);

      // ── Apply ─────────────────────────────────────────────────────────────────────────────────
      const itemsBefore = JSON.stringify(await readTable(page, 'items'));
      await optimize(page).locator('h1').click();
      const applied = (await tabTo(page, 'button', /^Apply: /)).replace(/^Apply: /, '');
      await page.keyboard.press('Enter');
      await until('the editor', async () =>
        /\/lists\/[^/]+\/edit$/.test(new URL(page.url()).pathname),
      );
      await page.locator('ss-list-edit-page').waitFor();
      const drafts = await readTable(page, 'drafts');
      const draft = drafts.find((entry) => entry.listId === LIST);
      const changed = draft?.items.filter(
        (entry) =>
          entry.removed ||
          !entry.saved ||
          JSON.stringify(entry.item) !== JSON.stringify(entry.saved),
      );
      check(
        `${label}: Apply opens the editor with "${applied}" on the list's draft`,
        changed !== undefined && changed.length > 0,
        `${changed?.length ?? 0} items changed in the draft`,
      );
      check(
        `${label}: nothing is saved until Save`,
        JSON.stringify(await readTable(page, 'items')) === itemsBefore,
      );
      await noSideScroll(page, viewport, `${label} editor after Apply`);
      await page.screenshot({ path: shot('after-apply') });
      await context.close();
    }
  }

  // ── A big list, in the Web Worker ──────────────────────────────────────────────────────────────
  {
    const { context, page } = await newPage(browser, 'worker');
    const workers = [];
    page.on('worker', (worker) => workers.push(worker.url()));
    await firstRun(page);
    await plantBig(page);
    await page.goto(`${baseUrl}lists/${BIG}/optimize`);
    await until('the big list’s cards', async () => (await cardCount(page)) > 0, 30000);
    check(
      'worker: a list of 14 items is optimized in the Web Worker',
      // The dev server adds a query to it.
      workers.some((url) => /^\/worker-[A-Z0-9]{8}\.js$/.test(new URL(url).pathname)),
      workers.join(', '),
    );
    console.log(`      ${(await layout(page)).join('\n      ')}`);
    await context.close();
  }

  await browser.close();
  if (consoleProblems.length > 0) {
    console.log('Console problems:');
    for (const problem of consoleProblems) console.log(`  ${problem}`);
  }
  check('no console errors or warnings', consoleProblems.length === 0);
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  if (consoleProblems.length > 0) console.error(consoleProblems.join('\n'));
  process.exit(1);
});

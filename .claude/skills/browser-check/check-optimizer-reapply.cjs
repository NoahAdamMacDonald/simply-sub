// The feedback after M10 in the system Edge: Optimizations' cards applied one after another, saved, and applied again
// (P14, M8.4–M8.6), for a Canadian in Alberta on the real catalog, on `ng serve`.
// 1. Two Netflix Standards added today, with a card that pays better (the report's steps): every free saving applied,
//    then Review changes, the editor's Save, and Optimizations again. One account becomes an extra member on the other
//    from its next charge, and no card ever makes the other an extra member on the one that ends; Upcoming still has
//    the host's next charge.
// 2. In the editor, the extra member taken off its host in the item dialog: the snackbar says the other account no
//    longer ends, and its end date is gone from the draft, and after Save from the list.
// Both in light and dark at 1280 and 360 px, keyboard only, with axe and no horizontal scroll on Optimizations, List
// view and the editor with its snackbar.
// 3. Light at 1280 px: a list of 14 items whose cards are clicked as soon as they can be, saved, and at once applied
//    again and saved: no console error, no account an extra member on one that ends, and every extra member's host
//    goes on.
// Usage: node check-optimizer-reapply.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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
  const context = await browser.newContext({
    locale: 'en-CA',
    colorScheme,
    viewport,
    serviceWorkers: 'block',
  });
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
    const blockedWorker = msg.text() === 'Service Worker registration blocked by Playwright';
    if ((msg.type() === 'error' || msg.type() === 'warning') && !blockedWorker) {
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
async function focused(page) {
  const any = await page.evaluate(
    () => document.activeElement !== null && document.activeElement !== document.body,
  );
  if (!any) return { role: '', name: '' };
  let line = (await page.locator(':focus').ariaSnapshot()).split('\n')[0].replace(/^- /, '').trim();
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
  throw new Error(
    `Couldn't reach ${role} ${pattern} (focus on ${JSON.stringify(await focused(page))})`,
  );
}

async function noSideScroll(page, viewport, label) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`no horizontal scroll: ${label}`, width <= viewport.width, `${width}px`);
}

const LIST = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const BIG = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4f';
const CARD = '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d3e';
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };
const id = (n) => `0192f1c5-1c2d-7e3f-8a4b-${String(n).padStart(12, '0')}`;
const monthly = (anchorDate) => ({
  mode: 'recurring',
  interval: 'month',
  intervalCount: 1,
  anchorDate,
  autoRenew: true,
});
const item = (n, listId, planId, billing) => ({
  id: id(n),
  listId,
  source: { kind: 'catalog', planId },
  billing,
  tagIds: [],
  rankOverrides: {},
  pinned: false,
  ...stamps,
});

const optimize = (page) => page.locator('ss-optimizations-page');
const applyNames = (page) =>
  optimize(page)
    .locator('ss-suggestion-card button[aria-label^="Apply: "]')
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label').replace(/^Apply: /, '')),
    );
const severities = (page) =>
  optimize(page)
    .locator('ss-suggestion-card')
    .evaluateAll((cards) => cards.map((card) => card.dataset.severity));

/** Waits for the cards: worked out, and none being applied. */
async function settled(page) {
  await until(
    'the cards',
    async () => {
      const note = (await optimize(page).locator('p.note[role=status]').textContent()).trim();
      if (note === 'Looking for savings…' || note === 'Updating the suggestions…') return false;
      return (
        (await optimize(page)
          .locator('ss-suggestion-card button[aria-label^="Apply: "]:disabled')
          .count()) === 0
      );
    },
    30000,
  );
}

/** How many suggestions the list's draft has applied. */
async function appliedCount(page, listId) {
  const draft = (await readTable(page, 'drafts')).find((entry) => entry.listId === listId);
  return draft?.applied?.length ?? 0;
}

/** Applies the first card, by keyboard or with a click, and waits for the cards to come again. */
async function applyFirst(page, listId, { keyboard = true } = {}) {
  await settled(page);
  const names = await applyNames(page);
  if (names.length === 0) return undefined;
  const count = await appliedCount(page, listId);
  if (keyboard) {
    await optimize(page).locator('h1').focus();
    await tabTo(page, 'button', /^Apply: /);
    await page.keyboard.press('Enter');
  } else {
    await optimize(page)
      .locator('ss-suggestion-card button[aria-label^="Apply: "]')
      .first()
      .click();
  }
  await until('the Apply', async () => (await appliedCount(page, listId)) === count + 1, 20000);
  await settled(page);
  return names[0];
}

/** Optimizations' Review changes, then Open in the editor, then Save, by keyboard; back on List view. */
async function reviewAndSave(page, listId) {
  await optimize(page).locator('h1').focus();
  await tabTo(page, 'link', /^Review changes$/);
  await page.keyboard.press('Enter');
  const review = page.locator('ss-review-changes-page');
  await review.locator('li.change').first().waitFor({ timeout: 20000 });
  await tabTo(page, 'link', /^Open in the editor$/);
  await page.keyboard.press('Enter');
  await page.locator('ss-list-edit-page li.item').first().waitFor({ timeout: 20000 });
  await save(page, listId);
}

/** The editor's Save, by keyboard, then List view. */
async function save(page, listId) {
  await page.locator('ss-list-edit-page h1').focus();
  await tabTo(page, 'button', /^Save$/);
  await page.keyboard.press('Enter');
  await until('List view', () => new URL(page.url()).pathname === `/lists/${listId}`, 20000);
  await page.locator('ss-item-card').first().waitFor({ timeout: 20000 });
}

/**
 * What's wrong with the list's extra members: an account that ends hosting one, or an extra member whose host ends,
 * or a host whose extra member joins on a day no account of its provider ends.
 */
function memberProblems(items) {
  const problems = [];
  const live = items.filter((entry) => entry.deletedAt === undefined);
  const provider = (entry) => entry.source.planId?.split('.')[0];
  for (const host of live) {
    for (const addOn of host.source.addOns ?? []) {
      if (addOn.since === undefined) continue;
      if (host.billing.endDate !== undefined) {
        problems.push(`${host.id} ends on ${host.billing.endDate} and hosts an extra member`);
      }
      const joiner = live.find(
        (entry) =>
          entry !== host &&
          provider(entry) === provider(host) &&
          entry.billing.endDate === addOn.since,
      );
      if (!joiner) problems.push(`${host.id}'s extra member from ${addOn.since} replaces nobody`);
    }
  }
  return problems;
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
      // Added today from the catalog, as the report's steps do, with a card that pays more back than none.
      const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
      await putRecord(page, 'lists', { id: LIST, name: 'Subscription List', ...stamps });
      await putRecord(page, 'items', item(1, LIST, 'netflix.standard', monthly(today)));
      await putRecord(page, 'items', item(2, LIST, 'netflix.standard', monthly(today)));
      await putRecord(page, 'cards', {
        id: CARD,
        name: 'Cash Back Visa',
        type: 'credit',
        network: 'visa',
        currency: 'CAD',
        cashbackPercent: 2,
        fxFeePercent: 2.5,
        ...stamps,
      });

      // ── 1. Every free saving, then Save, then Optimizations again ─────────────────────────────
      await page.goto(`${baseUrl}lists/${LIST}/optimize`);
      await settled(page);
      const first = await applyNames(page);
      console.log(`${label}: the cards: ${first.join(' | ')}`);
      check(
        `${label}: the first card makes one Netflix Standard an extra member on the other`,
        /an extra member on/.test(first[0] ?? ''),
        first[0],
      );
      await axeCheck(page, `${label} Optimizations`);
      await noSideScroll(page, viewport, `${label} Optimizations`);
      const applied = [];
      while ((await severities(page))[0] === 'free') {
        applied.push(await applyFirst(page, LIST));
      }
      const after = await applyNames(page);
      console.log(`${label}: applied ${applied.join(' | ')}; left ${after.join(' | ') || 'none'}`);
      check(
        `${label}: no card makes an account an extra member once one is (the report's step 10)`,
        after.every((name) => !/extra member/.test(name)),
        after.join(' | '),
      );
      await page.screenshot({ path: shot('reapply-after-free'), fullPage: true });
      await reviewAndSave(page, LIST);

      const statuses = await page
        .locator('ss-item-card ss-status-badge')
        .evaluateAll((badges) =>
          badges.map((badge) => badge.textContent.replace(/\s+/g, ' ').trim()),
        );
      // Each badge starts with the words only screen readers get: "Active", "Inactive".
      check(
        `${label}: List view says one account becomes an extra member on the other, which renews`,
        statuses.filter((text) => /Extra member on Netflix Standard from /.test(text)).length ===
          1 && statuses.filter((text) => /Auto-renews /.test(text)).length === 1,
        statuses.join(' | '),
      );
      await axeCheck(page, `${label} List view`);
      await noSideScroll(page, viewport, `${label} List view`);
      await page.screenshot({ path: shot('reapply-list-view'), fullPage: true });
      const saved = (await readTable(page, 'items')).filter((entry) => entry.listId === LIST);
      check(
        `${label}: one account ends, and the other, which goes on, hosts its extra member`,
        saved.filter((entry) => entry.billing.endDate !== undefined).length === 1 &&
          memberProblems(saved).length === 0,
        memberProblems(saved).join('; '),
      );

      // At once, Optimizations again (the report's steps 15 to 17).
      await page.goto(`${baseUrl}lists/${LIST}/optimize`);
      await settled(page);
      const again = await applyNames(page);
      check(
        `${label}: Optimizations again never makes the host an extra member on the one that ends`,
        again.every((name) => !/extra member/.test(name)),
        again.join(' | ') || 'no cards',
      );
      await page.goto(`${baseUrl}calendar`);
      const upcoming = page.locator('ss-upcoming');
      await upcoming.waitFor({ timeout: 20000 });
      await until('Upcoming', async () => /Netflix/.test(await upcoming.textContent()));
      const host = saved.find((entry) => entry.billing.endDate === undefined);
      const next = new Date(`${host.source.addOns[0].since}T12:00:00`).toLocaleDateString('en-CA', {
        month: 'short',
        day: 'numeric',
      });
      check(
        `${label}: Upcoming has the host's next charge, with its extra member (${next})`,
        (await upcoming.textContent()).includes(next),
      );

      // ── 2. The extra member taken off ─────────────────────────────────────────────────────────
      await page.goto(`${baseUrl}lists/${LIST}/edit`);
      await page.locator('ss-list-edit-page li.item').first().waitFor({ timeout: 20000 });
      await page.locator(`[data-item="${host.id}"] .edit`).focus();
      await page.keyboard.press('Enter');
      const dialog = page.locator('ss-item-dialog');
      await dialog.waitFor({ timeout: 20000 });
      // Not "Extra member (with ads)", the add-on before it.
      await tabTo(page, 'checkbox', /^Extra member$/);
      await page.keyboard.press('Space');
      await tabTo(page, 'button', /^Save$/);
      await page.screenshot({ path: shot('reapply-dialog') });
      await page.keyboard.press('Enter');
      // Two of the same plan in one list: the dialog asks first.
      const confirm = page.locator('ss-confirm-dialog');
      await until(
        'Save',
        async () => (await confirm.count()) > 0 || (await dialog.count()) === 0,
        20000,
      ).catch(async (error) => {
        await page.screenshot({ path: shot('reapply-dialog-stuck') });
        console.error(
          'Extra member:',
          await dialog.getByRole('checkbox', { name: 'Extra member', exact: true }).isChecked(),
          '| errors:',
          await dialog.locator('mat-error, .error').allTextContents(),
          '| console:',
          consoleProblems.join('\n'),
        );
        throw error;
      });
      if ((await confirm.count()) > 0) {
        await tabTo(page, 'button', /^Save anyway$/);
        await page.keyboard.press('Enter');
      }
      await dialog.waitFor({ state: 'detached', timeout: 20000 });
      const snackBar = page.locator('.mat-mdc-snack-bar-container').last();
      await snackBar.waitFor({ timeout: 10000 });
      const said = (await snackBar.locator('ss-snack .mat-mdc-snack-bar-label').textContent())
        .replace(/\s+/g, ' ')
        .trim();
      check(
        `${label}: the snackbar says the other account no longer ends`,
        said === 'Saved Netflix Standard, and the other Netflix Standard no longer ends',
        said,
      );
      await axeCheck(page, `${label} the editor with the snackbar`);
      await noSideScroll(page, viewport, `${label} the editor`);
      await page.screenshot({ path: shot('reapply-released') });
      const draft = (await readTable(page, 'drafts')).find((entry) => entry.listId === LIST);
      check(
        `${label}: neither account ends in the draft, and the host has no extra member`,
        draft.items.every(
          ({ item: entry }) =>
            entry.billing.endDate === undefined && entry.source.addOns === undefined,
        ),
      );
      await save(page, LIST);
      const stored = (await readTable(page, 'items')).filter((entry) => entry.listId === LIST);
      check(
        `${label}: after Save, both accounts go on`,
        stored.every((entry) => entry.billing.endDate === undefined),
      );
      await context.close();
    }
  }

  // ── 3. A long list, applied, saved, and applied again at once ────────────────────────────────
  {
    const label = 'stress';
    const { context, page } = await newPage(browser, label);
    await firstRun(page);
    const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
    await putRecord(page, 'lists', { id: BIG, name: 'Everyone', ...stamps });
    const plans = [
      'netflix.premium',
      'netflix.standard',
      'netflix.standard',
      'netflix.standard',
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
      // Some today, the rest on the days after.
      const day = new Date(`${today}T12:00:00`);
      day.setDate(day.getDate() + (index % 4) * 3);
      await putRecord(
        page,
        'items',
        item(100 + index, BIG, planId, monthly(day.toLocaleDateString('en-CA'))),
      );
    }
    const titles = [];
    // Six first, so the second round has some left to apply once it's saved.
    for (const [round, most] of [6, 20].entries()) {
      await page.goto(`${baseUrl}lists/${BIG}/optimize`);
      const before = titles.length;
      for (let applies = 0; applies < most; applies++) {
        const title = await applyFirst(page, BIG, { keyboard: false });
        if (title === undefined) break;
        titles.push(title);
      }
      console.log(`${label}: round ${round + 1} applied ${titles.slice(before).join(' | ')}`);
      const draft = (await readTable(page, 'drafts')).find((entry) => entry.listId === BIG);
      check(`${label}: round ${round + 1} had cards to apply`, draft !== undefined);
      if (!draft) break;
      check(
        `${label}: round ${round + 1}'s draft has no extra member on an account that ends`,
        memberProblems(draft.items.filter((entry) => !entry.removed).map((entry) => entry.item))
          .length === 0,
        memberProblems(draft.items.map((entry) => entry.item)).join('; '),
      );
      // Saved at once, without waiting for anything more.
      await page.goto(`${baseUrl}lists/${BIG}/edit`);
      await page.locator('ss-list-edit-page li.item').first().waitFor({ timeout: 20000 });
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await until('List view', () => new URL(page.url()).pathname === `/lists/${BIG}`, 20000);
    }
    console.log(`${label}: applied ${titles.length}: ${titles.join(' | ')}`);
    const stored = (await readTable(page, 'items')).filter(
      (entry) => entry.listId === BIG && entry.deletedAt === undefined,
    );
    check(
      `${label}: after two rounds, every extra member's host goes on, and replaces an account that ends`,
      memberProblems(stored).length === 0,
      memberProblems(stored).join('; '),
    );
    check(`${label}: no draft is left`, (await readTable(page, 'drafts')).length === 0);
    await page.screenshot({
      path: path.join(outDir, 'reapply-stress-list-view.png'),
      fullPage: true,
    });
    await context.close();
  }

  check('no console errors or warnings', consoleProblems.length === 0, consoleProblems.join('\n'));
  await browser.close();
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

// M11.6 in the system Edge: ranked perks on the real catalog (data:build's files), for a Canadian in Alberta, with a
// list, Games (Xbox Game Pass Ultimate, PC Game Pass and Premium), written to IndexedDB. Premium ranks Online console
// multiplayer, a perk until M11.9 moved it to gaming.online-multiplayer, so the app moves the rank to the feature (its
// redirect). In both themes at 1280 and 360 px, keyboard only: Ultimate's ✎ → the dialog's rank groups end with Perks,
// closed → Enter opens it, its rows Ultimate's perks in its order → Fortnite Crew Needed and EA Play Wanted by
// typeahead → Save → the draft: both on Ultimate, only EA Play shared to PC Game Pass, which hasn't Fortnite Crew → Save
// the list → the list view's summary names them ("Fortnite Crew: 1 / 1", "EA Play: 2 / 2") → Optimizations suggests
// nothing that drops Ultimate → Search's Ultimate counts them. With axe (the Perks group open, the list view,
// Optimizations), screenshots and no horizontal scroll. GET /fx is answered with fixed rates.
// Usage: node check-m11-perks.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

const LIST = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';
const ULTIMATE = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a1b';
const PREMIUM = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a1c';
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };
const PC = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a1d';
const CREW = 'perk:xbox-game-pass/fortnite-crew';
const EA = 'perk:xbox-game-pass/ea-play';
// A perk until M11.9, which moved it to a feature (data/redirects.yaml).
const ONLINE = 'perk:xbox-game-pass/online-multiplayer';
const MULTIPLAYER = 'gaming.online-multiplayer';

const cadRates = { CHF: 0.581, EUR: 0.6372, GBP: 0.5571, SEK: 7.097, USD: 0.7243 };
function fxBody(base) {
  const perCad = (currency) => (currency === 'CAD' ? 1 : cadRates[currency]);
  const rates = Object.fromEntries(
    ['CAD', ...Object.keys(cadRates)]
      .filter((currency) => currency !== base)
      .map((currency) => [currency, Number((perCad(currency) / perCad(base)).toPrecision(6))]),
  );
  return {
    data: { base, date: '2026-10-26', source: 'European Central Bank via Frankfurter', rates },
    meta: { fetchedAt: '2026-10-26T06:00:02Z', stale: false },
  };
}

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

async function newContext(browser, { colorScheme, viewport }) {
  const context = await browser.newContext({
    locale: 'en-CA',
    colorScheme,
    viewport,
    serviceWorkers: 'block',
  });
  await context.route('**/api/v1/fx?**', (route) =>
    route.fulfill({ json: fxBody(new URL(route.request().url()).searchParams.get('base')) }),
  );
  const page = await context.newPage();
  const label = `${colorScheme} ${viewport.width}`;
  page.on('console', (msg) => {
    const blockedWorker = msg.text() === 'Service Worker registration blocked by Playwright';
    if ((msg.type() === 'error' || msg.type() === 'warning') && !blockedWorker) {
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  return { context, page };
}

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

function idb(page, store, mode, value) {
  return page.evaluate(
    ([table, how, record]) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('simply-sub');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(table, how);
          const objects = transaction.objectStore(table);
          const result = how === 'readwrite' ? objects.put(record) : objects.getAll();
          transaction.oncomplete = () => {
            db.close();
            resolve(how === 'readwrite' ? undefined : result.result);
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    [store, mode, value],
  );
}
const readTable = (page, table) => idb(page, table, 'readonly');
const putRecord = (page, table, record) => idb(page, table, 'readwrite', record);

/** Games: Xbox Game Pass Ultimate, PC Game Pass and Premium, billed monthly; Premium ranks the moved perk. */
async function plantList(page) {
  await putRecord(page, 'lists', { id: LIST, name: 'Games', ...stamps });
  for (const [id, planId, rankOverrides] of [
    [ULTIMATE, 'xbox-game-pass.ultimate', {}],
    [PC, 'xbox-game-pass.pc-game-pass', {}],
    [PREMIUM, 'xbox-game-pass.premium', { [ONLINE]: 'wanted' }],
  ]) {
    await putRecord(page, 'items', {
      id,
      listId: LIST,
      source: { kind: 'catalog', planId },
      billing: {
        mode: 'recurring',
        interval: 'month',
        intervalCount: 1,
        anchorDate: '2026-11-12',
        autoRenew: true,
      },
      tagIds: [],
      rankOverrides,
      pinned: false,
      ...stamps,
    });
  }
}

async function axeCheck(page, label) {
  await sleep(600);
  await page.evaluate(axeSource);
  const result = await page.evaluate(() => axe.run(document));
  const violations = result.violations.filter(
    (violation) =>
      violation.id !== 'region' ||
      !violation.nodes.every((node) => node.target.join(' ').includes('cdk-overlay')),
  );
  check(
    `axe: ${label}`,
    violations.length === 0,
    violations
      .map(
        (v) =>
          `${v.id}: ${v.nodes
            .slice(0, 3)
            .map((n) => n.target.join(' '))
            .join(' | ')}`,
      )
      .join('; '),
  );
}

/** Presses `key` until `isThere` holds in the page, at most `limit` times; how many it took, or -1. */
async function keyTo(page, isThere, key = 'Tab', limit = 120) {
  for (let presses = 0; presses <= limit; presses++) {
    if (await page.evaluate(isThere)) return presses;
    await page.keyboard.press(key);
    await sleep(40);
  }
  return -1;
}

const itemDialog = (page) => page.locator('ss-item-dialog');

/** Whether focus is on the dialog's rank select whose row is named `name` (written into the page's function). */
const onRank = (name) =>
  new Function(
    `const select = document.activeElement?.closest('ss-item-dialog .rank-rows li');
     return !!select && select.querySelector('.rank-name')?.textContent.trim() === ${JSON.stringify(name)};`,
  );

/** The shown value of the rank select named `name`. */
async function rankValue(page, name) {
  return itemDialog(page)
    .locator('.rank-rows li', { has: page.locator('.rank-name', { hasText: name }) })
    .locator('.mat-mdc-select-value-text')
    .first()
    .evaluate((value) => value.textContent.trim())
    .catch(() => '');
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    for (const colorScheme of ['light', 'dark']) {
      for (const viewport of [WIDE, NARROW]) {
        const label = `${colorScheme} ${viewport.width}`;
        const { context, page } = await newContext(browser, { colorScheme, viewport });
        await firstRun(page);
        await plantList(page);

        // ── The dialog: a Perks group, by keyboard ───────────────────────────────────────────────────
        await page.goto(`${baseUrl}lists/${LIST}/edit`);
        await page.locator('li.item').nth(1).waitFor({ timeout: 20000 });
        await page.getByRole('button', { name: 'Edit Xbox Game Pass Ultimate' }).focus();
        await page.keyboard.press('Enter');
        await itemDialog(page).waitFor({ timeout: 20000 });
        await sleep(600);
        const groups = await itemDialog(page)
          .locator('.group-name')
          .evaluateAll((names) => names.map((name) => name.textContent.trim()));
        const toggle = itemDialog(page).locator('.group-toggle', { hasText: 'Perks' });
        check(
          `${label}: the dialog's rank groups end with Perks, closed`,
          groups.at(-1) === 'Perks' && (await toggle.getAttribute('aria-expanded')) === 'false',
          groups.join(', '),
        );
        const toPerks = await keyTo(
          page,
          () =>
            document.activeElement?.querySelector?.('.group-name')?.textContent.trim() === 'Perks',
        );
        await page.keyboard.press('Enter');
        await itemDialog(page)
          .locator('.rank-rows li .rank-name', { hasText: 'Fortnite Crew' })
          .waitFor();
        const rows = await itemDialog(page)
          .locator(`[id$="-group-perks"] .rank-name`)
          .evaluateAll((names) => names.map((name) => name.textContent.trim()));
        check(
          `${label}: Tab and Enter open it, listing Ultimate's perks in its order`,
          toPerks >= 0 &&
            (await toggle.getAttribute('aria-expanded')) === 'true' &&
            rows.join(' | ') === 'EA Play | Fortnite Crew | Ubisoft+ Classics',
          rows.join(' | '),
        );
        await keyTo(page, onRank('Fortnite Crew'));
        await page.keyboard.type('N');
        await sleep(400);
        await keyTo(page, onRank('EA Play'));
        await page.keyboard.type('W');
        await sleep(400);
        check(
          `${label}: typeahead ranks Fortnite Crew Needed and EA Play Wanted`,
          (await rankValue(page, 'Fortnite Crew')) === 'Needed' &&
            (await rankValue(page, 'EA Play')) === 'Wanted',
          `${await rankValue(page, 'Fortnite Crew')} / ${await rankValue(page, 'EA Play')}`,
        );
        await page.screenshot({
          path: path.join(outDir, `dialog-perks-${colorScheme}-${viewport.width}.png`),
        });
        await axeCheck(page, `${label}, the dialog's Perks group open`);
        const dialogWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        check(
          `${label}: nothing scrolls sideways in the dialog`,
          dialogWidth <= viewport.width,
          `${dialogWidth}px`,
        );
        await keyTo(
          page,
          () =>
            !!document.activeElement?.closest('ss-item-dialog') &&
            document.activeElement.textContent?.trim() === 'Save',
        );
        await page.keyboard.press('Enter');
        await itemDialog(page).waitFor({ state: 'detached' });
        await sleep(500);
        const draft = (await readTable(page, 'drafts')).find((entry) => entry.listId === LIST);
        // Ranks as sorted entries: what an item ranks, whatever order they were set in.
        const ranksOf = (id) =>
          JSON.stringify(
            Object.entries(
              draft?.items.find((entry) => entry.item.id === id)?.item.rankOverrides ?? {},
            ).sort(),
          );
        check(
          `${label}: Ultimate keeps both; PC Game Pass gets EA Play, not Fortnite Crew it hasn't`,
          ranksOf(ULTIMATE) ===
            JSON.stringify([
              [EA, 'wanted'],
              [CREW, 'needed'],
            ]) && ranksOf(PC) === JSON.stringify([[EA, 'wanted']]),
          `${ranksOf(ULTIMATE)} / ${ranksOf(PC)}`,
        );
        check(
          `${label}: Premium's rank of Online console multiplayer, a perk until M11.9, is on the feature now`,
          ranksOf(PREMIUM) === JSON.stringify([[MULTIPLAYER, 'wanted']]),
          ranksOf(PREMIUM),
        );

        // ── Save, then the list view's summary ─────────────────────────────────────────────────────────
        await page.locator('.toolbar').getByRole('button', { name: 'Save', exact: true }).click();
        await page.waitForURL(new RegExp(`/lists/${LIST}$`), { timeout: 20000 });
        await page.locator('ss-feature-summary li').first().waitFor({ timeout: 20000 });
        const summary = await page
          .locator('ss-feature-summary li')
          .evaluateAll((rows) =>
            rows.map(
              (row) =>
                `${row.querySelector('.label').textContent.trim()} ${row.querySelector('.count').textContent.trim()}`,
            ),
          );
        check(
          `${label}: the list's summary names the ranked perks, as many items as have them`,
          summary.includes('Fortnite Crew: 1 / 1') && summary.includes('EA Play: 2 / 2'),
          summary.join(' | '),
        );
        await page.screenshot({
          path: path.join(outDir, `list-perks-${colorScheme}-${viewport.width}.png`),
        });
        await axeCheck(page, `${label}, the list view`);

        // ── Optimizations: Ultimate's Needed perk keeps it ─────────────────────────────────────────────
        await page.goto(`${baseUrl}lists/${LIST}/optimize`);
        await page.locator('ss-optimizations-page h1').waitFor({ timeout: 20000 });
        await sleep(1500);
        const suggestions = await page
          .locator('ss-suggestion-card')
          .evaluateAll((cards) =>
            cards.map((card) => card.textContent.replace(/\s+/g, ' ').trim()),
          );
        check(
          `${label}: Optimizations never suggests dropping Ultimate, whose Fortnite Crew is Needed`,
          !suggestions.some((text) => /Ultimate →|Remove Xbox Game Pass Ultimate/.test(text)),
          suggestions.map((text) => text.slice(0, 80)).join(' | ') || 'none',
        );
        await axeCheck(page, `${label}, Optimizations`);

        // ── Search: Ultimate's counts take the perks its lists rank ────────────────────────────────────
        await page.goto(`${baseUrl}search?q=xbox`);
        const xbox = page.locator('ss-sub-card', {
          has: page.getByRole('heading', { name: 'Xbox Game Pass', exact: true }),
        });
        await xbox.waitFor({ timeout: 20000 });
        await xbox.getByRole('radio', { name: /^Ultimate/ }).click();
        await sleep(400);
        const counts = (
          await xbox
            .locator('.ranks')
            .textContent()
            .catch(() => '')
        )
          .replace(/\s+/g, ' ')
          .trim();
        check(
          `${label}: Search counts Ultimate's ranked perks`,
          /1\s*Needed/.test(counts) && /1\s*Wanted/.test(counts),
          counts,
        );
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        check(
          `${label}: nothing scrolls sideways on Search`,
          width <= viewport.width,
          `${width}px`,
        );
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  check('no console errors or warnings', consoleProblems.length === 0, consoleProblems.join('\n'));
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
})().catch((error) => {
  console.error(error);
  console.error(consoleProblems.join('\n'));
  process.exitCode = 1;
});

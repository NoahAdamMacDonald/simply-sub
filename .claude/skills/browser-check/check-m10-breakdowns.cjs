// M10.30 in the system Edge on ng serve, for a Canadian in Alberta with a $500 monthly budget: Mullvad (euros) on a Travel card
// with a 2.5% FX fee and a $100 limit, Netflix Standard on none. Home's this-month bar by hover (a tap at 360, with touch) lists
// both with tax, fee and rate, its heading the bar's total; hovered it goes with the pointer, clicked it stays; by keyboard its
// button opens it with focus in it and Escape puts focus back. The Calendar's month, a Lists card and Payment's card open theirs.
// Both themes at both widths, with axe and no horizontal scroll.
// Usage: node check-m10-breakdowns.cjs <deps dir> <output dir> <base url ending in />
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

const rates = {
  data: {
    base: 'CAD',
    date: '2026-10-26',
    source: 'European Central Bank via Frankfurter',
    rates: { CHF: 0.581, EUR: 0.6372, GBP: 0.5571, SEK: 7.097, USD: 0.7243 },
  },
  meta: { fetchedAt: '2026-10-26T06:00:02Z', stale: false },
};

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
  const problems = result.violations
    .filter(
      (violation) =>
        violation.id !== 'region' ||
        !violation.nodes.every((node) => node.target.join(' ').includes('cdk-overlay')),
    )
    .map(
      (violation) =>
        `${violation.id}: ${violation.nodes
          .map((node) => node.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`,
    );
  check(`axe: ${label}`, problems.length === 0, problems.join('; '));
}

async function noSideScroll(page, viewport, label) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`no horizontal scroll: ${label}`, width <= viewport.width, `${width}px`);
}

/** The focused control's aria-label, or its text. */
const focusedLabel = (page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    return element?.getAttribute('aria-label') ?? element?.textContent?.replace(/\s+/g, ' ').trim();
  });

async function tabTo(page, name, limit = 80) {
  for (let presses = 0; presses < limit; presses++) {
    if ((await focusedLabel(page)) === name) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Never reached ${name}`);
}

const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };
const VPN_LIST = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const TV_LIST = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';
const MULLVAD = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a00';
const NETFLIX = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a01';
const FX_CARD = '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d31';

const item = (id, listId, planId, cardId) => ({
  id,
  listId,
  source: { kind: 'catalog', planId },
  billing: {
    mode: 'recurring',
    interval: 'month',
    intervalCount: 1,
    anchorDate: '2026-11-12',
    autoRenew: true,
  },
  ...(cardId && { cardId }),
  tagIds: [],
  rankOverrides: {},
  pinned: false,
  ...stamps,
});

async function plant(page) {
  await putRecord(page, 'cards', {
    id: FX_CARD,
    name: 'Travel',
    type: 'credit',
    network: 'visa',
    currency: 'CAD',
    cashbackPercent: 0,
    fxFeePercent: 2.5,
    monthlyLimit: 100,
    ...stamps,
  });
  await putRecord(page, 'lists', { id: VPN_LIST, name: 'VPN', ...stamps });
  await putRecord(page, 'lists', { id: TV_LIST, name: 'TV', ...stamps });
  await putRecord(page, 'items', item(MULLVAD, VPN_LIST, 'mullvad.vpn', FX_CARD));
  await putRecord(page, 'items', item(NETFLIX, TV_LIST, 'netflix.standard'));
  const [settings] = await readTable(page, 'settings');
  await putRecord(page, 'settings', { ...settings, monthlyBudget: 500 });
}

const textOf = (locator) => locator.innerText().then((text) => text.replace(/\s+/g, ' ').trim());
const panel = (page) => page.locator('.cdk-overlay-container .panel');
/** The lines of the open breakdown. */
const lines = (page) =>
  panel(page)
    .locator('li')
    .evaluateAll((items) => items.map((li) => li.textContent.replace(/\s+/g, ' ').trim()));

async function run(browser, colorScheme, viewport) {
  const label = `${colorScheme} ${viewport.width}`;
  const touch = viewport === NARROW;
  const context = await browser.newContext({
    locale: 'en-CA',
    colorScheme,
    viewport,
    hasTouch: touch,
  });
  await context.route('**/api/v1/fx?**', (route) => route.fulfill({ json: rates }));
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning')
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  const shot = (name) => path.join(outDir, `${name}-${label.replace(' ', '-')}.png`);
  try {
    await firstRun(page);
    await plant(page);

    // Home's this-month bar: hover (or a tap at 360) shows both subscriptions, Mullvad with its rate and fee.
    await page.goto(baseUrl);
    const bar = page.locator('.budgets ss-cost-breakdown .trigger').first();
    await bar.waitFor({ timeout: 30000 });
    await sleep(500);
    await page.locator('.budgets').screenshot({ path: shot('home-budgets') });
    if (touch) await bar.tap();
    else await bar.hover();
    await panel(page).waitFor({ timeout: 5000 });
    const found = await lines(page);
    check(
      `${label}: Home's bar lists Netflix with its tax and Mullvad with its rate and FX fee`,
      found.length === 2 &&
        /^Netflix Standard \$19\.94 \$18\.99 \+ \$0\.95 tax$/.test(found[0]) &&
        /^Mullvad VPN ≈ \$8\.04 ≈ \$7\.85 \+ ≈ \$0\.20 FX fee · €5\.00 at 1\.5\d{3}$/.test(
          found[1],
        ),
      found.join(' | '),
    );
    const total = await textOf(panel(page).locator('h3'));
    check(`${label}: its heading is the bar's total`, total === 'This month: ≈ $27.98', total);
    await sleep(400);
    await panel(page).screenshot({ path: shot('home-breakdown') });
    await axeCheck(page, `${label}: Home with the breakdown open`);
    await noSideScroll(page, viewport, `${label} Home`);
    if (!touch) {
      // Hovered only: it goes when the pointer does. A click keeps it.
      await page.mouse.move(5, 5);
      await panel(page).waitFor({ state: 'detached', timeout: 3000 });
      await bar.click();
      await page.mouse.move(5, 5);
      await sleep(400);
      check(`${label}: a click keeps it open`, (await panel(page).count()) === 1);
    }
    await page.keyboard.press('Escape');
    await bar.click({ position: { x: 5, y: 5 } }).catch(() => undefined);
    await page.goto(baseUrl);
    await bar.waitFor({ timeout: 30000 });

    // By keyboard: Tab to its button, Enter, focus in it; Escape back on the button.
    await page.locator('main').focus();
    await tabTo(page, 'Breakdown of this month');
    await page.keyboard.press('Enter');
    await panel(page).waitFor({ timeout: 5000 });
    await until('focus in the breakdown', () =>
      page.evaluate(() => document.activeElement?.classList.contains('panel') === true),
    );
    check(`${label}: Enter on its button opens it with focus in it`, true);
    await page.keyboard.press('Escape');
    await panel(page).waitFor({ state: 'detached' });
    check(
      `${label}: Escape closes it with focus back on its button`,
      (await focusedLabel(page)) === 'Breakdown of this month',
    );

    // The Calendar's month, the Lists overview's card and Payment's card each open theirs.
    for (const [where, url, selector, expected] of [
      ['the Calendar', 'calendar?month=2026-10', 'ss-cost-breakdown .trigger', 2],
      ['a Lists card', 'lists', '.lists ss-cost-breakdown .trigger', 1],
      ["Payment's card", 'payment', 'ss-cost-breakdown .trigger', 1],
    ]) {
      await page.goto(`${baseUrl}${url}`);
      const trigger = page.locator(selector).first();
      await trigger.waitFor({ timeout: 30000 });
      await sleep(500);
      await page.screenshot({ path: shot(where.replace(/[^a-z]+/gi, '-')) });
      if (touch) await trigger.tap();
      else await trigger.click();
      await panel(page).waitFor({ timeout: 5000 });
      const opened = await lines(page);
      check(
        `${label}: ${where}'s bar opens its breakdown`,
        opened.length === expected,
        opened.join(' | '),
      );
      await sleep(400);
      await axeCheck(page, `${label}: ${where} with the breakdown open`);
      await noSideScroll(page, viewport, `${label} ${where}`);
      await page.keyboard.press('Escape');
    }
  } catch (error) {
    check(`${label}: ran to the end`, false, error.message.split('\n')[0]);
    await page.screenshot({ path: shot('failure') });
  } finally {
    await context.close();
  }
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const colorScheme of ['light', 'dark']) {
      for (const viewport of [WIDE, NARROW]) await run(browser, colorScheme, viewport);
    }
  } finally {
    await browser.close();
  }
  check(
    'no console errors or warnings',
    consoleProblems.length === 0,
    consoleProblems.slice(0, 5).join(' | '),
  );
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} of ${checks.length} passed`);
  process.exitCode = failed > 0 ? 1 : 0;
})();

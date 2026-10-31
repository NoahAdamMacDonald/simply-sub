// M10.29 in the system Edge on ng serve, for a Canadian in Alberta with a $500 monthly budget: Mullvad (euros) on a card with
// a 2.5% FX fee in one list, Netflix Standard on a 2% cash-back card in another. This month's totals and Home's budget count
// the FX fee and not the cash back; the year's cash back shows on List view, Home, the Lists overview (not its cards) and the
// Calendar's year view. Both themes at both widths, with axe and no horizontal scroll.
// Usage: node check-m10-card-fees.cjs <deps dir> <output dir> <base url ending in />
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
const CASH_CARD = '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d32';

const card = (id, name, cashbackPercent, fxFeePercent) => ({
  id,
  name,
  type: 'credit',
  network: 'visa',
  currency: 'CAD',
  cashbackPercent,
  fxFeePercent,
  ...stamps,
});

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
  cardId,
  tagIds: [],
  rankOverrides: {},
  pinned: false,
  ...stamps,
});

async function plant(page) {
  await putRecord(page, 'cards', card(FX_CARD, 'Travel', 0, 2.5));
  await putRecord(page, 'cards', card(CASH_CARD, 'Cash Back', 2, 0));
  await putRecord(page, 'lists', { id: VPN_LIST, name: 'VPN', ...stamps });
  await putRecord(page, 'lists', { id: TV_LIST, name: 'TV', ...stamps });
  await putRecord(page, 'items', item(MULLVAD, VPN_LIST, 'mullvad.vpn', FX_CARD));
  await putRecord(page, 'items', item(NETFLIX, TV_LIST, 'netflix.standard', CASH_CARD));
  const [settings] = await readTable(page, 'settings');
  await putRecord(page, 'settings', { ...settings, monthlyBudget: 500 });
}

const textOf = (locator) => locator.innerText().then((text) => text.replace(/\s+/g, ' ').trim());
/** The dollar amounts in `text`, in order. */
const amounts = (text) =>
  [...text.matchAll(/\$([\d,]+\.\d\d)/g)].map((match) => Number(match[1].replace(',', '')));

async function run(browser, colorScheme, viewport) {
  const label = `${colorScheme} ${viewport.width}`;
  const context = await browser.newContext({ locale: 'en-CA', colorScheme, viewport });
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

    // List view: Mullvad's figure with its FX fee, and Netflix's price and cash back.
    await page.goto(`${baseUrl}lists/${VPN_LIST}`);
    const net = page.locator('.net-summary [aria-hidden]');
    await net.waitFor({ timeout: 30000 });
    const [mullvadGross, mullvadNet] = amounts(await textOf(net));
    check(
      `${label}: Mullvad costs more on the 2.5% card`,
      mullvadNet > mullvadGross,
      `${mullvadGross} → ${mullvadNet}`,
    );
    const vpnMonth = amounts(await textOf(page.locator('ss-budget-totals .total').first()))[0];
    check(
      `${label}: VPN's this month counts the fee`,
      vpnMonth === mullvadNet,
      `${vpnMonth} vs ${mullvadNet}`,
    );
    check(
      `${label}: no cash back line for a card with none`,
      (await page.locator('ss-budget-totals .cashback').count()) === 0,
    );
    await page.goto(`${baseUrl}lists/${TV_LIST}`);
    await page.locator('.net-summary').waitFor({ timeout: 30000 });
    // With tax, before the card: the net summary's first figure.
    const [netflixGross] = amounts(await textOf(page.locator('.net-summary [aria-hidden]')));
    const cashback = page.locator('ss-budget-totals .cashback');
    await cashback.waitFor({ timeout: 10000 });
    const tvBack = await textOf(cashback.locator('[aria-hidden="true"]:not(mat-icon)'));
    check(
      `${label}: List view shows the year's cash back`,
      /^\$[\d.]+ cash back in 2026$/.test(tvBack),
      tvBack,
    );
    await page.locator('.money').screenshot({ path: shot('list-view-money') });
    await axeCheck(page, `${label}: List view`);
    await noSideScroll(page, viewport, `${label} List view`);

    // Home: this month counts Mullvad's fee and Netflix's price, not its cash back.
    await page.goto(baseUrl);
    const budgets = page.locator('.budgets ss-budget-totals');
    await budgets.locator('.total').first().waitFor({ timeout: 30000 });
    const monthText = await textOf(budgets.locator('.total [aria-hidden]').first());
    const [homeMonth, budget] = amounts(monthText);
    check(
      `${label}: Home's budget counts the FX fee, not the cash back`,
      Math.abs(homeMonth - (mullvadNet + netflixGross)) < 0.015 && budget === 500,
      `${monthText}: ${mullvadNet} + ${netflixGross}`,
    );
    const homeBack = await textOf(budgets.locator('.cashback [aria-hidden="true"]:not(mat-icon)'));
    check(`${label}: Home shows the year's cash back`, homeBack === tvBack, homeBack);
    await page.locator('.budgets').screenshot({ path: shot('home-budgets') });
    await axeCheck(page, `${label}: Home`);
    await noSideScroll(page, viewport, `${label} Home`);

    // The Lists overview: every list together, and no line on each list's card.
    await page.goto(`${baseUrl}lists`);
    const overall = page.locator('.money ss-budget-totals .cashback');
    await overall.waitFor({ timeout: 30000 });
    check(
      `${label}: the Lists overview shows it for every list, not on each card`,
      (await textOf(overall.locator('[aria-hidden="true"]:not(mat-icon)'))) === tvBack &&
        (await page.locator('.lists ss-budget-totals .cashback').count()) === 0,
    );
    await axeCheck(page, `${label}: Lists`);
    await noSideScroll(page, viewport, `${label} Lists`);

    // The Calendar's year view.
    await page.goto(`${baseUrl}calendar?month=2026-10&view=year`);
    const yearBack = page.locator('ss-calendar-year .cashback');
    await yearBack.waitFor({ timeout: 30000 });
    const yearText = await textOf(yearBack.locator('[aria-hidden="true"]:not(mat-icon)'));
    check(`${label}: the year view shows it`, yearText === tvBack, yearText);
    await page.screenshot({ path: shot('calendar-year') });
    await axeCheck(page, `${label}: the year view`);
    await noSideScroll(page, viewport, `${label} the year view`);
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

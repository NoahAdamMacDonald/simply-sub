// M11.11 in the system Edge: an account plan's balance and facts, on `ng serve`, for a Canadian in Ontario. No real
// finance provider is in the catalog before M11.15, so the CA file is answered with a fixture bank added (a balance of
// $4,000, any direct deposit, or a student of 24 or under waives its fee). In both themes at 1280 and 360 px, keyboard
// only:
// - /lists/new?add=example-bank.unlimited opens the item dialog with an Account section: the privacy note, Balance in
//   CAD, and only the facts the bank's conditions need (direct deposits, month of birth, student).
// - A direct deposit without a balance: Add says why at Balance, with focus there. Then a balance ("As of today"), a
//   month of birth typed into the month field (5, →, 2003), and Student with Space.
// - Saved with the list, List view's Export offers "Include balances", a menu checkbox that Space ticks without closing
//   the menu; the CSV then ends with Balance, Balance currency and Balance as of. A CSV without it has none.
// With axe on the dialog and the open menu, screenshots, and no horizontal scroll.
// Usage: node check-m11-balances.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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
/** The menu that's open, not one still fading out. */
const OPEN_MENU = '.mat-mdc-menu-panel:not(.mat-menu-panel-exit-animation)';
const checks = [];
const consoleProblems = [];
function check(name, ok, detail = '') {
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Today on this device, as the app's clock gives it. */
const now = new Date();
const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
  .map((part) => String(part).padStart(2, '0'))
  .join('-');

/** The fixture bank (core's finance fixture, simplified), as the CA file's snapshot holds a provider. */
const bank = {
  id: 'example-bank',
  name: 'Example Bank',
  website: 'https://example.com',
  category: 'finance',
  spendCategory: 'finance',
  cancelUrl: 'https://example.com/close',
  regulators: [
    {
      name: 'OSFI',
      url: 'https://www.osfi-bsif.gc.ca/en/supervision/financial-institutions',
      lastVerified: '2026-11-03',
    },
  ],
  plans: [
    {
      id: 'example-bank.unlimited',
      name: 'Unlimited Chequing',
      link: 'https://example.com/chequing',
      features: {},
      prices: [
        {
          region: 'CA',
          currency: 'CAD',
          amount: 17.95,
          interval: 'month',
          intervalCount: 1,
          autoRenew: true,
          lastVerified: '2026-11-03',
        },
      ],
      account: {
        kind: 'chequing',
        currency: 'CAD',
        waivers: [{ minBalance: 4000 }, { directDeposit: true }, { maxAge: 24, student: true }],
        protection: {
          insurer: 'cdic',
          held: 'own-name',
          limit: 100000,
          url: 'https://example.com/deposit-insurance',
          quotes: ['Your eligible deposits are protected by CDIC.'],
          lastVerified: '2026-11-03',
        },
      },
    },
  ],
};

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

async function newPage(browser, label, colorScheme, viewport) {
  const context = await browser.newContext({
    locale: 'en-CA',
    colorScheme,
    viewport,
    acceptDownloads: true,
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
          rates: { EUR: 0.6372, USD: 0.7243 },
        },
        meta: { fetchedAt: '2026-10-26T06:00:02Z', stale: false },
      },
    }),
  );
  // The CA file with the fixture bank and the finance categories it names.
  await context.route('**/data/catalog/CA.json', async (route) => {
    const response = await route.fetch();
    const file = await response.json();
    const { categories } = file.data;
    categories.service.push({
      id: 'finance',
      name: 'Banking & investing',
      icon: 'account_balance',
    });
    categories.spend.push({ id: 'finance', name: 'Bank & account fees' });
    file.data.providers.push(bank);
    await route.fulfill({ response, json: file });
  });
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

/** Opens Home and completes the first-run dialog for Ontario. */
async function firstRun(page) {
  await page.goto(baseUrl);
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor({ timeout: 20000 });
  await page
    .locator('mat-form-field', { has: page.locator('mat-label', { hasText: 'Province' }) })
    .locator('.mat-mdc-text-field-wrapper')
    .click();
  await page.getByRole('option', { name: 'Ontario', exact: true }).click();
  await page.locator('.cdk-overlay-pane mat-option').first().waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Get started' }).click();
  await dialog.waitFor({ state: 'detached' });
}

async function axeCheck(page, label, scope) {
  await sleep(600);
  await page.evaluate(axeSource);
  const result = await page.evaluate(
    (selector) => axe.run(document.querySelector(selector)),
    scope,
  );
  const problems = result.violations.map(
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
async function keyTo(page, isThere, key = 'Tab', limit = 150) {
  let presses = 0;
  while (presses < limit && !(await page.evaluate(isThere))) {
    await page.keyboard.press(key);
    presses++;
  }
  if (!(await page.evaluate(isThere))) throw new Error(`Never reached: ${isThere}`);
}

/** Tabs (or Shift+Tabs) to the element `selector` names. */
function tabTo(page, selector, key = 'Tab') {
  return keyTo(page, `document.activeElement?.matches(${JSON.stringify(selector)}) ?? false`, key);
}

/** The focused element's label: its form field's, or its own text. */
function focusedLabel(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    const field = active?.closest('mat-form-field');
    const label =
      field?.querySelector('mat-label') ?? active?.closest('mat-checkbox')?.querySelector('label');
    return (label ?? active)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  });
}

/** A form field's text by its label: its hint or error, below it. */
function belowField(page, label) {
  return page
    .locator('section.account mat-form-field', {
      has: page.locator('mat-label', { hasText: new RegExp(`^${label}$`) }),
    })
    .locator('.mat-mdc-form-field-subscript-wrapper')
    .innerText();
}

/** The CSV a menu item downloads, without its byte order mark. */
async function downloadCsv(page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Enter'),
  ]);
  return fs.readFileSync(await download.path(), 'utf8').replace(/^﻿/, '');
}

/** Opens Export from the keyboard, its first item focused. */
async function openExport(page) {
  await tabTo(page, 'button.export', 'Shift+Tab');
  await page.keyboard.press('Enter');
  await page.locator(OPEN_MENU).waitFor();
  await until('focus in the menu', () =>
    page.evaluate(() => document.activeElement?.closest('[mat-menu-item]') !== null),
  );
}

async function run(browser, colorScheme, viewport) {
  const label = `${colorScheme} ${viewport.width}`;
  const { context, page } = await newPage(browser, label, colorScheme, viewport);
  try {
    await firstRun(page);
    await page.goto(`${baseUrl}lists/new?add=example-bank.unlimited&interval=month`);
    const dialog = page.locator('ss-item-dialog');
    const account = dialog.locator('section.account');
    await account.waitFor({ timeout: 20000 });

    const shown = await account.evaluate((section) => ({
      heading: section.querySelector('h3')?.textContent.trim(),
      note: section.querySelector('p.note')?.textContent.replace(/\s+/g, ' ').trim(),
      labels: [...section.querySelectorAll('mat-label, mat-checkbox label')].map((element) =>
        element.textContent.trim(),
      ),
      suffixes: [...section.querySelectorAll('.mat-mdc-form-field-text-suffix')].map((element) =>
        element.textContent.trim(),
      ),
    }));
    check(
      `${label}: the Account section asks for the balance in CAD and only the bank's facts`,
      shown.heading === 'Account' &&
        JSON.stringify(shown.labels) ===
          JSON.stringify([
            'Balance',
            'Direct deposits a month',
            'Month of birth',
            'I’m a full-time student',
          ]) &&
        JSON.stringify(shown.suffixes) === JSON.stringify(['CAD', 'CAD']),
      JSON.stringify(shown),
    );
    check(
      `${label}: its note says who can read it and what exports do`,
      shown.note ===
        'Optional: what Example Bank’s fees and rates depend on. Only your devices can read it: App lock seals it, and exports leave it out unless you tick Include balances.',
      shown.note,
    );

    // A direct deposit without a balance: Add says why at Balance, and focus goes there. The dialog puts focus on its
    // title once it's open: keys pressed before then land elsewhere.
    await until('focus on the dialog’s title', () =>
      page.evaluate(() => document.activeElement?.matches('ss-item-dialog h2') ?? false),
    );
    await tabTo(page, 'section.account input');
    check(`${label}: Tab reaches Balance`, (await focusedLabel(page)) === 'Balance');
    await page.keyboard.press('Tab');
    check(
      `${label}: then Direct deposits a month`,
      (await focusedLabel(page)) === 'Direct deposits a month',
    );
    await page.keyboard.type('1800');
    await page.keyboard.press('Enter');
    await until('the balance’s error', async () =>
      (await belowField(page, 'Balance')).includes('Enter the balance too'),
    );
    check(
      `${label}: Add without a balance says why at Balance, focus there`,
      (await belowField(page, 'Balance')).trim() ===
        'Enter the balance too, which these are kept with' &&
        (await focusedLabel(page)) === 'Balance',
      `${await belowField(page, 'Balance')} / ${await focusedLabel(page)}`,
    );
    await page.keyboard.type('2500');
    await until('the date of the balance', async () =>
      (await belowField(page, 'Balance')).includes('As of today'),
    );
    check(`${label}: a balance is "As of today"`, true);

    // The month of birth, typed into the month field: 5 for May, then → to the year, 2003.
    await tabTo(page, 'section.account input[type="month"]');
    await page.keyboard.press('5');
    await page.keyboard.press('ArrowRight');
    for (const digit of '2003') await page.keyboard.press(digit);
    const born = await page.locator('section.account input[type="month"]').inputValue();
    check(`${label}: the month field takes a month typed in`, born === '2003-05', born);
    await tabTo(page, 'section.account mat-checkbox input');
    await page.keyboard.press('Space');
    check(
      `${label}: Space ticks Student`,
      await page.locator('section.account mat-checkbox input').isChecked(),
    );

    await axeCheck(page, `${label}, the item dialog's Account section`, 'mat-dialog-container');
    await account.screenshot({
      path: path.join(outDir, `balances-dialog-${colorScheme}-${viewport.width}.png`),
    });
    await noSideScroll(page, viewport, `${label}, the item dialog`);

    await tabTo(page, 'mat-dialog-actions button[type="submit"]');
    await page.keyboard.press('Enter');
    await dialog.waitFor({ state: 'detached' });

    // The list's name, then Save: List view opens.
    await tabTo(page, '.toolbar input', 'Shift+Tab');
    await page.keyboard.type('Bank accounts');
    await tabTo(page, '.toolbar button.mat-mdc-unelevated-button');
    await page.keyboard.press('Enter');
    await page.locator('button.export').waitFor({ timeout: 15000 });

    // A CSV without Include balances has none.
    await openExport(page);
    const include = page.locator(`${OPEN_MENU} .include-balances`);
    const first = await include.evaluate((item) => ({
      role: item.getAttribute('role'),
      checked: item.getAttribute('aria-checked'),
      focused: item === document.activeElement,
      text: item.querySelector('span')?.textContent.trim(),
    }));
    check(
      `${label}: Export's first item is "Include balances", a menu checkbox, unticked and focused`,
      first.role === 'menuitemcheckbox' &&
        first.checked === 'false' &&
        first.focused &&
        first.text === 'Include balances',
      JSON.stringify(first),
    );
    await page.keyboard.press('ArrowDown');
    const plain = await downloadCsv(page);
    check(
      `${label}: unticked, the CSV has no balance`,
      !plain.includes('Balance') && !plain.includes('2500'),
      plain.split('\r\n')[0],
    );

    await openExport(page);
    await page.keyboard.press('Space');
    await until(
      'Include balances ticked',
      async () => (await include.getAttribute('aria-checked')) === 'true',
    );
    check(
      `${label}: Space ticks it, the menu still open with focus on it`,
      (await page.locator(OPEN_MENU).count()) === 1 &&
        (await include.evaluate((item) => item === document.activeElement)),
    );
    await axeCheck(page, `${label}, Export with Include balances`, OPEN_MENU);
    await page.locator(OPEN_MENU).screenshot({
      path: path.join(outDir, `balances-export-${colorScheme}-${viewport.width}.png`),
    });
    await page.keyboard.press('ArrowDown');
    const [header, row] = (await downloadCsv(page)).split('\r\n');
    check(
      `${label}: ticked, the CSV ends with the balance, its currency and its date`,
      header.endsWith(',Tags,Balance,Balance currency,Balance as of') &&
        row.endsWith(`,2500,CAD,${today}`),
      `${header} / ${row}`,
    );
    await noSideScroll(page, viewport, `${label}, List view`);
  } finally {
    await context.close();
  }
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    for (const colorScheme of ['light', 'dark']) {
      for (const viewport of [WIDE, NARROW]) await run(browser, colorScheme, viewport);
    }
  } finally {
    await browser.close();
  }
  check('no console errors or warnings', consoleProblems.length === 0, consoleProblems.join('\n'));
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
})();

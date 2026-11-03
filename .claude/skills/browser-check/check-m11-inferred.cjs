// M11.9 in the system Edge: an inferred feature value on a Search card, on the real catalog (data:build's files), in
// both themes at 1280 and 360 px, for a Canadian in Alberta. ICI TOU.TV's details show ICI RDI's "Video quality: 1080p
// (Full HD)" with an "inferred" link to the help article it's inferred from, in a new tab, named for the page and the
// reason; Tab reaches it and its tooltip says why. With axe, screenshots and no horizontal scroll. GET /fx is answered
// with fixed rates.
// Usage: node check-m11-inferred.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

const article =
  'https://assistance.radio-canada.ca/hc/fr/articles/360035562791-Quelle-est-ma-consommation-de-donn%C3%A9es-mobiles';

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

async function openSearch(page) {
  await page.goto(`${baseUrl}search`);
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
  await page.locator('ss-sub-card').first().waitFor({ timeout: 20000 });
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

const card = (page, name) =>
  page.locator('ss-sub-card', { has: page.getByRole('heading', { name, exact: true }) });

/** Opens a card's details and waits for them to finish sliding open. */
async function details(page, name) {
  const found = card(page, name);
  await found.scrollIntoViewIfNeeded();
  await found.locator('button.expand').click();
  await found.locator('ss-plan-details').waitFor();
  await sleep(1000);
  return found;
}

async function run(browser, colorScheme, viewport) {
  const label = `${colorScheme} ${viewport.width}`;
  const { context, page } = await newContext(browser, { colorScheme, viewport });
  try {
    await openSearch(page);
    const ici = await details(page, 'ICI TOU.TV');
    const line = ici.locator('ss-feature-lines li .feature', { hasText: 'Video quality' });
    const text = (await line.first().innerText()).replace(/\s+/g, ' ').trim();
    check(
      `${label}: RDI's video quality is marked inferred`,
      /^Video quality: 1080p \(Full HD\) inferred/.test(text),
      text,
    );
    const link = line.first().locator('a.inferred');
    check(
      `${label}: the mark links the help article, in a new tab`,
      (await link.getAttribute('href')) === article &&
        (await link.getAttribute('target')) === '_blank',
    );
    const name = await link.getAttribute('aria-label');
    check(
      `${label}: its name says where and why`,
      /^Inferred from Données mobiles \(in French\) \(opens in a new tab\): /.test(name ?? ''),
      name ?? '',
    );
    // Keyboard: Tab from the card's expand button until the mark is focused, then its tooltip says why.
    await ici.locator('button.expand').focus();
    let reached = false;
    for (let presses = 0; presses < 40 && !reached; presses++) {
      await page.keyboard.press('Tab');
      reached = await link.evaluate((element) => element === document.activeElement);
    }
    check(`${label}: Tab reaches the mark`, reached);
    if (reached) {
      const tooltip = page.locator('.mat-mdc-tooltip-surface');
      await tooltip.waitFor({ timeout: 5000 }).catch(() => undefined);
      const reason = (await tooltip.count()) ? await tooltip.first().innerText() : '';
      check(
        `${label}: its tooltip gives the reason`,
        reason.startsWith('Its plan page states 1080p for EXTRA only.'),
        reason,
      );
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    check(`${label}: no horizontal scroll`, !overflow);
    await line.first().scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(outDir, `inferred-${colorScheme}-${viewport.width}.png`),
    });
    await axeCheck(page, `${label}, ICI TOU.TV's details open`);
  } finally {
    await context.close();
  }
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const colorScheme of ['light', 'dark']) {
      for (const viewport of [WIDE, NARROW]) {
        await run(browser, colorScheme, viewport);
      }
    }
  } finally {
    await browser.close();
  }
  check('no console errors or warnings', consoleProblems.length === 0, consoleProblems.join(' | '));
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

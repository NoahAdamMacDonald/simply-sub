// The feedback after M10, part 2, item 10 (M10.22) in the system Edge on ng serve, for a Canadian in Alberta, in both
// themes at 1280 px (Search's filter panel) and 360 px (its drawer): Category is empty while it's All, its label in the
// field as Features' is; focused by Tab, its label floats and "All" is its placeholder; "vp" typed at once narrows the
// list to VPN, and Enter picks it (cat=vpn, the field "VPN"); All picked with the pointer empties it again, with no
// cat in the URL. With axe on the empty field, focused and unfocused, screenshots, and no horizontal scroll.
// Usage: node check-m10-category.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

const field = (page) => page.locator('ss-choice-field[data-label="Category"]');
const input = (page) => field(page).locator('input');
/** The field's label floats above it (focused, or with text). */
const floated = (page) => field(page).locator('.mdc-floating-label--float-above').count();
const options = (page) => page.locator('.mat-mdc-autocomplete-panel mat-option').allTextContents();

async function run(browser, colorScheme, viewport) {
  const label = `${colorScheme} ${viewport.width}`;
  const narrow = viewport === NARROW;
  const context = await browser.newContext({ locale: 'en-CA', colorScheme, viewport });
  await context.route('**/api/v1/fx?**', (route) => route.fulfill({ json: rates }));
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning')
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  const shot = (name) =>
    page.screenshot({ path: path.join(outDir, `${name}-${label.replace(' ', '-')}.png`) });
  try {
    await firstRun(page);
    await page.goto(`${baseUrl}search`);
    await page.locator('ss-sub-card').first().waitFor({ timeout: 20000 });
    if (narrow) {
      await page.getByRole('button', { name: /^Filters/ }).click();
      await page.locator('mat-dialog-container').waitFor();
      await sleep(400);
    }

    check(
      `${label}: Category is empty while it's All, its label in the field`,
      (await input(page).inputValue()) === '' &&
        (await input(page).getAttribute('placeholder')) === 'All' &&
        (await floated(page)) === 0,
    );
    await field(page).scrollIntoViewIfNeeded();
    await shot('category-empty');
    await axeCheck(page, `${label}: Category empty`);

    // By keyboard: Tab to it, its label floats over "All"; typing starts at once.
    for (let press = 0; press < 30; press++) {
      if (await input(page).evaluate((box) => box === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await sleep(400);
    check(
      `${label}: focused by Tab, its label floats over "All"`,
      (await floated(page)) === 1 &&
        (await input(page).evaluate((box) => box === document.activeElement)),
    );
    await shot('category-focused');
    await axeCheck(page, `${label}: Category focused`);
    await page.keyboard.type('vp');
    await page.waitForFunction(() => {
      const shown = [...document.querySelectorAll('.mat-mdc-autocomplete-panel mat-option')];
      return shown.length === 1 && shown[0].textContent.trim() === 'VPN';
    });
    check(
      `${label}: "vp" typed at once narrows the list to VPN`,
      (await options(page)).length === 1,
    );
    await sleep(400);
    await page.keyboard.press('Enter');
    await page.waitForURL(/cat=vpn/);
    check(
      `${label}: Enter picks VPN, in the URL and the field`,
      (await input(page).inputValue()) === 'VPN',
      await input(page).inputValue(),
    );

    // With the pointer: All empties it again.
    await field(page).locator('.mat-mdc-text-field-wrapper').click();
    await page.getByRole('option', { name: 'All', exact: true }).click();
    await page.waitForURL((url) => !url.search.includes('cat='));
    await sleep(400);
    check(
      `${label}: All picked with the pointer empties the field, with no cat in the URL`,
      (await input(page).inputValue()) === '',
      await input(page).inputValue(),
    );
    await noSideScroll(page, viewport, label);
  } catch (error) {
    check(`${label}: ran to the end`, false, error.message.split('\n')[0]);
    await shot('failure');
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

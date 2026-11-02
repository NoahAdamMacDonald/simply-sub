// M11.4 in the system Edge: Search's Features filter with Ad free (ad-free since M11.4, streaming.ad-free before) and a
// card's features, on the real catalog (data:build's files), in both themes at 1280 and 360 px, for a Canadian in
// Alberta. Features reached by Tab (at 360 px inside the Filters drawer), "ad free" typed and Ad free picked by arrow
// key and Enter (f=ad-free, its chip); the results all ad free (no TSN or RDS), and Netflix's details by Enter listing
// Ad free; an old link's f=streaming.ad-free rewritten in place to f=ad-free, with the same results and chip. With axe
// (the suggestions open, the details open), screenshots and no horizontal scroll. GET /fx is answered with fixed rates.
// Usage: node check-m11-features.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

async function until(what, condition, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await condition();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

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

const names = (page) => page.locator('ss-sub-card h2').allTextContents();
const card = (page, name) =>
  page.locator('ss-sub-card', { has: page.getByRole('heading', { name, exact: true }) });
async function chips(page, name) {
  return card(page, name)
    .locator('label.chip')
    .allTextContents()
    .then((texts) => texts.map((text) => text.replace('check', '').trim()));
}
const search = (page) => decodeURIComponent(new URL(page.url()).search);
async function stop(page) {
  return (await page.locator(':focus').ariaSnapshot()).split('\n')[0].replace(/^- /, '');
}

const chipNames = (page) =>
  page
    .locator('mat-chip-row')
    .allTextContents()
    .then((texts) => texts.map((text) => text.replace('cancel', '').trim()));

/** Tabs from the search box (at 360 px, from inside the Filters drawer) until a control matching `pattern` has focus. */
async function tabTo(page, viewport, pattern) {
  await page.getByRole('searchbox').focus();
  if (viewport === NARROW) {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await page.locator('mat-dialog-container').waitFor();
    await until('focus in the drawer', () =>
      page.evaluate(() => !!document.activeElement?.closest('mat-dialog-container')),
    );
  }
  for (let i = 0; i < 14 && !pattern.test(await stop(page)); i++) {
    await page.keyboard.press('Tab');
  }
  return pattern.test(await stop(page));
}

async function closeFilters(page, viewport) {
  if (viewport !== NARROW) {
    await page.keyboard.press('Escape');
    return;
  }
  for (let i = 0; i < 3 && (await page.locator('mat-dialog-container').count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await sleep(400);
  }
  await page.locator('mat-dialog-container').waitFor({ state: 'detached' });
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    for (const colorScheme of ['light', 'dark']) {
      for (const viewport of [WIDE, NARROW]) {
        const label = `${colorScheme} ${viewport.width}`;
        const shot = (name) => path.join(outDir, `${name}-${label.replace(' ', '-')}.png`);
        const { context, page } = await newContext(browser, { colorScheme, viewport });
        await openSearch(page);
        const all = await names(page);

        // ── Ad free from the Features suggestions, by keyboard ────────────────────────────────────
        check(`${label}: Tab reaches Features`, await tabTo(page, viewport, /^combobox "Features/));
        await page.keyboard.type('ad free');
        const options = page.locator('.mat-mdc-autocomplete-panel mat-option');
        await until(
          'the Ad free suggestion',
          async () =>
            // The whole list shows until the typed text narrows it.
            (await options.allTextContents())[0]?.trim() === 'Ad free',
        );
        const offered = (await options.allTextContents()).map((text) => text.trim());
        const groups = (
          await page
            .locator('.mat-mdc-autocomplete-panel .mat-mdc-optgroup-label')
            .allTextContents()
        ).map((text) => text.trim());
        check(
          `${label}: "ad free" offers Ad free first, under Matches`,
          offered[0] === 'Ad free' && groups[0] === 'Matches',
          `${groups.join(' / ')}: ${offered.join(', ')}`,
        );
        await axeCheck(page, `${label}, the Features suggestions open`);
        await page.screenshot({ path: shot('features-ad-free') });
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await until('f=ad-free', () => search(page) === '?f=ad-free');
        await until('the Ad free chip', async () => (await chipNames(page)).join() === 'Ad free');
        check(`${label}: ArrowDown and Enter pick Ad free: f=ad-free and its chip`, true);
        await closeFilters(page, viewport);
        await until('fewer results', async () => (await names(page)).length < all.length, 15000);
        const adFree = await names(page);
        check(
          `${label}: the results are the ad-free providers only (no TSN or RDS)`,
          ['Netflix', 'Crave', 'Disney+'].every((name) => adFree.includes(name)) &&
            !adFree.includes('TSN') &&
            !adFree.includes('RDS'),
          adFree.join(', '),
        );

        // ── A card's features, by keyboard ────────────────────────────────────────────────────────
        const netflix = card(page, 'Netflix');
        await netflix.getByRole('button', { name: /^Details: / }).focus();
        await page.keyboard.press('Enter');
        const lines = netflix.locator('.details ss-feature-lines li');
        await lines.first().waitFor();
        await sleep(600);
        const features = (await lines.allInnerTexts()).map((text) =>
          text.replace(/\s+/g, ' ').trim(),
        );
        check(
          `${label}: Netflix's details list Ad free with its other features`,
          features.includes('Ad free') && features.some((text) => text.startsWith('Video quality')),
          features.join(' | '),
        );
        await axeCheck(page, `${label}, Netflix's details open`);
        await netflix.screenshot({ path: shot('netflix-features') });
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        check(`${label}: nothing scrolls sideways`, width <= viewport.width, `${width}px`);

        // ── An old link ───────────────────────────────────────────────────────────────────────────
        await page.goto(`${baseUrl}search?f=streaming.ad-free`);
        const before = await page.evaluate(() => history.length);
        await until('the old key rewritten', () => search(page) === '?f=ad-free', 15000);
        await until(
          'the same results',
          async () => (await names(page)).join() === adFree.join(),
          15000,
        );
        check(
          `${label}: an old link's f=streaming.ad-free reads as Ad free, its URL replaced in place`,
          (await page.evaluate(() => history.length)) === before,
          search(page),
        );
        if (viewport === WIDE) {
          check(
            `${label}: the old link shows the Ad free chip`,
            (await chipNames(page)).join() === 'Ad free',
          );
        }
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

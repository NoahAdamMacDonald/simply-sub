// M4.9 and M9.5 in the system Edge, with the browser's scrollbars shown (headless Chromium hides them): the
// scrollbars are thin and take the theme's tokens (the thumb the muted text colour, the track transparent) on the
// page, in a dialog and in a select's panel; the thumb is at least 3:1 against the page's and the dialog's
// backgrounds; it can still be dragged; and the card dialog's Name hint names no real card. For a Canadian in Alberta,
// in both themes at 1280 and 360 px, keyboard only where there's something to press, with axe and no horizontal
// scroll.
// Usage: node check-scrollbars.cjs <deps dir with playwright-core and axe-core> <output dir> <base url ending in />
const fs = require('fs');
const path = require('path');

const [depsDir, outDir, baseUrl] = process.argv.slice(2);
const { chromium } = require(path.join(depsDir, 'node_modules', 'playwright-core'));
const axePath = path.join(depsDir, 'node_modules', 'axe-core', 'axe.min.js');
fs.mkdirSync(outDir, { recursive: true });

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

/** Opens Home and completes the first-run dialog for Alberta. */
async function firstRun(page) {
  await page.goto(baseUrl);
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor({ timeout: 30000 });
  await page
    .locator('mat-form-field', { has: page.locator('mat-label', { hasText: 'Province' }) })
    .locator('.mat-mdc-text-field-wrapper')
    .click();
  await page.getByRole('option', { name: 'Alberta', exact: true }).click();
  await page.locator('.cdk-overlay-pane mat-option').first().waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Get started' }).click();
  await dialog.waitFor({ state: 'detached' });
}

/** axe on the page, with Material's overlay text set aside for `region` only (it's outside the landmarks). */
async function axeCheck(page, label) {
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document);
    return result.violations
      .map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.filter(
          (node) =>
            violation.id !== 'region' ||
            !node.target.some((target) => String(target).includes('cdk-overlay')),
        ),
      }))
      .filter((violation) => violation.nodes.length > 0)
      .map((violation) => `${violation.id} (${violation.nodes.length})`);
  });
  check(`${label}: axe finds nothing`, violations.length === 0, violations.join(', '));
}

/**
 * What a scroller's scrollbar is: its computed `scrollbar-color` and `scrollbar-width`, the tokens it should match,
 * and the thumb's contrast against `background` (a CSS colour) by WCAG's formula.
 */
function scrollbarOf(page, selector, backgroundSelector) {
  return page.evaluate(
    ({ selector, backgroundSelector }) => {
      const element = document.querySelector(selector);
      if (!element) return undefined;
      const style = getComputedStyle(element);
      const probe = document.createElement('div');
      document.body.append(probe);
      const resolve = (value) => {
        probe.style.color = value;
        return getComputedStyle(probe).color;
      };
      const root = getComputedStyle(document.documentElement);
      const thumb = resolve(root.getPropertyValue('--ss-scrollbar-thumb'));
      const muted = resolve(root.getPropertyValue('--ss-text-muted'));
      probe.remove();
      // rgb() has 0 to 255; color(srgb …), which Material's surfaces resolve to, 0 to 1.
      const channels = (color) => {
        const values = color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number);
        return color.startsWith('color(') ? values.map((value) => value * 255) : values;
      };
      const luminance = (color) => {
        const [r, g, b] = channels(color).map((value) => {
          const c = value / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const behind = getComputedStyle(document.querySelector(backgroundSelector)).backgroundColor;
      const [lighter, darker] = [luminance(thumb), luminance(behind)].sort((a, b) => b - a);
      return {
        color: style.scrollbarColor,
        width: style.scrollbarWidth,
        thumb,
        muted,
        behind,
        contrast: Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100,
      };
    },
    { selector, backgroundSelector },
  );
}

const fxRates = {
  data: {
    base: 'CAD',
    date: '2026-10-26',
    source: 'European Central Bank via Frankfurter',
    rates: { CHF: 0.581, EUR: 0.6372, GBP: 0.5571, SEK: 7.097, USD: 0.7243 },
  },
  meta: { fetchedAt: '2026-10-26T06:00:02Z', stale: false },
};

(async () => {
  await waitForServer();
  const browser = await chromium.launch({
    channel: 'msedge',
    ignoreDefaultArgs: ['--hide-scrollbars'],
  });
  for (const colorScheme of ['light', 'dark']) {
    for (const width of [1280, 360]) {
      const label = `${colorScheme} ${width} px`;
      const context = await browser.newContext({
        locale: 'en-CA',
        colorScheme,
        viewport: { width, height: width === 360 ? 740 : 800 },
      });
      await context.route('**/api/v1/fx?**', (route) => route.fulfill({ json: fxRates }));
      const page = await context.newPage();
      page.on('pageerror', (error) => consoleProblems.push(`[${label}] ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') consoleProblems.push(`[${label}] ${message.text()}`);
      });
      await firstRun(page);

      // The page: Search's cards make it scroll.
      await page.goto(`${baseUrl}search`);
      await page.locator('ss-sub-card, .card').first().waitFor({ timeout: 30000 });
      await sleep(1500);
      const pageBar = await scrollbarOf(page, 'html', 'body');
      check(
        `${label}: the page's scrollbar takes the tokens (the muted text colour on a transparent track)`,
        pageBar?.thumb === pageBar?.muted &&
          pageBar?.color === `${pageBar?.thumb} rgba(0, 0, 0, 0)`,
        JSON.stringify(pageBar),
      );
      const thin = await page.evaluate(() =>
        ['html', 'body', 'main'].map((selector) => {
          const element = document.querySelector(selector);
          return element ? getComputedStyle(element).scrollbarWidth : 'missing';
        }),
      );
      check(
        `${label}: thin on the page`,
        thin.every((value) => value === 'thin'),
        thin.join(', '),
      );
      const gutter = await page.evaluate(
        () => window.innerWidth - document.documentElement.clientWidth,
      );
      check(
        `${label}: the scrollbar is narrow (${gutter} px)`,
        gutter > 0 && gutter <= 12,
        String(gutter),
      );
      check(
        `${label}: the thumb is at least 3:1 against the page (${pageBar?.contrast}:1)`,
        (pageBar?.contrast ?? 0) >= 3,
      );
      check(
        `${label}: nothing scrolls sideways`,
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      );
      await page.screenshot({
        path: path.join(outDir, `scrollbars-${colorScheme}-${width}-search.png`),
      });

      // Dragging the thumb scrolls the page: from near its top end, down by a third of the window.
      const before = await page.evaluate(() => window.scrollY);
      const x = (await page.evaluate(() => document.documentElement.clientWidth)) + gutter / 2;
      await page.mouse.move(x, 12);
      await page.mouse.down();
      await page.mouse.move(x, 12 + Math.round((width === 360 ? 740 : 800) / 3), { steps: 8 });
      await page.mouse.up();
      await sleep(300);
      const after = await page.evaluate(() => window.scrollY);
      check(
        `${label}: dragging the thumb scrolls the page`,
        after > before + 100,
        `${before} → ${after}`,
      );
      await page.screenshot({
        path: path.join(outDir, `scrollbars-${colorScheme}-${width}-dragged.png`),
      });
      await page.evaluate(() => window.scrollTo(0, 0));
      await axeCheck(page, `${label}, Search`);

      // A dialog: Payment's Add card, reached by keyboard, with its Name hint.
      await page.goto(`${baseUrl}payment`);
      await page.locator('main h1').waitFor({ timeout: 30000 });
      await sleep(800);
      const add = page.getByRole('button', { name: 'Add card' }).first();
      let tabs = 0;
      while (tabs < 40 && !(await add.evaluate((element) => element === document.activeElement))) {
        await page.keyboard.press('Tab');
        tabs++;
      }
      check(`${label}: Add card reached by Tab`, tabs < 40);
      await page.keyboard.press('Enter');
      const dialog = page.locator('mat-dialog-container');
      await dialog.waitFor();
      await page.waitForFunction(() => document.activeElement?.matches('h2'), undefined, {
        timeout: 5000,
      });
      await sleep(600);
      const hint = await dialog
        .locator('mat-form-field', { has: page.locator('mat-label', { hasText: /^Name$/ }) })
        .locator('mat-hint')
        .textContent();
      check(
        `${label}: the card dialog's Name hint names no real card`,
        hint?.trim() === 'As on the card: Cash Back Mastercard',
        hint ?? '',
      );
      const dialogBar = await scrollbarOf(
        page,
        '.mat-mdc-dialog-content',
        '.mat-mdc-dialog-surface',
      );
      check(
        `${label}: the dialog's scrollbar is thin and themed, at least 3:1 (${dialogBar?.contrast}:1)`,
        dialogBar?.width === 'thin' &&
          dialogBar?.color === `${dialogBar?.thumb} rgba(0, 0, 0, 0)` &&
          dialogBar.contrast >= 3,
        JSON.stringify(dialogBar),
      );
      // Its Card currency menu, a menu you can type in since M4.8: with nothing typed, a long list that scrolls.
      await dialog.locator('ss-choice-field[data-label="Card currency"] input').click();
      const panel = page.locator('.mat-mdc-autocomplete-panel');
      await panel.waitFor();
      await sleep(600);
      const panelBar = await scrollbarOf(
        page,
        '.mat-mdc-autocomplete-panel',
        '.mat-mdc-autocomplete-panel',
      );
      check(
        `${label}: the menu's scrollbar is thin and themed, at least 3:1 (${panelBar?.contrast}:1)`,
        panelBar?.width === 'thin' &&
          panelBar?.color === `${panelBar?.thumb} rgba(0, 0, 0, 0)` &&
          panelBar.contrast >= 3,
        JSON.stringify(panelBar),
      );
      await page.screenshot({
        path: path.join(outDir, `scrollbars-${colorScheme}-${width}-panel.png`),
      });
      await page.keyboard.press('Escape');
      await panel.waitFor({ state: 'detached' });
      await page.screenshot({
        path: path.join(outDir, `scrollbars-${colorScheme}-${width}-dialog.png`),
      });
      await axeCheck(page, `${label}, the card dialog`);
      check(
        `${label}: nothing scrolls sideways with the dialog open`,
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      );
      await context.close();
    }
  }
  await browser.close();
  check('no console errors', consoleProblems.length === 0, consoleProblems.slice(0, 5).join(' | '));
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  console.error(consoleProblems.join('\n'));
  process.exit(1);
});

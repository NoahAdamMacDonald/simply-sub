// The app installed on a phone's Home Screen (the feedback after M10, part 2, item 3) in the system Edge: the screen's
// safe areas set through CDP (Emulation.setSafeAreaInsetsOverride, an iPhone's status bar and home indicator, 59 and
// 34 px) with the display mode standalone (Emulation.setEmulatedMedia), which viewport-fit=cover turns into
// env(safe-area-inset-*). For a Canadian in Alberta, in both themes at 360 and 1280 px:
// - Skip to main content off-screen until it has focus, then below the status bar;
// - the top bar's ☰ and the sidebar's logo below the status bar, the top bar's colour reaching the screen's top;
// - the drawer's Settings and theme buttons above the home indicator, with nothing in it to scroll;
// - the page's last line above the home indicator, scrolled to the end;
// - Search's bar, pinned below the top bar as the results scroll;
// - at 360 px the item dialog filling the screen, its title below the status bar and its Save above the indicator;
// - with no insets (a browser tab), the shell as before: the top bar 56 px high at the top;
// with axe, screenshots and no horizontal scroll.
// Usage: node check-home-screen-app.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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
const insets = { top: 59, bottom: 34, left: 0, right: 0 };

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

/** A page whose screen has a phone's safe areas, as an installed app, or none, as a browser tab. */
async function newPage(browser, label, { colorScheme, viewport, installed }) {
  const context = await browser.newContext({ locale: 'en-CA', colorScheme, viewport });
  await context.route('**/api/v1/fx?**', (route) => route.fulfill({ json: rates }));
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning')
      consoleProblems.push(`[${label}] ${msg.text()}`);
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  if (installed) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'display-mode', value: 'standalone' }],
    });
  }
  return { context, page };
}

async function getStarted(page) {
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

const box = (locator) => locator.boundingBox();

async function run(browser, colorScheme, viewport) {
  const narrow = viewport === NARROW;
  const label = `${colorScheme} ${narrow ? 'narrow' : 'wide'}`;
  const { context, page } = await newPage(browser, label, {
    colorScheme,
    viewport,
    installed: true,
  });
  await getStarted(page);
  const supported = await page.evaluate(
    () =>
      getComputedStyle(document.documentElement).getPropertyValue('--ss-inset-top').trim() !== '',
  );
  check(`${label}: the insets are tokens`, supported);
  const top = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.paddingTop = 'var(--ss-inset-top)';
    document.body.append(probe);
    const value = getComputedStyle(probe).paddingTop;
    probe.remove();
    return value;
  });
  check(`${label}: the status bar's inset reaches the app`, top === `${insets.top}px`, top);
  const skip = await box(page.locator('.skip-link'));
  check(
    `${label}: Skip to main content stays off-screen until it has focus`,
    skip.y + skip.height <= 0,
    `ends at ${Math.round(skip.y + skip.height)}`,
  );
  await page.locator('.skip-link').focus();
  await sleep(300);
  const shown = await box(page.locator('.skip-link'));
  check(
    `${label}: focused, it shows below the status bar`,
    shown.y >= insets.top,
    `at ${Math.round(shown.y)}`,
  );
  await page.locator('.skip-link').blur();

  if (narrow) {
    const bar = await box(page.locator('header.top-bar'));
    const menu = await box(page.getByRole('button', { name: 'Menu' }));
    check(
      `${label}: the top bar reaches the screen's top, its ☰ below the status bar`,
      bar.y === 0 && menu.y >= insets.top,
      `bar at ${bar.y}, ☰ at ${Math.round(menu.y)}`,
    );
    await page.getByRole('button', { name: 'Menu' }).focus();
    await page.keyboard.press('Enter');
    await page.locator('mat-sidenav ss-sidebar a').first().waitFor();
    await sleep(600);
  }
  const logo = await box(page.locator('ss-sidebar ss-logo'));
  const settings = await box(page.locator('ss-sidebar .footer'));
  const drawerScrolls = await page.evaluate(() => {
    const inner = document.querySelector('mat-sidenav .mat-drawer-inner-container');
    return inner ? inner.scrollHeight - inner.clientHeight : -1;
  });
  check(
    `${label}: the sidebar's logo below the status bar, Settings and the theme above the home indicator, nothing to scroll`,
    logo.y >= insets.top &&
      settings.y + settings.height <= viewport.height - insets.bottom &&
      drawerScrolls <= 0,
    `logo at ${Math.round(logo.y)}, foot ends at ${Math.round(settings.y + settings.height)} of ${viewport.height}, ${drawerScrolls} px to scroll`,
  );
  await page.screenshot({ path: path.join(outDir, `home-screen-sidebar-${label}.png`) });
  await axeCheck(page, `${label}: the sidebar`);
  if (narrow) {
    await page.keyboard.press('Escape');
    await page
      .locator('mat-sidenav.mat-drawer-opened')
      .waitFor({ state: 'detached' })
      .catch(() => undefined);
    await sleep(400);
  }

  // A page's end above the home indicator.
  await page.goto(`${baseUrl}settings`);
  await page.locator('main h1').waitFor();
  await sleep(600);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(400);
  const end = await page.evaluate(() => {
    const main = document.querySelector('main');
    const last = [...main.querySelectorAll('section, p, button, a')]
      .filter((el) => el.offsetParent)
      .at(-1);
    return last ? last.getBoundingClientRect().bottom : 0;
  });
  check(
    `${label}: scrolled to its end, Settings' last control is above the home indicator`,
    end <= viewport.height - insets.bottom,
    `ends at ${Math.round(end)} of ${viewport.height}`,
  );
  await noSideScroll(page, viewport, `${label}: Settings`);

  // Search's bar stays below the top bar and the status bar as the results scroll.
  await page.goto(`${baseUrl}search`);
  await page.locator('ss-sub-card').first().waitFor({ timeout: 20000 });
  await page.evaluate(() => window.scrollTo(0, 900));
  await sleep(600);
  const searchBox = await box(
    page
      .getByRole('searchbox')
      .or(page.getByRole('textbox', { name: /Search/ }))
      .first(),
  );
  check(
    `${label}: Search's bar, pinned, is below the status bar${narrow ? ' and the top bar' : ''}`,
    searchBox.y >= insets.top + (narrow ? 56 : 0),
    `at ${Math.round(searchBox.y)}`,
  );
  await page.screenshot({ path: path.join(outDir, `home-screen-search-${label}.png`) });
  await axeCheck(page, `${label}: Search, scrolled`);
  await noSideScroll(page, viewport, `${label}: Search`);

  // The item dialog fills a phone's screen: its title below the status bar, its Save above the home indicator.
  if (narrow) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const price = page.locator('ss-sub-card ss-price button').first();
    await price.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: /New list/ }).click();
    const dialog = page.locator('mat-dialog-container');
    await dialog.waitFor({ timeout: 20000 });
    await sleep(800);
    const title = await box(dialog.locator('h2').first());
    const save = await box(dialog.getByRole('button', { name: /^(Add to list|Save)$/ }).first());
    check(
      `${label}: the item dialog's title is below the status bar, and its button above the home indicator`,
      title.y >= insets.top && save.y + save.height <= viewport.height - insets.bottom,
      `title at ${Math.round(title.y)}, button ends at ${Math.round(save.y + save.height)}`,
    );
    await page.screenshot({ path: path.join(outDir, `home-screen-dialog-${label}.png`) });
    await axeCheck(page, `${label}: the item dialog, full screen`);
  }
  await context.close();

  // A browser tab: no insets, and the shell as before.
  const tab = await newPage(browser, `${label} tab`, { colorScheme, viewport, installed: false });
  await getStarted(tab.page);
  if (narrow) {
    const bar = await box(tab.page.locator('header.top-bar'));
    check(
      `${label}, a browser tab: the top bar is 56 px high at the top, as before`,
      bar.y === 0 && Math.round(bar.height) === 57,
      `${bar.y}, ${bar.height}`,
    );
  } else {
    const logo = await box(tab.page.locator('ss-sidebar ss-logo'));
    check(`${label}, a browser tab: the logo where it was`, Math.round(logo.y) === 16, `${logo.y}`);
  }
  await tab.context.close();
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [WIDE, NARROW]) await run(browser, colorScheme, viewport);
  }
  await browser.close();
  check('no console errors or warnings', consoleProblems.length === 0, consoleProblems.join(' | '));
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  for (const line of consoleProblems) console.error(`console: ${line}`);
  process.exit(1);
});

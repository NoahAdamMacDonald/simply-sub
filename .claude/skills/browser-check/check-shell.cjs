// Drives the M0.5 app shell in the system Edge: screenshots, navigation, keyboard, scrolling, axe. Each new context
// completes the first-run dialog (M4.2) first.
// See SKILL.md. Usage: node check-shell.cjs <deps dir with playwright-core + axe-core> <output dir> <base url>
const fs = require('fs');
const path = require('path');

const [depsDir, outDir, baseUrl] = process.argv.slice(2);
const { chromium } = require(path.join(depsDir, 'node_modules', 'playwright-core'));
const axePath = path.join(depsDir, 'node_modules', 'axe-core', 'axe.min.js');

const WIDE = { width: 1280, height: 800 };
const NARROW = { width: 360, height: 740 };
const SIDEBAR = ['Home', 'Lists', 'Payment', 'Features', 'Calendar', 'Search', 'Settings'];
/** The pages whose heading isn't their link's name (M6.2, M6.7). */
const HEADINGS = { Lists: 'Subscription Lists', Features: 'Your feature ranks' };
const URLS = {
  Home: '/',
  Lists: '/lists',
  Payment: '/payment',
  Features: '/features',
  Calendar: '/calendar',
  Search: '/search',
  Settings: '/settings',
};

const checks = [];
const consoleProblems = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(baseUrl);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`No server at ${baseUrl}`);
}

async function open(browser, viewport, colorScheme, url = '/') {
  const context = await browser.newContext({ viewport, colorScheme });
  // GET /fx (M4.4), answered here: there's no Worker behind the dev proxy, and the settings' currency asks for it.
  await context.route('**/api/v1/fx?**', (route) => {
    const base = new URL(route.request().url()).searchParams.get('base') ?? 'CAD';
    return route.fulfill({
      json: {
        data: {
          base,
          date: '2026-10-26',
          source: 'European Central Bank via Frankfurter',
          rates: { CAD: 1, EUR: 0.6372, GBP: 0.5571, USD: 0.7243 },
        },
        meta: { fetchedAt: '2026-10-26T06:00:02Z', stale: false },
      },
    });
  });
  const page = await context.newPage();
  const label = `${colorScheme} ${viewport.width}px`;
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  await page.goto(baseUrl + url);
  await page.locator('main h1').waitFor();
  await completeFirstRun(page);
  return { context, page };
}

// A new context has no settings, so the first-run dialog (M4.2) asks first. Playwright's default locale is en-US,
// where nothing is required.
async function completeFirstRun(page) {
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Get started' }).click();
  await dialog.waitFor({ state: 'detached' });
}

const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
const nav = (page) => page.getByRole('navigation', { name: 'Main' });
const heading = (page) => page.locator('main h1').textContent();
const pathOf = (page) => new URL(page.url()).pathname;
const menuButton = (page) => page.getByRole('button', { name: 'Menu' });

async function currentLinks(page) {
  return nav(page)
    .locator('[aria-current="page"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? e.textContent.trim()));
}

async function focused(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return 'body';
    const name = (el.getAttribute('aria-label') ?? el.textContent ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    return `${el.tagName.toLowerCase()} "${name}"`;
  });
}

// ☰'s aria-expanded follows the drawer one render later (about 15 ms), so wait for that too.
async function drawerSettled(page, open) {
  await page.waitForFunction((wantOpen) => {
    const drawer = document.querySelector('mat-sidenav');
    const menu = document.querySelector('button[aria-label="Menu"]');
    return (
      drawer &&
      drawer.classList.contains('mat-drawer-opened') === wantOpen &&
      !drawer.classList.contains('mat-drawer-animating') &&
      (!menu || menu.getAttribute('aria-expanded') === String(wantOpen))
    );
  }, open);
}

// After a keyboard open, the drawer moves focus inside only once its slide-in has finished.
async function drawerHasFocus(page) {
  await drawerSettled(page, true);
  await page.waitForFunction(() =>
    document.querySelector('mat-sidenav').contains(document.activeElement),
  );
}

async function axe(page, label) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document);
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target.join(' ')),
    }));
  });
  check(
    `axe: ${label}`,
    violations.length === 0,
    violations.map((v) => `${v.id} (${v.impact}) on ${v.nodes.join(', ')}`).join('; '),
  );
}

async function noHorizontalScroll(page, label) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  check(
    `no horizontal scroll: ${label}`,
    scrollWidth <= innerWidth,
    `${scrollWidth} <= ${innerWidth}`,
  );
}

async function screenshotsAndAxe(browser) {
  for (const scheme of ['light', 'dark']) {
    const wide = await open(browser, WIDE, scheme);
    await shot(wide.page, `${scheme}-1280-home`);
    await axe(wide.page, `${scheme} 1280 home`);
    for (const [url, name] of [
      ['/settings', 'settings'],
      ['/lists/abc/optimize', 'list-optimize'],
      ['/custom', 'custom'],
      ['/no/such/page', 'not-found'],
    ]) {
      await wide.page.goto(baseUrl + url);
      await wide.page.locator('main h1').waitFor();
      await shot(wide.page, `${scheme}-1280-${name}`);
    }
    await axe(wide.page, `${scheme} 1280 not-found`);
    await wide.context.close();

    const narrow = await open(browser, NARROW, scheme);
    await shot(narrow.page, `${scheme}-360-home`);
    await axe(narrow.page, `${scheme} 360 home (drawer closed)`);
    await noHorizontalScroll(narrow.page, `${scheme} 360 home`);
    await menuButton(narrow.page).click();
    await drawerSettled(narrow.page, true);
    await shot(narrow.page, `${scheme}-360-drawer`);
    await axe(narrow.page, `${scheme} 360 drawer open`);
    await narrow.page.keyboard.press('Escape');
    await drawerSettled(narrow.page, false);
    await narrow.page.goto(baseUrl + '/no/such/page');
    await narrow.page.locator('main h1').waitFor();
    await shot(narrow.page, `${scheme}-360-not-found`);
    await noHorizontalScroll(narrow.page, `${scheme} 360 not-found`);
    await axe(narrow.page, `${scheme} 360 not-found`);
    await narrow.page.goto(baseUrl + '/custom');
    await narrow.page.locator('main h1').waitFor();
    await noHorizontalScroll(narrow.page, `${scheme} 360 custom subscriptions`);
    await narrow.context.close();
  }
}

async function navigation(browser) {
  const { context, page } = await open(browser, WIDE, 'light', '/no/such/page');
  check('no link is current on the not-found page', (await currentLinks(page)).length === 0);
  for (const name of SIDEBAR) {
    await nav(page).getByRole('link', { name, exact: true }).click();
    await page.waitForURL((url) => url.pathname === URLS[name]);
    const title = await page.title();
    const current = await currentLinks(page);
    check(
      `wide: ${name} link opens ${URLS[name]}`,
      (await heading(page)) === (HEADINGS[name] ?? name) &&
        current.length === 1 &&
        current[0] === name,
      `h1="${await heading(page)}" current=${JSON.stringify(current)} title="${title}"`,
    );
  }
  await context.close();
}

async function keyboardWide(browser) {
  const { context, page } = await open(browser, WIDE, 'light', '/lists');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  const box = await skip.boundingBox();
  check(
    'wide: first Tab reaches the skip link, and it becomes visible',
    (await focused(page)) === 'a "Skip to main content"' && box !== null && box.y >= 0,
    `focused ${await focused(page)}, top ${box?.y}`,
  );
  await shot(page, 'keyboard-skip-link');
  await page.keyboard.press('Enter');
  check(
    'wide: Enter on the skip link focuses <main> without navigating',
    (await page.evaluate(() => document.activeElement?.id)) === 'main' && pathOf(page) === '/lists',
    `focused ${await focused(page)}, path ${pathOf(page)}`,
  );

  await page.goto(baseUrl + '/lists');
  await page.locator('main h1').waitFor();
  const order = [];
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press('Tab');
    order.push(await focused(page));
  }
  const expected = [
    'a "Skip to main content"',
    'a "Home"',
    'a "Lists"',
    'a "Payment"',
    'a "Features"',
    'a "Calendar"',
    'a "Search"',
    'a "Settings"',
    'button "Dark theme"',
  ];
  check('wide: Tab order', JSON.stringify(order) === JSON.stringify(expected), order.join(' > '));

  // Back to "Calendar" (three Shift+Tabs from the theme toggle) and open it with Enter.
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+Tab');
  await shot(page, 'keyboard-focus-ring-light');
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => url.pathname === '/calendar');
  check('wide: Enter on a nav link navigates', (await heading(page)) === 'Calendar');

  // Theme toggle with Space, then look at the focus ring in dark mode.
  for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
  check('wide: reached the theme toggle', (await focused(page)) === 'button "Dark theme"');
  await page.keyboard.press('Space');
  const switched = await page
    .waitForFunction(() => document.documentElement.dataset['theme'] === 'dark', null, {
      timeout: 2000,
    })
    .then(() => true)
    .catch(() => false);
  check('wide: Space on the toggle switches to dark', switched);
  await shot(page, 'keyboard-toggle-focus-dark');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await shot(page, 'keyboard-focus-ring-dark');
  await page.reload();
  await page.locator('main h1').waitFor();
  check(
    'theme persists across a reload',
    (await page.evaluate(() => document.documentElement.dataset['theme'])) === 'dark',
  );

  // Focus rings on Material buttons: Tab into the not-found page's buttons, in both themes.
  for (const scheme of ['dark', 'light']) {
    await page.goto(baseUrl + '/no/such/page');
    await page.locator('main h1').waitFor();
    let onPageButton = false;
    for (let i = 0; i < 15 && !onPageButton; i++) {
      await page.keyboard.press('Tab');
      onPageButton = await page.evaluate(() => !!document.activeElement?.closest('main a'));
    }
    check(`${scheme}: Tab reaches the not-found page's Home button`, onPageButton);
    await shot(page, `keyboard-not-found-button-${scheme}`);
    await page.keyboard.press('Shift+Tab');
    await shot(page, `keyboard-theme-toggle-${scheme}`);
    if (scheme === 'dark') {
      await page.keyboard.press('Space');
      await page.waitForFunction(() => document.documentElement.dataset['theme'] === 'light');
    }
  }
  await context.close();
}

async function keyboardNarrow(browser) {
  const { context, page } = await open(browser, NARROW, 'light', '/');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  check('narrow: second Tab reaches ☰', (await focused(page)) === 'button "Menu"');
  check(
    'narrow: ☰ says collapsed',
    (await menuButton(page).getAttribute('aria-expanded')) === 'false',
  );
  await page.keyboard.press('Enter');
  await drawerHasFocus(page);
  check(
    'narrow: Enter opens the drawer and focus moves into it',
    (await menuButton(page).getAttribute('aria-expanded')) === 'true' &&
      (await focused(page)) === 'a "Home"',
    `focused ${await focused(page)}`,
  );
  const trapped = [];
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press('Tab');
    trapped.push(await focused(page));
  }
  check(
    'narrow: Tab stays inside the open drawer',
    trapped.every((f) => f !== 'button "Menu"' && f !== 'body'),
    trapped.join(' > '),
  );

  // From wherever focus is, find "Calendar" and press Enter.
  await nav(page).getByRole('link', { name: 'Calendar' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => url.pathname === '/calendar');
  await drawerSettled(page, false);
  check(
    'narrow: navigating closes the drawer and returns focus to ☰',
    (await focused(page)) === 'button "Menu"' &&
      (await menuButton(page).getAttribute('aria-expanded')) === 'false',
    `focused ${await focused(page)}`,
  );
  await shot(page, 'keyboard-narrow-after-nav');

  await page.keyboard.press('Enter');
  await drawerHasFocus(page);
  await page.keyboard.press('Escape');
  await drawerSettled(page, false);
  check(
    'narrow: Escape closes the drawer and returns focus to ☰',
    (await focused(page)) === 'button "Menu"' &&
      (await menuButton(page).getAttribute('aria-expanded')) === 'false',
    `focused ${await focused(page)}`,
  );

  // The same page's link closes the drawer too.
  await page.keyboard.press('Enter');
  await drawerHasFocus(page);
  await nav(page).getByRole('link', { name: 'Calendar' }).focus();
  await page.keyboard.press('Enter');
  await drawerSettled(page, false);
  check(
    "narrow: the current page's link closes the drawer",
    (await focused(page)) === 'button "Menu"',
    `focused ${await focused(page)}`,
  );

  // Mouse: open, then tap the backdrop.
  await menuButton(page).click();
  await drawerSettled(page, true);
  await page.mouse.click(340, 400);
  await drawerSettled(page, false);
  check('narrow: tapping the backdrop closes the drawer', true);

  // Resize past the breakpoint and back.
  await page.setViewportSize(WIDE);
  await drawerSettled(page, true);
  check(
    'resize to 1280: sidebar shown beside the content, no ☰',
    (await menuButton(page).count()) === 0 &&
      (await page.locator('mat-sidenav.mat-drawer-side').count()) === 1,
  );
  await page.setViewportSize(NARROW);
  await drawerSettled(page, false);
  check('resize back to 360: drawer closed, ☰ back', (await menuButton(page).count()) === 1);
  await context.close();
}

async function scrolling(browser) {
  for (const viewport of [WIDE, NARROW]) {
    const { context, page } = await open(browser, viewport, 'light', '/lists');
    await page.evaluate(() => {
      const filler = document.createElement('div');
      filler.style.height = '3000px';
      filler.id = 'filler';
      document.querySelector('main').append(filler);
    });
    await page.mouse.wheel(0, 1200);
    await page.waitForFunction(() => window.scrollY > 0);
    const state = await page.evaluate(() => ({
      scrollY: window.scrollY,
      sidebarTop: document.querySelector('mat-sidenav').getBoundingClientRect().top,
      topBarTop: document.querySelector('header')?.getBoundingClientRect().top ?? null,
    }));
    const label = `${viewport.width}px`;
    check(
      `${label}: the window scrolls; ${viewport === WIDE ? 'the sidebar stays put' : 'the top bar sticks'}`,
      state.scrollY > 0 && (viewport === WIDE ? state.sidebarTop === 0 : state.topBarTop === 0),
      JSON.stringify(state),
    );
    await shot(page, `scrolled-${viewport.width}`);
    if (viewport === WIDE) {
      const before = state.scrollY;
      await nav(page).getByRole('link', { name: 'Search', exact: true }).click();
      await page.waitForURL((url) => url.pathname === '/search');
      const afterNav = await page.evaluate(() => window.scrollY);
      await page.goBack();
      await page.waitForURL((url) => url.pathname === '/lists');
      await page
        .waitForFunction((y) => Math.abs(window.scrollY - y) < 2, before, {
          timeout: 3000,
        })
        .catch(() => undefined);
      const afterBack = await page.evaluate(() => window.scrollY);
      check(
        'router: top of the page after navigating, position restored on Back',
        afterNav === 0 && Math.abs(afterBack - before) < 2,
        `before ${before}, after nav ${afterNav}, after back ${afterBack}`,
      );
    }
    await context.close();
  }
}

async function errorSnackbar(browser) {
  for (const scheme of ['light', 'dark']) {
    const { context, page } = await open(browser, WIDE, scheme, '/');
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('Simulated failure (browser check)');
      });
    });
    const message = page.getByText('Something went wrong');
    await message.waitFor();
    check(`${scheme}: an uncaught error shows "Something went wrong"`, await message.isVisible());
    // While opening, the snackbar fades in and keeps its content (the Dismiss button too) in an
    // aria-hidden wrapper until it moves it into the live region. axe flags both, so scan after.
    await page.waitForFunction(() => {
      const button = document.querySelector('.mat-mdc-snack-bar-container button');
      if (!button || button.closest('[aria-hidden="true"]')) return false;
      for (let el = button; el && el !== document.body; el = el.parentElement) {
        if (getComputedStyle(el).opacity !== '1') return false;
      }
      return true;
    });
    await shot(page, `${scheme}-error-snackbar`);
    await axe(page, `${scheme} 1280 with error snackbar`);
    await context.close();
  }
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    await screenshotsAndAxe(browser);
    await navigation(browser);
    await keyboardWide(browser);
    await keyboardNarrow(browser);
    await scrolling(browser);
    await errorSnackbar(browser);
  } finally {
    await browser.close();
  }
  const expectedErrors = consoleProblems.filter((line) => line.includes('Simulated failure'));
  const otherProblems = consoleProblems.filter((line) => !line.includes('Simulated failure'));
  console.log(
    `\nConsole: ${expectedErrors.length} expected error line(s) from the simulated failure.`,
  );
  check(
    'no unexpected console errors or warnings',
    otherProblems.length === 0,
    otherProblems.join('\n'),
  );
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
  process.exitCode = failed.length ? 1 : 0;
})().catch((error) => {
  console.error(error);
  process.exitCode = 2;
});

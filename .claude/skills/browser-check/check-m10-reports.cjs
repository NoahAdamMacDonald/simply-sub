// M10.11 in the system Edge, under `wrangler dev` with the production build and both local databases ready
// (`npm -w apps/api run db:seed:local` for the catalog's plans, `npm -w apps/api run db:user:migrate:local` for the
// reports' table), for a Canadian in Alberta, in both themes at 1280 and 360 px: Search's Netflix card expanded by
// keyboard (its first plan, Standard with ads, at CA$7.99), Tab to Report a wrong price beside the price's date and
// Enter, which loads the dialog's chunk only then;
// focus on the first choice, axe with the dialog open, no horizontal scroll; by keyboard a different price typed and
// Send report, then the thanks, focus back on the button, and the report in the local user database. One run sends
// offline first (it says so and sends nothing), one reports "It's not sold any more" with the arrow keys. A report
// refused as one too many this minute (3 an IP) says so in words, and is sent again in the next minute. Then Mullvad's
// card, whose plan has five billing periods in euros: its dialog asks which, filled in with the catalog's monthly price,
// and choosing Yearly by keyboard fills in that one's (axe, no horizontal scroll), and Escape sends nothing. GET /fx is
// answered with fixed rates.
// Usage: node check-m10-reports.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
const { execSync } = require('child_process');
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
const apiDir = path.resolve(__dirname, '..', '..', '..', 'apps', 'api');
const checks = [];
const consoleProblems = [];
function check(name, ok, detail = '') {
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** GET /fx's answer for a Canadian, so no request leaves the machine. */
const rates = {
  data: {
    base: 'CAD',
    date: '2026-10-26',
    source: 'European Central Bank via Frankfurter',
    rates: { CHF: 0.581, EUR: 0.6372, GBP: 0.5571, SEK: 7.097, USD: 0.7243 },
  },
  meta: { fetchedAt: '2026-10-26T06:00:02Z', stale: false },
};
/** The plan the card's details show, and its catalog price in Canada. */
const plan = { id: 'netflix.standard-ads', title: 'Netflix Standard with ads', price: '7.99' };

/** Runs `sql` on the local user database, as wrangler dev keeps it, and gives the rows. */
function userDb(sql) {
  const out = execSync(
    `npx wrangler d1 execute simply-sub-user --local --json --command "${sql}"`,
    {
      cwd: apiDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
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

async function until(what, condition, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await condition();
    if (value) return value;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function newPage(browser, label, { colorScheme, viewport }) {
  // The production build's service worker (M10.5) would answer requests Playwright can't route or see.
  const context = await browser.newContext({
    locale: 'en-CA',
    colorScheme,
    viewport,
    serviceWorkers: 'block',
  });
  await context.route('**/api/v1/fx?**', (route) => route.fulfill({ json: rates }));
  const page = await context.newPage();
  page.on('console', (msg) => {
    const blockedWorker = msg.text() === 'Service Worker registration blocked by Playwright';
    // A report refused as one too many this minute: the browser logs the 429 itself, and the dialog says so in words,
    // which is what's checked.
    const refusedReport =
      msg.location().url.includes('/api/v1/reports') && /status of 429/.test(msg.text());
    if ((msg.type() === 'error' || msg.type() === 'warning') && !blockedWorker && !refusedReport) {
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  return { context, page };
}

/** Completes the first-run dialog for a Canadian in Alberta. */
async function firstRun(page) {
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

/** The focused element's role and accessible name, as an accessibility snapshot's first line gives them. */
async function stop(page) {
  const snapshot = await page.locator(':focus').ariaSnapshot();
  return snapshot.split('\n')[0].replace(/^- /, '').replace(/:$/, '');
}

/** Tabs until the focused element's accessible name is `name`, at most `most` times; the stops on the way. */
async function tabTo(page, name, most = 60) {
  const stops = [];
  for (let i = 0; i < most; i++) {
    await page.keyboard.press('Tab');
    const now = await stop(page);
    stops.push(now);
    if (now.includes(`"${name}"`)) return stops;
  }
  throw new Error(`No Tab stop named ${name}: ${stops.slice(-8).join(' → ')}`);
}

async function axeCheck(page, label) {
  await sleep(600);
  await page.evaluate(axeSource);
  const result = await page.evaluate(() => axe.run(document));
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

/** Waits for the start of the next minute: the report limit's windows are the wall clock's minutes. */
async function nextMinute() {
  await sleep(60_000 - (Date.now() % 60_000) + 1000);
}

const alert = (page) => page.locator('ss-report-price-dialog [role="alert"]');

/** Presses Enter on Send report (focused), sending again in the next minute when it was one too many. */
async function sendNow(page, label) {
  await page.keyboard.press('Enter');
  const busy = await alert(page)
    .filter({ hasText: 'Too many reports' })
    .waitFor({ timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (!busy) return;
  check(
    `${label}: one report too many this minute is refused in words`,
    (await alert(page).innerText()).trim() ===
      'Too many reports were sent from here just now. Try again in a minute.',
  );
  await nextMinute();
  await page.locator('ss-report-price-dialog button[type="submit"]').focus();
  await page.keyboard.press('Enter');
}

/** Mullvad's card shows several billing periods: the dialog asks which, and fills in that one's price. */
async function periods(page, viewport, label) {
  const mullvad = page.locator('ss-sub-card', {
    has: page.getByRole('heading', { name: 'Mullvad VPN', exact: true }),
  });
  await mullvad.locator('button.expand').focus();
  await page.keyboard.press('Enter');
  await mullvad.locator('ss-plan-details').waitFor({ timeout: 10000 });
  await sleep(600);
  await mullvad.getByRole('button', { name: 'Report a wrong price' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.locator('ss-report-price-dialog');
  await dialog.waitFor({ timeout: 10000 });
  await until('focus in the dialog', async () => (await stop(page)).startsWith('radio'));
  await tabTo(page, 'Billed', 3);
  const select = dialog.locator('mat-select');
  const amount = dialog.locator('.amount input');
  const monthly = [(await select.innerText()).trim(), await amount.inputValue()];
  check(
    `${label}: Mullvad's several periods: Billed asks which, the monthly price in euros filled in`,
    monthly[0] === 'Monthly' &&
      Number(monthly[1]) > 0 &&
      (await dialog.locator('ss-choice-field input').inputValue()).startsWith('EUR'),
    `${monthly.join(', ')} ${await dialog.locator('ss-choice-field input').inputValue()}`,
  );
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: 'Yearly' }).waitFor({ timeout: 5000 });
  // The menu takes the keys once it has opened: down until Yearly is the active option.
  for (let i = 0; i < 8; i++) {
    const active = await page
      .locator('mat-option.mat-mdc-option-active')
      .innerText()
      .catch(() => '');
    if (active.trim() === 'Yearly') break;
    await page.keyboard.press('ArrowDown');
    await sleep(150);
  }
  await page.keyboard.press('Enter');
  await page.locator('mat-option').first().waitFor({ state: 'detached' });
  const yearly = [(await select.innerText()).trim(), await amount.inputValue()];
  check(
    `${label}: choosing Yearly by keyboard fills in the yearly price`,
    yearly[0] === 'Yearly' && Number(yearly[1]) > Number(monthly[1]),
    yearly.join(', '),
  );
  await axeCheck(page, `${label}: the report dialog with its billing periods`);
  await noSideScroll(page, viewport, `${label}: the report dialog with its billing periods`);
  await page.screenshot({
    path: path.join(outDir, `report-periods-${label.replace(' ', '-')}.png`),
  });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached', timeout: 5000 });
}

/** One run: a report from Netflix Standard's card, by keyboard. `kind` is price, offline (then price) or discontinued. */
async function reportRun(browser, colorScheme, viewport, width, kind) {
  const label = `${colorScheme} ${width}`;
  const { context, page } = await newPage(browser, label, { colorScheme, viewport });
  await page.goto(`${baseUrl}search`);
  await firstRun(page);
  const netflix = page.locator('ss-sub-card', {
    has: page.getByRole('heading', { name: 'Netflix', exact: true }),
  });
  await netflix.waitFor({ timeout: 20000 });
  await netflix.locator('button.expand').focus();
  await page.keyboard.press('Enter');
  await netflix.locator('ss-plan-details').waitFor({ timeout: 10000 });
  await sleep(600);

  const reportButton = netflix.getByRole('button', { name: 'Report a wrong price' });
  const beside = await reportButton.evaluate(
    (button) => button.closest('.checked-row')?.querySelector('.checked')?.textContent ?? '',
  );
  check(
    `${label}: Report a wrong price is beside the price's date`,
    /Price checked/.test(beside),
    beside.replace(/\s+/g, ' ').trim(),
  );
  await tabTo(page, 'Report a wrong price');
  const scripts = [];
  const record = (request) => request.resourceType() === 'script' && scripts.push(request.url());
  page.on('request', record);
  await page.keyboard.press('Enter');
  const dialog = page.locator('ss-report-price-dialog');
  await dialog.waitFor({ timeout: 10000 });
  page.off('request', record);
  check(
    `${label}: the dialog's code loads as it opens (a lazy chunk)`,
    scripts.some((url) => /chunk-.*\.js$/.test(url)),
    `${scripts.length} script${scripts.length === 1 ? '' : 's'}`,
  );
  const intro = (await dialog.locator('#report-about').innerText()).replace(/\s+/g, ' ').trim();
  check(
    `${label}: it says what it reports on`,
    intro.startsWith(`${plan.title} in Canada.`),
    intro,
  );
  // The dialog moves focus in once it has opened.
  const first = await until('focus in the dialog', async () => {
    const now = await stop(page);
    return now.startsWith('radio') && now;
  }).catch(() => stop(page));
  check(
    `${label}: focus starts on the first choice, the price is different`,
    first.startsWith('radio "The price is different"'),
    first,
  );
  await axeCheck(page, `${label}: the report dialog`);
  await noSideScroll(page, viewport, `${label}: the report dialog`);
  await page.screenshot({
    path: path.join(outDir, `report-dialog-${label.replace(' ', '-')}.png`),
  });

  if (kind === 'discontinued') {
    await page.keyboard.press('ArrowDown');
    check(
      `${label}: an arrow key chooses "It's not sold any more"`,
      (await stop(page)).startsWith('radio "It’s not sold any more"') &&
        (await dialog.locator('.amount').count()) === 0,
      await stop(page),
    );
  } else {
    const price = await tabTo(page, 'Price', 4);
    check(
      `${label}: Tab reaches the price, filled in with the catalog's`,
      (await page.locator(':focus').inputValue()) === plan.price,
      price.join(' → '),
    );
    await page.keyboard.press('Control+A');
    await page.keyboard.type('20.99');
  }
  await tabTo(page, 'Send report', 8);
  if (kind === 'offline') {
    await context.setOffline(true);
    await page.keyboard.press('Enter');
    await alert(page).waitFor({ timeout: 5000 });
    check(
      `${label}: offline, it says so and sends nothing`,
      (await alert(page).innerText()).trim() ===
        'You’re offline, so nothing was sent. Send it once you’re back online.',
      (await alert(page).innerText()).trim(),
    );
    await axeCheck(page, `${label}: the report dialog saying it's offline`);
    await context.setOffline(false);
    await sleep(500);
  }
  await sendNow(page, label);
  await dialog.waitFor({ state: 'detached', timeout: 10000 });
  const thanks = page.locator('.mat-mdc-snack-bar-container');
  await thanks.waitFor({ timeout: 5000 });
  check(
    `${label}: sent, it thanks the user and says when the page is checked`,
    (await thanks.innerText()).trim() === 'Thanks. Netflix’s page will be checked tonight.',
    (await thanks.innerText()).trim(),
  );
  const back = await until('focus back on the button', async () => {
    const now = await stop(page);
    return now.includes('"Report a wrong price"') && now;
  }).catch(async () => stop(page));
  check(
    `${label}: focus goes back to Report a wrong price`,
    back.includes('Report a wrong price'),
    back,
  );
  await noSideScroll(page, viewport, `${label}: the thanks`);
  await axeCheck(page, `${label}: the thanks`);
  // Fading out, its text is paler than it shows: the next axe run waits until it's gone.
  await thanks.waitFor({ state: 'detached', timeout: 10000 });
  await periods(page, viewport, label);
  await context.close();
}

(async () => {
  await waitForServer();
  userDb('DELETE FROM price_reports');
  userDb("DELETE FROM daily_counts WHERE kind = 'report'");
  const browser = await chromium.launch({ channel: 'msedge' });
  const runs = [
    ['light', WIDE, 'wide', 'offline'],
    ['light', NARROW, 'narrow', 'price'],
    ['dark', WIDE, 'wide', 'discontinued'],
    ['dark', NARROW, 'narrow', 'price'],
  ];
  for (const [colorScheme, viewport, width, kind] of runs) {
    await reportRun(browser, colorScheme, viewport, width, kind);
  }
  await browser.close();

  const rows = userDb(
    `SELECT plan, country, problem, price, count FROM price_reports WHERE plan = '${plan.id}' ORDER BY problem`,
  );
  const price = JSON.stringify({
    amount: 20.99,
    currency: 'CAD',
    interval: 'month',
    intervalCount: 1,
  });
  check(
    'the local user database counted each report: 3 of a different price and 1 that it isn’t sold any more',
    JSON.stringify(rows) ===
      JSON.stringify([
        { plan: plan.id, country: 'CA', problem: 'discontinued', price: '', count: 1 },
        { plan: plan.id, country: 'CA', problem: 'price', price, count: 3 },
      ]),
    JSON.stringify(rows),
  );
  check(
    'no console errors or warnings (CSP and Trusted Types among them)',
    consoleProblems.length === 0,
    consoleProblems.join(' | '),
  );
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  for (const line of consoleProblems) console.error(`console: ${line}`);
  process.exit(1);
});

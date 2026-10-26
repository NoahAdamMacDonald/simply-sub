// M4.4 in the system Edge: ss-price on the /dev/components gallery (dev builds only) and FxStore's rates, for a
// Canadian, a US user with no rate and a UK user, in both themes at 1280 and 360 px, by keyboard, with axe. GET /fx
// is answered with the API contract's example rates, so every converted amount is known.
// Usage: node check-prices.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

/** GET /fx's example body (docs/api-output-examples.json), in CAD, and the same rates rebased for USD and GBP. */
const cadRates = { AUD: 1.098, CHF: 0.581, EUR: 0.664, GBP: 0.5571, JPY: 108.42, USD: 0.7243 };
function fxBody(base) {
  const perCad = (currency) => (currency === 'CAD' ? 1 : cadRates[currency]);
  const rates = Object.fromEntries(
    ['CAD', ...Object.keys(cadRates)]
      .filter((currency) => currency !== base)
      .map((currency) => [currency, Number((perCad(currency) / perCad(base)).toPrecision(6))]),
  );
  return {
    data: { base, date: '2026-10-21', source: 'European Central Bank via Frankfurter', rates },
    meta: { fetchedAt: '2026-10-22T06:00:02Z', stale: false },
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

async function until(what, condition, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await condition();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function newContext(browser, { locale, colorScheme = 'light', viewport = WIDE }) {
  const context = await browser.newContext({ locale, colorScheme, viewport });
  const fxRequests = [];
  await context.route('**/api/v1/fx?**', (route) => {
    const base = new URL(route.request().url()).searchParams.get('base');
    fxRequests.push(base);
    return route.fulfill({ json: fxBody(base) });
  });
  return { context, fxRequests };
}

async function newPage(context, label) {
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  return page;
}

/** Completes the first-run dialog: a Canadian picks Ontario; en-US and en-GB need nothing. */
async function firstRun(page, province) {
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor({ timeout: 20000 });
  if (province) {
    await page
      .locator('mat-form-field', { has: page.locator('mat-label', { hasText: 'Province' }) })
      .locator('.mat-mdc-text-field-wrapper')
      .click();
    await page.getByRole('option', { name: province, exact: true }).click();
    await page.locator('.cdk-overlay-pane mat-option').first().waitFor({ state: 'detached' });
  }
  await page.getByRole('button', { name: 'Get started' }).click();
  await dialog.waitFor({ state: 'detached' });
}

/** What a price cell shows on screen: no icon ligatures, no screen-reader-only words. */
async function shownIn(locator) {
  return locator.evaluate((element) => {
    const copy = element.cloneNode(true);
    copy.querySelectorAll('mat-icon, .visually-hidden').forEach((node) => node.remove());
    return copy.textContent.replace(/\s+/g, ' ').trim();
  });
}

/** The fixed cases' "Not clickable" column, by case name. */
async function caseTexts(page) {
  await page.locator('tbody tr').first().waitFor();
  const rows = page.locator('tbody tr');
  const result = {};
  for (let i = 0; i < (await rows.count()); i++) {
    const row = rows.nth(i);
    result[(await row.locator('th').textContent()).trim()] = await shownIn(
      row.locator('td').nth(1),
    );
  }
  return result;
}

async function storedRates(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('simply-sub');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const all = db.transaction('fxRates').objectStore('fxRates').getAll();
          all.onsuccess = () => {
            db.close();
            resolve(all.result.map((row) => `${row.rates.base} ${row.rates.date}`));
          };
          all.onerror = () => reject(all.error);
        };
      }),
  );
}

async function axe(page, label) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(axeSource);
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

const tooltip = (page) => page.locator('.mat-mdc-tooltip-surface, .mdc-tooltip__surface').first();

function expectCases(actual, expected, who) {
  for (const [name, text] of Object.entries(expected)) {
    check(`${who}: ${name} → "${text}"`, actual[name] === text, actual[name]);
  }
}

async function canadian(browser) {
  const { context, fxRequests } = await newContext(browser, { locale: 'en-CA' });
  const page = await newPage(context, 'Canadian');
  await page.goto(`${baseUrl}dev/components`);
  await firstRun(page, 'Ontario');
  await page.getByRole('heading', { name: 'Components' }).waitFor();
  check(
    'the gallery is at /dev/components, titled',
    (await page.title()) === 'Components · Simply Sub',
    await page.title(),
  );

  expectCases(
    await caseTexts(page),
    {
      'In your currency': '$18.99 / mo + tax',
      Converted: '≈ $7.53 / mo + tax',
      'Includes tax everywhere (Mullvad)': '≈ $7.53 / mo incl. tax',
      'No exchange rate yet': 'US$9.99 / mo + tax',
      Free: 'Free',
      Yearly: '$169.99 / year + tax',
      'Every 3 months': '$45.00 / 3 mo + tax',
      'Every 30 days': '$12.00 / 30 days + tax',
      'Bought in the US': '≈ $11.03 / mo',
    },
    'Ontario',
  );

  // FxStore: fetched in CAD and kept in IndexedDB.
  await until('rates stored', async () => (await storedRates(page)).length === 1);
  check(
    'FxStore: rates fetched in CAD and stored',
    (await storedRates(page)).join() === 'CAD 2026-10-21' && fxRequests.includes('CAD'),
    `${await storedRates(page)} after ${fxRequests}`,
  );

  // The catalog's own prices, with today's (example) rates: Mullvad converted and tax-included, Netflix native.
  const plan = (name) =>
    page.locator('.plan', {
      has: page.locator('.plan-name', { hasText: new RegExp(`^${name}$`) }),
    });
  await plan('Mullvad VPN · Mullvad VPN').waitFor({ timeout: 15000 });
  const mullvad = await shownIn(plan('Mullvad VPN · Mullvad VPN'));
  check(
    'catalog: Mullvad is converted and says "incl. tax"',
    mullvad.includes('≈ $7.53 / mo incl. tax') && !mullvad.includes('+ tax'),
    mullvad,
  );
  const netflix = await shownIn(plan('Netflix · Standard'));
  check(
    'catalog: Netflix is native with "+ tax"',
    /^Netflix · Standard ?\$\d+\.\d\d \/ mo \+ tax$/.test(netflix),
    netflix,
  );

  // A converted clickable price: its tooltip on hover, and a click picks it.
  const convertedRow = page.locator('tbody tr', {
    has: page.locator('th', { hasText: /^Converted$/ }),
  });
  await convertedRow.locator('button').hover();
  await until('hover tooltip', async () => (await tooltip(page).count()) > 0);
  const hoverText = (await tooltip(page).textContent()).trim();
  check(
    'tooltip on hover',
    hoverText === "Converted from 5.00 EUR at 1.506 on 2026-10-21. You'll be charged in EUR.",
    hoverText,
  );
  await convertedRow.locator('button').click();
  await until('picked', async () =>
    (await page.locator('.picked').textContent()).includes('Picked'),
  );
  check(
    'a click picks the price',
    (await page.locator('.picked').textContent()).trim() === 'Picked $7.53 / mo',
    await page.locator('.picked').textContent(),
  );
  await page.mouse.move(0, 0);

  // Keyboard: Tab from the Converted button to the next control reaches the not-clickable row's currency icon.
  await convertedRow.locator('button').focus();
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(
    () =>
      `${document.activeElement?.className} ${document.activeElement?.getAttribute('aria-label')}`,
  );
  check(
    "keyboard: Tab reaches the not-clickable price's currency icon",
    focused.includes('fx-details') && focused.includes('Currency'),
    focused,
  );
  await until(
    'focus tooltip',
    async () =>
      (await tooltip(page).count()) > 0 &&
      (await tooltip(page).textContent()).includes('Converted'),
  );
  check('keyboard: the tooltip shows on focus', true);
  const describedBy = await page.evaluate(() => {
    const id = document.activeElement?.getAttribute('aria-describedby');
    return id ? document.getElementById(id)?.textContent : null;
  });
  check(
    'screen readers get the tooltip as the description',
    describedBy?.includes('Converted from 5.00 EUR'),
    describedBy,
  );
  const ownRow = page.locator('tbody tr', {
    has: page.locator('th', { hasText: 'In your currency' }),
  });
  await ownRow.locator('button').focus();
  await page.keyboard.press('Enter');
  await until('picked by keyboard', async () =>
    (await page.locator('.picked').textContent()).includes('18.99'),
  );
  check(
    'keyboard: Enter on a price picks it',
    (await page.locator('.picked').textContent()).trim() === 'Picked $18.99 / mo',
  );

  // Screen-reader text of a price button.
  const name = await convertedRow.locator('button').ariaSnapshot();
  check(
    'a converted price button is named "about $7.53 a month"',
    name.includes('button "about $7.53 a month"'),
    name,
  );
  await context.close();
}

async function looks(browser) {
  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [WIDE, NARROW]) {
      const label = `${colorScheme} ${viewport.width}`;
      const { context } = await newContext(browser, { locale: 'en-CA', colorScheme, viewport });
      const page = await newPage(context, label);
      await page.goto(`${baseUrl}dev/components`);
      await firstRun(page, 'Ontario');
      await page.locator('.plan').first().waitFor({ timeout: 15000 });
      await sleep(500);
      await page.screenshot({
        path: path.join(outDir, `gallery-${colorScheme}-${viewport.width}.png`),
        fullPage: true,
      });
      await axe(page, `gallery, ${label}`);
      await noHorizontalScroll(page, `gallery, ${label}`);
      // A tooltip open, for its look and contrast.
      const convertedRow = page.locator('tbody tr', {
        has: page.locator('th', { hasText: /^Converted$/ }),
      });
      await convertedRow.locator('button').hover();
      await until('tooltip', async () => (await tooltip(page).count()) > 0);
      await sleep(400);
      await page.screenshot({
        path: path.join(outDir, `tooltip-${colorScheme}-${viewport.width}.png`),
      });
      await axe(page, `gallery with a tooltip, ${label}`);
      await context.close();
    }
  }
}

async function elsewhere(browser) {
  // A US user who gave no rate: no "+ tax" (their totals add none), "incl. tax" on Mullvad's price.
  {
    const { context, fxRequests } = await newContext(browser, { locale: 'en-US' });
    const page = await newPage(context, 'US');
    await page.goto(`${baseUrl}dev/components`);
    await firstRun(page);
    expectCases(
      await caseTexts(page),
      {
        'In your currency': '$18.99 / mo',
        Converted: '≈ $5.45 / mo',
        'Includes tax everywhere (Mullvad)': '≈ $5.45 / mo incl. tax',
        'No exchange rate yet': '$9.99 / mo',
      },
      'US, no rate',
    );
    await until('USD rates', async () => fxRequests.includes('USD'));
    check('FxStore: a US user gets rates in USD', fxRequests.join() === 'USD', fxRequests.join());
    await context.close();
  }
  // A UK user: no tax notes at all.
  {
    const { context } = await newContext(browser, { locale: 'en-GB' });
    const page = await newPage(context, 'UK');
    await page.goto(`${baseUrl}dev/components`);
    await firstRun(page);
    const texts = await caseTexts(page);
    expectCases(
      texts,
      {
        'In your currency': '£18.99 / mo',
        'Includes tax everywhere (Mullvad)': '≈ £4.20 / mo',
      },
      'UK',
    );
    check(
      'UK: no tax note anywhere',
      !Object.values(texts).some((text) => text.includes('tax')),
      JSON.stringify(texts),
    );
    await context.close();
  }
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    await canadian(browser);
    await elsewhere(browser);
    await looks(browser);
  } catch (error) {
    check('script ran to the end', false, error.stack);
  } finally {
    await browser.close();
  }
  // The dev server has no Worker behind /api; GET /fx is answered by the script, and nothing else should fail.
  check('no console errors or warnings', consoleProblems.length === 0, consoleProblems.join('\n'));
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();

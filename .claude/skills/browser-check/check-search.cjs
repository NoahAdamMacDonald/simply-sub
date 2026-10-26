// M5.2 in the system Edge: the Search page on the real catalog (data:build's files), for a Canadian in Alberta and a
// US user, in both themes at 1280 and 360 px: the cards, plan chips by keyboard, the expanded details, the "Cheaper
// at" resellers, typing with its pause, the empty state, a listed provider's status, a plan sold in the US only, a
// provider not sold in the user's country (the US file served with Crave limited to Canada), with axe. GET /fx is
// answered with fixed rates (1 EUR ≈ CA$1.5694), so Amazon.ca's Mullvad cards are cheaper in Alberta.
// Usage: node check-search.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

/** Rates per Canadian dollar, rebased for other currencies. */
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

async function until(what, condition, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await condition();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function newContext(
  browser,
  { locale, colorScheme = 'light', viewport = WIDE, craveInCanadaOnly },
) {
  const context = await browser.newContext({ locale, colorScheme, viewport });
  await context.route('**/api/v1/fx?**', (route) =>
    route.fulfill({ json: fxBody(new URL(route.request().url()).searchParams.get('base')) }),
  );
  if (craveInCanadaOnly) {
    await context.route('**/data/catalog/US.json', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.data.providers.find((provider) => provider.id === 'crave').availableIn = ['CA'];
      return route.fulfill({ response, json: body });
    });
  }
  return context;
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

/** Completes the first-run dialog: a Canadian picks a province; en-US needs nothing. */
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

async function openSearch(page, province) {
  await page.goto(`${baseUrl}search`);
  await firstRun(page, province);
  await page.locator('ss-sub-card').first().waitFor({ timeout: 20000 });
}

const card = (page, name) =>
  page.locator('ss-sub-card', { has: page.getByRole('heading', { name, exact: true }) });
const names = (page) => page.locator('ss-sub-card h2').allTextContents();
const count = async (page) => (await page.locator('.count').textContent()).trim();

/** What's on screen in `locator`: no icon ligatures or screen-reader-only words, texts spaced as laid out. */
async function shown(locator) {
  return locator.evaluate((element) => {
    const copy = element.cloneNode(true);
    copy.querySelectorAll('mat-icon, .visually-hidden').forEach((node) => node.remove());
    const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode.textContent.trim());
    return texts.filter(Boolean).join(' ');
  });
}

async function chips(page, name) {
  return card(page, name)
    .locator('label.chip')
    .allTextContents()
    .then((texts) => texts.map((text) => text.replace('check', '').trim()));
}

async function focused(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    return {
      tag: element?.tagName.toLowerCase(),
      type: element?.getAttribute('type'),
      value: element?.value,
      name:
        element?.getAttribute('aria-label') ?? element?.textContent?.replace(/\s+/g, ' ').trim(),
      className: element?.className,
    };
  });
}

async function type(page, text) {
  const box = page.getByRole('searchbox');
  await box.fill('');
  await box.pressSequentially(text);
  await sleep(400);
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

/** Writes a list item to IndexedDB, as the item dialog will (M6.5), and reloads so the repositories read it. */
async function addItem(page, planId) {
  await page.evaluate(
    (item) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('simply-sub');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('items', 'readwrite');
          transaction.objectStore('items').put(item);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    {
      id: '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0b',
      listId: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d',
      source: { kind: 'catalog', planId },
      billing: {
        mode: 'recurring',
        interval: 'month',
        intervalCount: 1,
        anchorDate: '2026-09-10',
        autoRenew: true,
      },
      tagIds: [],
      rankOverrides: {},
      pinned: false,
      createdAt: '2026-10-20T12:00:00.000Z',
      updatedAt: '2026-10-20T12:00:00.000Z',
    },
  );
  await page.reload();
  await page.locator('ss-sub-card').first().waitFor({ timeout: 20000 });
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });

  // ── A Canadian in Alberta, light, 1280 px ─────────────────────────────────────────────────────
  {
    const context = await newContext(browser, { locale: 'en-CA' });
    const page = await newPage(context, 'CA');
    await openSearch(page, 'Alberta');

    const all = await names(page);
    check(
      'one card per provider, and the count',
      all.length === 5 && (await count(page)) === '5 services',
      `${all.join(', ')} / ${await count(page)}`,
    );
    const disney = await chips(page, 'Disney+');
    check(
      'a Canadian never sees the US-only Disney+ With Ads',
      !disney.includes('With Ads') && disney.includes('Standard With Ads'),
      disney.join(', '),
    );
    const deals = await shown(card(page, 'Mullvad VPN').locator('.deals'));
    check(
      'Mullvad is cheaper at Amazon.ca and ProxyStore in Alberta',
      /Cheaper at ProxyStore .* Cheaper at Amazon \$87\.00 \/ 12 mo \+ tax/.test(deals),
      deals,
    );
    const amazon = card(page, 'Mullvad VPN').locator('.deals a', { hasText: 'Amazon' });
    check(
      'a reseller link opens its page in a new tab',
      (await amazon.getAttribute('target')) === '_blank' &&
        (await amazon.getAttribute('rel')) === 'noopener' &&
        (await amazon.getAttribute('href')).startsWith('https://www.amazon.ca/'),
    );
    await page.screenshot({ path: path.join(outDir, 'ca-light-1280.png'), fullPage: true });

    // Keyboard: the box, the sort, then the first card's links, its chips (one tab stop) and its details button.
    await page.getByRole('searchbox').focus();
    await page.keyboard.press('Tab');
    check(
      'Tab goes from the search box to Sort',
      (await focused(page)).className.includes('mat-mdc-select'),
    );
    const firstName = all[0];
    const first = card(page, firstName);
    const firstPlan = (await first.locator('.plan-name').textContent()).trim();
    const stops = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const now = await focused(page);
      stops.push(now);
      if (now.tag === 'input' && now.type === 'radio') break;
    }
    const radio = stops.at(-1);
    check(
      `Tab reaches ${firstName}'s links, then its checked chip`,
      stops[0].tag === 'a' && radio.type === 'radio',
      stops.map((stop) => `${stop.tag}:${stop.name ?? stop.value}`).join(' → '),
    );
    await page.keyboard.press('ArrowRight');
    await until(
      'the next plan',
      async () => (await first.locator('.plan-name').textContent()).trim() !== firstPlan,
    );
    check(
      'an arrow key picks the next plan',
      true,
      `${firstPlan} → ${(await first.locator('.plan-name').textContent()).trim()}`,
    );
    await page.keyboard.press('Tab');
    const expand = await focused(page);
    check(
      'Tab leaves the chips for the details button',
      expand.name?.startsWith('Details: '),
      expand.name,
    );
    await page.keyboard.press('Enter');
    await until('the details', () => first.locator('ss-plan-details').isVisible());
    check(
      'Enter expands the card',
      (await first.locator('button.expand').getAttribute('aria-expanded')) === 'true',
    );
    await page.keyboard.press('Enter');
    await until(
      'the details to close',
      async () => (await first.locator('ss-plan-details').count()) === 0,
    );
    check('Enter again collapses it', true);

    // Typing, with its pause.
    await type(page, 'netflix 4k');
    const netflix4k = await names(page);
    check(
      '"netflix 4k" finds Netflix, showing its 4k plan, by best match',
      netflix4k.join() === 'Netflix' &&
        (await card(page, 'Netflix').locator('.plan-name').textContent()).trim() === 'Premium' &&
        (await page.locator('mat-select').textContent()).includes('Best match'),
      `${netflix4k.join(', ')} / ${await count(page)}`,
    );

    // The empty state, cleared by keyboard.
    await type(page, 'zzzz');
    check('no match shows the empty state', (await count(page)) === 'No services match');
    await page.getByRole('button', { name: 'Clear search' }).focus();
    await page.keyboard.press('Enter');
    await until('the cards again', async () => (await names(page)).length === 5);
    check(
      'Clear search empties the box and focuses it',
      (await focused(page)).type === 'search' &&
        (await page.getByRole('searchbox').inputValue()) === '',
    );

    // A listed provider: its status, and its plan shown.
    await addItem(page, 'netflix.standard');
    const netflix = card(page, 'Netflix');
    check(
      'a listed provider shows its status and the user’s plan',
      (await shown(netflix.locator('ss-status-badge'))) === 'Active · 1 list' &&
        (await netflix.locator('.plan-name').textContent()).trim() === 'Standard',
      await shown(netflix.locator('ss-status-badge')),
    );
    await page.screenshot({ path: path.join(outDir, 'ca-listed-1280.png'), fullPage: true });
    await context.close();
  }

  // ── Both themes at both widths: cards expanded (a bundle, a suite, resellers), and the empty state ─────
  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [WIDE, NARROW]) {
      const label = `${colorScheme} ${viewport.width}`;
      const context = await newContext(browser, { locale: 'en-CA', colorScheme, viewport });
      const page = await newPage(context, label);
      await openSearch(page, 'Alberta');
      for (const name of ['Disney+', 'Proton', 'Mullvad VPN']) {
        await card(page, name).locator('button.expand').click();
      }
      // Proton's suite, and Disney+'s Premium, which a bundle includes.
      await card(page, 'Proton').locator('label.chip', { hasText: 'Proton Unlimited' }).click();
      await card(page, 'Disney+')
        .locator('label.chip', { hasText: /^check\s*Premium$|^Premium$/ })
        .click();
      await until('the suite', () =>
        card(page, 'Proton').getByRole('heading', { name: 'Includes' }).isVisible(),
      );
      await until('the bundle', () =>
        card(page, 'Disney+').getByRole('heading', { name: 'Bundles' }).isVisible(),
      );
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      check(`no horizontal scroll: ${label}`, width <= viewport.width, `${width}px`);
      await page.screenshot({
        path: path.join(outDir, `expanded-${colorScheme}-${viewport.width}.png`),
        fullPage: true,
      });
      await axeCheck(page, `${label}, cards expanded`);
      await type(page, 'zzzz');
      await axeCheck(page, `${label}, no match`);
      if (viewport === NARROW) {
        await page.screenshot({ path: path.join(outDir, `empty-${colorScheme}-360.png`) });
      }
      await context.close();
    }
  }

  // ── A US user: the US-only plan, a provider not sold there, and one with no US price ─────────────
  {
    const context = await newContext(browser, { locale: 'en-US', craveInCanadaOnly: true });
    const page = await newPage(context, 'US');
    await openSearch(page);
    const disney = await chips(page, 'Disney+');
    check('a US user sees Disney+ With Ads', disney.includes('With Ads'), disney.join(', '));
    check(
      'a provider not sold in the US has no card until the text names it',
      !(await names(page)).includes('Crave'),
    );
    await type(page, 'crave');
    check(
      'naming it shows "Not offered in United States"',
      (await shown(card(page, 'Crave').locator('.prices'))) === 'Not offered in United States',
      await shown(card(page, 'Crave').locator('.prices')),
    );
    await page.screenshot({ path: path.join(outDir, 'us-not-offered.png') });
    await axeCheck(page, 'US, not offered');
    await context.close();

    const plain = await newContext(browser, { locale: 'en-US' });
    const second = await newPage(plain, 'US plain');
    await openSearch(second);
    await type(second, 'crave');
    const prices = await shown(card(second, 'Crave').locator('.prices'));
    check(
      'with no US price and no availableIn, the fallback price shows "No price for United States yet"',
      /^≈ \$\d+\.\d\d \/ mo .*No price for United States yet$/.test(prices),
      prices,
    );
    await plain.close();
  }

  await browser.close();
  check('no console errors or warnings', consoleProblems.length === 0, consoleProblems.join(' | '));
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

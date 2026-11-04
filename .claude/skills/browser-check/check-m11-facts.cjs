// M11.5 in the system Edge: a Search card's provider facts and the item dialog's renewal day, on the real catalog
// (data:build's files), in both themes at 1280 and 360 px, for a Canadian in Alberta. Mullvad's Ways to pay with the
// currencies its cash takes, each way a chip of glyphs named for screen readers and as its tooltip (Task 6), then its
// Source code after its host's chip; Netflix's Billing day; Crave with neither. The item dialog, with
// CA.json answered so Crave bills on the 1st and TSN on the last day: Crave's suggested renewal is the next 1st and
// TSN's this month's end, neither asking "Billed on"; TSN's typed Feb 28 isn't asked either and saves the 31st, while
// Netflix (the date you signed up) still asks of a typed Feb 28. Keyboard: Tab through the links, their tooltips the
// pages' words. With axe, screenshots and no horizontal scroll. GET /fx is answered with fixed rates.
// Usage: node check-m11-facts.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

/** Today on this machine, and the days the renewal rules give from it. */
const now = new Date();
const iso = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const nextFirst = iso(new Date(now.getFullYear(), now.getMonth() + 1, 1));
const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
const nextMonthEnd = iso(
  thisMonthEnd.getDate() === now.getDate()
    ? new Date(now.getFullYear(), now.getMonth() + 2, 0)
    : thisMonthEnd,
);
// A month from today on the same day, or a shorter month's last day (core's addMonths).
const monthFromToday = iso(
  new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    Math.min(now.getDate(), new Date(now.getFullYear(), now.getMonth() + 2, 0).getDate()),
  ),
);

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

/** The renewal days CA.json is answered with: Crave on the 1st, TSN on the last day (neither says yet). */
const servedAnchors = {
  crave: 'first-of-month',
  tsn: 'end-of-month',
};
const anchorQuotes = {
  'first-of-month': 'You are billed on the 1st of each month.',
  'end-of-month': 'You are billed on the last day of each month.',
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
  await context.route('**/data/catalog/CA.json', async (route) => {
    const response = await route.fetch();
    const file = await response.json();
    for (const provider of file.data.providers) {
      const kind = servedAnchors[provider.id];
      if (!kind) continue;
      provider.renewalAnchor = {
        kind,
        page: 'Billing',
        url: `${provider.website}/billing`,
        quotes: [anchorQuotes[kind]],
        lastVerified: '2026-11-02',
      };
    }
    await route.fulfill({ json: file });
  });
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

const groupNamed = (scope, page, name) =>
  scope.locator('.group', { has: page.getByRole('heading', { name, exact: true }) });

/** A group's words as laid out (innerText), the links' icons left out and spaces collapsed. */
async function shown(locator) {
  return locator.evaluate((element) =>
    element.innerText
      // Material Symbols' ligatures: the link glyph and the ways to pay's (Task 6).
      .replace(
        /open_in_new|credit_card|card_giftcard|currency_bitcoin|account_balance|payments|storefront|live_tv/g,
        '',
      )
      .replace(/\s+/g, ' ')
      .replace(/ ([,)])/g, '$1')
      .trim(),
  );
}

/** Whether the group's text is the muted grey and its links the accent and underlined, against the tokens. */
async function looks(group) {
  return group.evaluate((element) => {
    const resolved = (name) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${name})`;
      element.append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    };
    const texts = [...element.querySelectorAll('.payment')];
    const links = [...element.querySelectorAll('a')];
    return {
      muted:
        texts.length > 0 &&
        texts.every((text) => getComputedStyle(text).color === resolved('--ss-text-muted')),
      accent: links.every((link) => getComputedStyle(link).color === resolved('--ss-accent-text')),
      underlined: links.every((link) =>
        getComputedStyle(link).textDecorationLine.includes('underline'),
      ),
    };
  });
}

/** The focused element's role and name, from the accessibility tree: a link's line ends in a colon, before its URL. */
async function focusedName(page) {
  return (await page.locator(':focus').ariaSnapshot()).split('\n')[0].replace(/:$/, '');
}

/** The tooltip showing now, if one is. */
async function tooltipText(page) {
  await sleep(400);
  const tooltip = page.locator('.mat-mdc-tooltip-show');
  return (await tooltip.count()) > 0 ? (await tooltip.last().textContent()).trim() : '';
}

/** Every row of an IndexedDB table, as stored. */
function readTable(page, table) {
  return page.evaluate(
    (store) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('simply-sub');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const rows = db.transaction(store).objectStore(store).getAll();
          rows.onsuccess = () => {
            db.close();
            resolve(rows.result);
          };
          rows.onerror = () => reject(rows.error);
        };
      }),
    table,
  );
}

const itemDialog = (page) => page.locator('ss-item-dialog');
const renewalInput = (page) =>
  itemDialog(page)
    .locator('mat-form-field', { has: page.locator('mat-label', { hasText: 'Next renewal' }) })
    .locator('input');

/** Opens the item dialog for a plan in a new list, and waits for its form. */
async function openDialog(page, planId) {
  await page.goto(`${baseUrl}lists/new?add=${planId}&interval=month`);
  await itemDialog(page).waitFor({ timeout: 20000 });
  await renewalInput(page).waitFor();
  await sleep(500);
}

/** Types a date into Next renewal, reached by Tab, as a keyboard user does. */
async function typeRenewal(page, date) {
  for (let i = 0; i < 60; i++) {
    const there = await page.evaluate(
      () =>
        document.activeElement
          ?.closest('mat-form-field')
          ?.querySelector('mat-label')
          ?.textContent.trim() === 'Next renewal',
    );
    if (there) break;
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Control+A');
  await page.keyboard.type(date);
  await sleep(400);
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    for (const colorScheme of ['light', 'dark']) {
      for (const viewport of [WIDE, NARROW]) {
        const label = `${colorScheme} ${viewport.width}`;
        const { context, page } = await newContext(browser, { colorScheme, viewport });
        await openSearch(page);

        // ── Mullvad: its cash currencies and its source code ─────────────────────────────────────────
        const mullvad = await details(page, 'Mullvad VPN');
        const headings = await mullvad.locator('ss-plan-details h3').allTextContents();
        check(
          `${label}: Mullvad's Ways to pay, then Source code, after its Owner`,
          headings.slice(-3).join() === 'Owner,Ways to pay,Source code',
          headings.join(', '),
        );
        const pay = groupNamed(mullvad, page, 'Ways to pay');
        const payWords = await shown(pay);
        check(
          `${label}: Ways to pay names the currencies cash takes, citing its terms`,
          payWords ===
            'Ways to pay networks not verified according to its Pricing ' +
              'according to its Terms of service ' +
              'Cash in EUR, USD, GBP, SEK, NOK, CHF, CAD, AUD or NZD, according to its Terms of service',
          payWords,
        );
        // Each way to pay a chip of its glyphs (Task 6): an image named for screen readers, its name the tooltip.
        const chips = await pay
          .locator('.pay-chips')
          .evaluateAll((lines) =>
            lines.map((line) =>
              [...line.querySelectorAll('.pay-chip')].map((chip) =>
                [chip.getAttribute('role'), chip.getAttribute('aria-label'), chip.tabIndex].join(
                  ' ',
                ),
              ),
            ),
          );
        check(
          `${label}: Ways to pay shows each way as a chip of glyphs, named and reached by Tab`,
          JSON.stringify(chips) ===
            JSON.stringify([
              [
                'img Cash 0',
                'img Cryptocurrency 0',
                'img Bank transfer or direct debit 0',
                'img Card (networks not verified) 0',
                'img PayPal 0',
              ],
              ['img App store or platform billing 0', 'img Gift card 0'],
            ]),
          JSON.stringify(chips),
        );
        // By Tab from the chip before: a tooltip opens on keyboard focus, not on focus() alone.
        await pay.locator('.pay-chip').nth(1).focus();
        await page.keyboard.press('Tab');
        const chipFocus = await focusedName(page);
        const chipTip = await tooltipText(page);
        check(
          `${label}: a chip focused shows its name as the tooltip`,
          chipFocus === '- img "Bank transfer or direct debit"' &&
            chipTip === 'Bank transfer or direct debit',
          `${chipFocus} / ${chipTip}`,
        );
        await page.screenshot({
          path: path.join(outDir, `mullvad-chip-${colorScheme}-${viewport.width}.png`),
        });
        await axeCheck(page, `${label}, Mullvad's Ways to pay, a chip's tooltip open`);
        const code = groupNamed(mullvad, page, 'Source code');
        const codeWords = await shown(code);
        check(
          `${label}: Source code links its app's repository, citing the page that links it`,
          codeWords ===
            'Source code github.com/mullvad/mullvadvpn-app, according to its Why Mullvad VPN?',
          codeWords,
        );
        const codeLinks = await code
          .locator('a')
          .evaluateAll((anchors) => anchors.map((a) => [a.getAttribute('href'), a.target, a.rel]));
        check(
          `${label}: the repository and the page open in a new tab, the page at its words`,
          codeLinks.length === 2 &&
            codeLinks[0].join(' ') ===
              'https://github.com/mullvad/mullvadvpn-app _blank noopener' &&
            codeLinks[1][0] ===
              'https://mullvad.net/en/why-mullvad-vpn#:~:text=Code%20is%20open%20source' &&
            codeLinks[1][1] === '_blank',
          JSON.stringify(codeLinks),
        );
        for (const [name, group] of [
          ['Ways to pay', pay],
          ['Source code', code],
        ]) {
          const style = await looks(group);
          check(
            `${label}: ${name} is the muted grey, its links the accent and underlined`,
            Object.values(style).every(Boolean),
            JSON.stringify(style),
          );
        }
        // Keyboard: from the ways to pay's link, Tab reaches the currencies', then the repository and its page.
        // Its two pages' links (the pricing page, then its terms: the owner's tasks, 2026-11-03), then the currencies'.
        await pay.locator('a').nth(1).focus();
        await page.keyboard.press('Tab');
        const currenciesFocus = await focusedName(page);
        const currenciesTip = await tooltipText(page);
        check(
          `${label}: Tab reaches the currencies' page, its tooltip the page's words`,
          currenciesFocus === '- link "Terms of service, opens in a new tab"' &&
            currenciesTip.startsWith('“We accept payment by cash in bills (EUR, USD'),
          `${currenciesFocus} / ${currenciesTip.slice(0, 60)}`,
        );
        await page.keyboard.press('Tab');
        const hostFocus = await focusedName(page);
        const hostTip = await tooltipText(page);
        await page.keyboard.press('Tab');
        const repoFocus = await focusedName(page);
        await page.keyboard.press('Tab');
        const pageFocus = await focusedName(page);
        const pageTip = await tooltipText(page);
        check(
          `${label}: then its host's chip, the repository, named for screen readers, and its page with its words`,
          hostFocus === '- img "GitHub"' &&
            hostTip === 'GitHub' &&
            repoFocus ===
              '- link "Source code on github.com/mullvad/mullvadvpn-app, opens in a new tab"' &&
            pageFocus === '- link "Why Mullvad VPN?, opens in a new tab"' &&
            pageTip === '“Code is open source”',
          `${hostFocus} / ${hostTip} / ${repoFocus} / ${pageFocus} / ${pageTip}`,
        );
        await sleep(500);
        await page.screenshot({
          path: path.join(outDir, `mullvad-facts-${colorScheme}-${viewport.width}.png`),
        });
        await axeCheck(page, `${label}, Mullvad's Ways to pay and Source code, a tooltip open`);

        // ── Netflix: its billing day ─────────────────────────────────────────────────────────────────
        const netflix = await details(page, 'Netflix');
        const netflixHeadings = await netflix.locator('ss-plan-details h3').allTextContents();
        const billing = groupNamed(netflix, page, 'Billing day');
        const billingWords = await shown(billing);
        check(
          `${label}: Netflix's Billing day, after Ways to pay, citing its billing date article`,
          netflixHeadings.slice(-2).join() === 'Ways to pay,Billing day' &&
            billingWords ===
              'Billing day The date you signed up, according to its How to check your Netflix billing date',
          `${netflixHeadings.join(', ')} / ${billingWords}`,
        );
        const billingHref = await billing.locator('a').getAttribute('href');
        check(
          `${label}: its link scrolls to its words on Netflix's help centre`,
          billingHref.startsWith('https://help.netflix.com/en/node/54896#:~:text=Your%20billing'),
          billingHref,
        );
        const billingStyle = await looks(billing);
        check(
          `${label}: the billing day is the muted grey, its link the accent and underlined`,
          Object.values(billingStyle).every(Boolean),
          JSON.stringify(billingStyle),
        );
        await groupNamed(netflix, page, 'Ways to pay').locator('a').last().focus();
        await page.keyboard.press('Tab');
        const billingFocus = await focusedName(page);
        const billingTip = await tooltipText(page);
        check(
          `${label}: Tab from Ways to pay reaches the billing day's page, its tooltip the page's words`,
          billingFocus === '- link "How to check your Netflix billing date, opens in a new tab"' &&
            billingTip.startsWith('“Your billing cycle starts on the date you sign up.”'),
          `${billingFocus} / ${billingTip.slice(0, 60)}`,
        );
        await sleep(500);
        await billing.screenshot({
          path: path.join(outDir, `netflix-billing-${colorScheme}-${viewport.width}.png`),
        });
        await axeCheck(page, `${label}, Netflix's Billing day with its tooltip`);

        // ── Bitdefender: a Billing day since M11.9 (each anniversary), and no source code ────────────
        const bitdefender = await details(page, 'Bitdefender');
        const bitdefenderHeadings = await bitdefender
          .locator('ss-plan-details h3')
          .allTextContents();
        check(
          `${label}: Bitdefender has a Billing day but no Source code`,
          bitdefenderHeadings.at(-1) === 'Billing day' &&
            !bitdefenderHeadings.includes('Source code'),
          bitdefenderHeadings.join(', '),
        );
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        check(
          `${label}: nothing scrolls sideways on Search`,
          width <= viewport.width,
          `${width}px`,
        );

        // ── The item dialog: a new item's renewal by its provider's day ─────────────────────────────
        await openDialog(page, 'crave.standard-ads');
        check(
          `${label}: Crave, served as billing on the 1st, suggests the next 1st and asks nothing`,
          (await renewalInput(page).inputValue()) === nextFirst &&
            (await itemDialog(page).locator('.billing-day').count()) === 0 &&
            (await itemDialog(page)
              .getByText('Check your account page for the exact date')
              .count()) === 1,
          await renewalInput(page).inputValue(),
        );
        await page.screenshot({
          path: path.join(outDir, `dialog-first-${colorScheme}-${viewport.width}.png`),
        });
        await axeCheck(page, `${label}, the dialog for a plan billed on the 1st`);
        await page.keyboard.press('Escape');
        await itemDialog(page).waitFor({ state: 'detached' });

        await openDialog(page, 'tsn.standard');
        const tsnDefault = await renewalInput(page).inputValue();
        const tsnAsked = await itemDialog(page).locator('.billing-day').count();
        await typeRenewal(page, '2027-02-28');
        const typedAsked = await itemDialog(page).locator('.billing-day').count();
        check(
          `${label}: TSN, served as billing on the last day, suggests this month's end and asks nothing, even of Feb 28`,
          tsnDefault === nextMonthEnd && tsnAsked === 0 && typedAsked === 0,
          `${tsnDefault}, asked ${tsnAsked}, then ${typedAsked}`,
        );
        await itemDialog(page).getByRole('button', { name: 'Add to list' }).click();
        await itemDialog(page).waitFor({ state: 'detached' });
        await sleep(500);
        const drafts = await readTable(page, 'drafts');
        const tsnItem = drafts
          .flatMap((draft) => draft.items)
          .map((entry) => entry.item)
          .find((item) => item.source.planId === 'tsn.standard');
        check(
          `${label}: it saves Feb 28 billed on the 31st, every month's last day`,
          tsnItem?.billing.anchorDate === '2027-02-28' && tsnItem?.billing.billingDay === 31,
          JSON.stringify(tsnItem?.billing),
        );

        await openDialog(page, 'netflix.standard-ads');
        const netflixDefault = await renewalInput(page).inputValue();
        await typeRenewal(page, '2027-02-28');
        await itemDialog(page)
          .locator('.billing-day')
          .waitFor({ timeout: 5000 })
          .catch(() => {});
        check(
          `${label}: Netflix (the date you signed up) suggests a month from today, and asks of a typed Feb 28`,
          netflixDefault === monthFromToday &&
            (await itemDialog(page).locator('.billing-day').count()) === 1,
          netflixDefault,
        );
        await page.screenshot({
          path: path.join(outDir, `dialog-asked-${colorScheme}-${viewport.width}.png`),
        });
        await axeCheck(page, `${label}, the dialog asking which day`);
        const dialogWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        check(
          `${label}: nothing scrolls sideways with the dialog open`,
          dialogWidth <= viewport.width,
          `${dialogWidth}px`,
        );
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

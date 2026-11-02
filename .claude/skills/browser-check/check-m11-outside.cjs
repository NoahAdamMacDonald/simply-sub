// M11.2 in the system Edge: a Search card's Outside ratings and Owner, on the real catalog (data:build's files), in
// both themes at 1280 and 360 px, for a Canadian in Alberta. Bitdefender's AV-TEST scores after Terms and policies, each
// with its month and a link to AV-TEST's page in a new tab, reached by Tab after the Sources; Mullvad's owner citing
// its about page, the quotes as the link's tooltip on Tab; Netflix with neither; the lines in the muted grey and the
// links in the accent, against the tokens. With axe, screenshots and no horizontal scroll. GET /fx is answered with
// fixed rates.
// Usage: node check-m11-outside.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

async function newContext(browser, { locale, colorScheme, viewport }) {
  const context = await browser.newContext({
    locale,
    colorScheme,
    viewport,
    serviceWorkers: 'block',
  });
  await context.route('**/api/v1/fx?**', (route) =>
    route.fulfill({ json: fxBody(new URL(route.request().url()).searchParams.get('base')) }),
  );
  const page = await context.newPage();
  const label = `${locale} ${colorScheme} ${viewport.width}`;
  page.on('console', (msg) => {
    const blockedWorker = msg.text() === 'Service Worker registration blocked by Playwright';
    if ((msg.type() === 'error' || msg.type() === 'warning') && !blockedWorker) {
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  return { context, page };
}

async function openSearch(page, province) {
  await page.goto(`${baseUrl}search`);
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
      .replace(/open_in_new/g, '')
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
    const text = element.querySelector('.outside, .owner, .payment');
    const links = [...element.querySelectorAll('a')];
    return {
      muted: getComputedStyle(text).color === resolved('--ss-text-muted'),
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

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    for (const colorScheme of ['light', 'dark']) {
      for (const viewport of [WIDE, NARROW]) {
        const label = `${colorScheme} ${viewport.width}`;
        const { context, page } = await newContext(browser, {
          locale: 'en-CA',
          colorScheme,
          viewport,
        });
        await openSearch(page, 'Alberta');

        // ── Bitdefender: AV-TEST's lab results ────────────────────────────────────────────────────
        const bitdefender = await details(page, 'Bitdefender');
        const headings = await bitdefender.locator('ss-plan-details h3').allTextContents();
        check(
          `${label}: Bitdefender's Outside ratings, Owner and Ways to pay come after Terms and policies`,
          headings.slice(-4).join() === 'Terms and policies,Outside ratings,Owner,Ways to pay',
          headings.join(', '),
        );
        // Its security features (2026-11-02): the plan shown is listed with the antivirus group.
        const features = await shown(groupNamed(bitdefender, page, 'Features'));
        check(
          `${label}: Bitdefender's plan lists its antivirus features`,
          /Antivirus/.test(features) &&
            /Ransomware protection/.test(features) &&
            /Web and phishing protection/.test(features),
          features.slice(0, 200),
        );
        const outside = groupNamed(bitdefender, page, 'Outside ratings');
        const tested = '(tested Total Security 27.0, Windows 11)';
        const words = await shown(outside);
        check(
          `${label}: each subject's label, from AV-TEST, its month and what it tested`,
          words ===
            `Outside ratings Protection: 6.0/6.0 from AV-TEST, August 2026 ${tested} ` +
              `Performance: 6.0/6.0 from AV-TEST, August 2026 ${tested} ` +
              `Usability: 6.0/6.0 from AV-TEST, August 2026 ${tested}`,
          words,
        );
        const attributes = await outside
          .locator('a')
          .evaluateAll((anchors) =>
            anchors.map((a) => [a.getAttribute('href'), a.target, a.rel].join(' ')),
          );
        const result =
          'https://www.av-test.org/en/antivirus/home-windows/windows-11/august-2026/bitdefender-total-security-27.0-261405/';
        check(
          `${label}: each links AV-TEST's result page in a new tab`,
          attributes.length === 3 &&
            attributes.every((entry) => entry === `${result} _blank noopener`),
          attributes.join(' | '),
        );
        const outsideLooks = await looks(outside);
        check(
          `${label}: the lines are the muted grey, the links the accent and underlined`,
          Object.values(outsideLooks).every(Boolean),
          JSON.stringify(outsideLooks),
        );
        // Keyboard: Tab from the last source lands on the first rater's link, then the next.
        await bitdefender.locator('.policy-links a').last().focus();
        await page.keyboard.press('Tab');
        const first = await focusedName(page);
        await page.keyboard.press('Tab');
        const second = await focusedName(page);
        check(
          `${label}: Tab goes from Sources to each rater's link, named for the rater and the new tab`,
          first === '- link "AV-TEST’s rating, opens in a new tab"' && second === first,
          `${first} / ${second}`,
        );
        await outside.screenshot({
          path: path.join(outDir, `bitdefender-${colorScheme}-${viewport.width}.png`),
        });
        await axeCheck(page, `${label}, Bitdefender's Outside ratings, a link focused`);

        // ── Mullvad: its owner, citing its about page ───────────────────────────────────────────────
        const mullvad = await details(page, 'Mullvad VPN');
        const mullvadHeadings = await mullvad.locator('ss-plan-details h3').allTextContents();
        const owner = groupNamed(mullvad, page, 'Owner');
        const ownerWords = await shown(owner);
        check(
          `${label}: Mullvad's Owner, then Ways to pay, after Terms and policies, with no Outside ratings`,
          mullvadHeadings.slice(-3).join() === 'Terms and policies,Owner,Ways to pay' &&
            ownerWords === 'Owner Mullvad VPN AB, according to its About us',
          `${mullvadHeadings.join(', ')} / ${ownerWords}`,
        );
        const ownerLink = owner.locator('a');
        const ownerHref = await ownerLink.getAttribute('href');
        check(
          `${label}: the owner's link scrolls to its words on Mullvad's about page, in a new tab`,
          ownerHref.startsWith('https://mullvad.net/en/about#:~:text=') &&
            (await ownerLink.getAttribute('target')) === '_blank',
          ownerHref,
        );
        const ownerLooks = await looks(owner);
        check(
          `${label}: the owner's line is the muted grey, its link the accent and underlined`,
          Object.values(ownerLooks).every(Boolean),
          JSON.stringify(ownerLooks),
        );
        await mullvad.locator('.policy-links a').last().focus();
        await page.keyboard.press('Tab');
        const ownerFocus = await focusedName(page);
        const tooltip = page.locator('.mat-mdc-tooltip-show');
        await tooltip.waitFor({ timeout: 5000 }).catch(() => undefined);
        const tip = (await tooltip.count()) > 0 ? (await tooltip.textContent()).trim() : '';
        check(
          `${label}: Tab from Sources reaches the owner's link, its tooltip the page's words`,
          ownerFocus === '- link "About us, opens in a new tab"' &&
            tip.startsWith(
              '“Mullvad VPN AB is owned by parent company Amagicom AB.” “Mullvad VPN AB and its parent',
            ),
          `${ownerFocus} / ${tip}`,
        );
        await sleep(500);
        await page.screenshot({
          path: path.join(outDir, `mullvad-owner-${colorScheme}-${viewport.width}.png`),
        });
        await axeCheck(page, `${label}, Mullvad's Owner with its tooltip`);

        // ── Mullvad: its ways to pay (M11.5, 2026-11-02) ────────────────────────────────────────────
        const pay = groupNamed(mullvad, page, 'Ways to pay');
        const payWords = await shown(pay);
        check(
          `${label}: Mullvad's Ways to pay names cash and crypto, citing its terms`,
          payWords ===
            'Ways to pay Cash, Cryptocurrency, Card, Bank transfer, PayPal, App store billing and Gift card, according to its Terms of service',
          payWords,
        );
        const payLooks = await looks(pay);
        check(
          `${label}: the ways to pay are the muted grey, the link the accent and underlined`,
          Object.values(payLooks).every(Boolean),
          JSON.stringify(payLooks),
        );
        await page.keyboard.press('Tab');
        const payFocus = await focusedName(page);
        const payTip = page.locator('.mat-mdc-tooltip-show');
        await sleep(400);
        const payTipText =
          (await payTip.count()) > 0 ? (await payTip.last().textContent()).trim() : '';
        check(
          `${label}: Tab from the owner's link reaches the payment page's, its tooltip the page's words`,
          payFocus === '- link "Terms of service, opens in a new tab"' &&
            payTipText.startsWith('“We accept payment by cash in bills'),
          `${payFocus} / ${payTipText.slice(0, 60)}`,
        );
        await sleep(500);
        await pay.screenshot({
          path: path.join(outDir, `mullvad-pay-${colorScheme}-${viewport.width}.png`),
        });
        await axeCheck(page, `${label}, Mullvad's Ways to pay with its tooltip`);

        // ── Netflix: no outside ratings; its owner and Canada's own ways to pay ──────────────────────
        const netflix = await details(page, 'Netflix');
        const netflixHeadings = await netflix.locator('ss-plan-details h3').allTextContents();
        const netflixPay = await shown(groupNamed(netflix, page, 'Ways to pay'));
        check(
          `${label}: Netflix has no Outside ratings, its Owner, and Canada's page for its ways to pay`,
          !netflixHeadings.includes('Outside ratings') &&
            netflixHeadings.includes('Owner') &&
            netflixPay ===
              'Ways to pay Card, Gift card, PayPal and Your TV, internet or phone bill, according to its How to pay for Netflix',
          `${netflixHeadings.join(', ')} / ${netflixPay}`,
        );
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        check(`${label}: nothing scrolls sideways`, width <= viewport.width, `${width}px`);
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

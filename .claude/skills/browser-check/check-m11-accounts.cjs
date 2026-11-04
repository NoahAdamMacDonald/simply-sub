// M11.10 in the system Edge: ss-account-terms, a finance account's terms on a card, on the /dev/components gallery
// (dev builds only: no real finance provider is in the catalog before M11.15), for a Canadian in Ontario, in both
// themes at 1280 and 360 px: the two fixture accounts' lines (interest by tier with its bonus, the waivers, the limits,
// the protection, who may open it, and since M11.14 how soon the fintech's rate followed the Bank of Canada's last
// changes), the posted-rates and protection links (the second scrolled to its words), reached
// by Tab with the protection's quote as its tooltip, the muted text against the tokens, axe, screenshots and no
// horizontal scroll.
// Usage: node check-m11-accounts.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

async function openGallery(browser, colorScheme, viewport) {
  const context = await browser.newContext({
    locale: 'en-CA',
    colorScheme,
    viewport,
    serviceWorkers: 'block',
  });
  // FxStore asks for rates on start; the dev server has no Worker behind /api (as check-components.cjs answers it).
  await context.route('**/api/v1/fx?**', (route) =>
    route.fulfill({
      json: {
        data: {
          base: 'CAD',
          date: '2026-10-21',
          source: 'European Central Bank via Frankfurter',
          rates: { EUR: 0.6372, USD: 0.7243 },
        },
        meta: { fetchedAt: '2026-10-21T06:00:02Z', stale: false },
      },
    }),
  );
  const page = await context.newPage();
  const label = `${colorScheme} ${viewport.width}`;
  page.on('console', (msg) => {
    const blockedWorker = msg.text() === 'Service Worker registration blocked by Playwright';
    // The gallery's "File missing" icon is a deliberate 404 (check-components.cjs).
    const missingIcon = msg.location().url.endsWith('/icons/missing.webp');
    if ((msg.type() === 'error' || msg.type() === 'warning') && !blockedWorker && !missingIcon) {
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  await page.goto(`${baseUrl}dev/components`);
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor({ timeout: 20000 });
  await page
    .locator('mat-form-field', { has: page.locator('mat-label', { hasText: 'Province' }) })
    .locator('.mat-mdc-text-field-wrapper')
    .click();
  await page.getByRole('option', { name: 'Ontario', exact: true }).click();
  await page.locator('.cdk-overlay-pane mat-option').first().waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Get started' }).click();
  await dialog.waitFor({ state: 'detached' });
  const section = page.locator('section[aria-labelledby="account-heading"]');
  await section.locator('ss-account-terms').first().waitFor({ timeout: 15000 });
  await section.scrollIntoViewIfNeeded();
  return { context, page, section, label };
}

async function axeCheck(page, label) {
  await sleep(500);
  await page.evaluate(axeSource);
  const result = await page.evaluate(() =>
    axe.run(document.querySelector('section[aria-labelledby="account-heading"]')),
  );
  check(
    `axe: ${label}`,
    result.violations.length === 0,
    result.violations
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
      .join('; '),
  );
}

/** Each account's lines, its text as shown, without the links' icon names. */
async function lines(section) {
  return section.locator('ss-account-terms').evaluateAll((terms) =>
    terms.map((term) =>
      [...term.querySelectorAll('li')].map((li) => {
        const copy = li.cloneNode(true);
        copy.querySelectorAll('mat-icon').forEach((icon) => icon.remove());
        return copy.textContent.replace(/\s+/g, ' ').trim();
      }),
    ),
  );
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    for (const colorScheme of ['light', 'dark']) {
      for (const viewport of [WIDE, NARROW]) {
        const { context, page, section, label } = await openGallery(browser, colorScheme, viewport);
        const shown = await lines(section);
        check(
          `${label}: the bank's account: what it is, two waivers, its limits and its CDIC cover in your name`,
          JSON.stringify(shown[0]) ===
            JSON.stringify([
              'Chequing account, in CAD',
              'No monthly fee if you keep $4,000 in it or you’re a student',
              '25 transactions a month included',
              'e-Transfers: up to $3,000 a day, $10,000 a week',
              'Protection: CDIC, up to $100,000, in your name, according to its page',
            ]),
          JSON.stringify(shown[0]),
        );
        check(
          `${label}: the fintech's: its interest by tier, what it moves with and its bonus, how soon it followed the Bank of Canada, held in trust, who may open it`,
          JSON.stringify(shown[1]) ===
            JSON.stringify([
              'Savings account, in CAD',
              'Interest: 3.50% a year, 2.00% from $50,000, on each part of the balance. It moves with the Bank of Canada’s rate. 4.00% instead if you have $2,000 of direct deposits a month posted rates',
              // How soon it followed the Bank's last changes (M11.14).
              'Following the Bank of Canada: not yet after Oct 29, 2026 (to 2.50%); 2 days after Oct 30, 2025 (to 2.25%); the same day as Sep 18, 2025 (to 2.50%)',
              'Protection: CDIC, held in trust for you, according to its page',
              'Open to you if you hold $100,000 with it',
            ]),
          JSON.stringify(shown[1]),
        );
        const links = await section
          .locator('a')
          .evaluateAll((anchors) =>
            anchors.map((a) => [a.getAttribute('href'), a.target, a.getAttribute('aria-label')]),
          );
        check(
          `${label}: each link opens its page in a new tab, the protection's scrolled to its words`,
          links.length === 3 &&
            links.every(([, target]) => target === '_blank') &&
            links[0][0] ===
              'https://example.com/deposit-insurance#:~:text=Your%20eligible%20deposits%20are%20protected%20by%20CDIC.' &&
            links[1][0] === 'https://example.com/rates',
          JSON.stringify(links),
        );
        // Tab from the posted-rates link reaches the protection link, whose tooltip is its quote.
        await section.locator('a').nth(1).focus();
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() =>
          document.activeElement?.getAttribute('aria-label'),
        );
        const tooltip = page.locator('.mat-mdc-tooltip-show');
        await tooltip.waitFor({ timeout: 5000 }).catch(() => undefined);
        const tip = (await tooltip.count()) > 0 ? (await tooltip.textContent()).trim() : '';
        check(
          `${label}: Tab reaches the protection link, its tooltip the provider's words`,
          focused === 'Page on who protects the money, opens in a new tab' &&
            tip === '“Your money is held in trust at CDIC member institutions.”',
          `${focused} / ${tip}`,
        );
        const looks = await section.evaluate((group) => {
          const probe = document.createElement('span');
          probe.style.color = 'var(--ss-text-muted)';
          group.append(probe);
          const muted = getComputedStyle(probe).color;
          probe.remove();
          return {
            muted: [...group.querySelectorAll('.terms')].every(
              (list) => getComputedStyle(list).color === muted,
            ),
            bold: getComputedStyle(group.querySelector('.subject')).fontWeight === '600',
          };
        });
        check(
          `${label}: its lines are the muted text, their subjects bold`,
          looks.muted && looks.bold,
          JSON.stringify(looks),
        );
        await page.keyboard.press('Escape');
        await section.screenshot({
          path: path.join(outDir, `accounts-${colorScheme}-${viewport.width}.png`),
        });
        await axeCheck(page, `${label}, the account terms`);
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
})();

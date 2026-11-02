// M11.3 in the system Edge: Search's Category list with the new service categories, and cards in them, on the real
// catalog (data:build's files), in both themes at 1280 and 360 px, for a Canadian in Alberta. Category by keyboard
// (Tab to it, at 360 px inside the Filters drawer), its list in categories.yaml's order with only categories something
// sold here is in, "ema" and Enter picking Email; Email keeping Proton's Free, Mail Plus and suites; AI assistants
// keeping Claude and Proton's suites, not its single products; Antivirus & device security keeping Bitdefender and
// Password managers & authenticators Bitdefender and Proton. Every service category's icon is a Material Symbols
// ligature. With axe (the list open, and the results), screenshots and no horizontal scroll. GET /fx is answered
// with fixed rates.
// Usage: node check-m11-categories.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

const expectedCategories = [
  'All',
  'Streaming video',
  'VPN',
  'Privacy suites',
  'Antivirus & device security',
  'Password managers & authenticators',
  'Email',
  'Calendars',
  'Cloud storage',
  'AI assistants',
  'Gaming',
];

/** Opens Search with `cat` and waits for its results. */
async function showCategory(page, category, shown) {
  await page.goto(`${baseUrl}search?cat=${category}`);
  await until(`${category}'s results`, async () => (await names(page)).includes(shown), 15000);
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

        // ── Category by keyboard ──────────────────────────────────────────────────────────────────
        if (viewport === NARROW) {
          await page.getByRole('searchbox').focus();
          await page.keyboard.press('Tab');
          await page.keyboard.press('Enter');
          await page.locator('mat-dialog-container').waitFor();
          // The drawer moves focus to its close button once it's open: Tab from there.
          await until('focus in the drawer', () =>
            page.evaluate(() => !!document.activeElement?.closest('mat-dialog-container')),
          );
        } else {
          await page.getByRole('searchbox').focus();
        }
        for (let i = 0; i < 12 && !/^combobox "Category/.test(await stop(page)); i++) {
          await page.keyboard.press('Tab');
        }
        await page.getByRole('option', { name: 'VPN', exact: true }).waitFor();
        const options = (await page.getByRole('option').allTextContents()).map((t) => t.trim());
        check(
          `${label}: Category lists the categories something sold here is in, in categories.yaml's order`,
          options.join() === expectedCategories.join(),
          options.join(', '),
        );
        await axeCheck(page, `${label}, the Category list open`);
        // After axe's wait, so the list has finished fading in.
        await page.screenshot({
          path: path.join(outDir, `category-list-${label.replace(' ', '-')}.png`),
        });
        await page.keyboard.type('ema');
        await until(
          'the list narrowed to Email',
          async () =>
            (await page.getByRole('option').allTextContents()).map((t) => t.trim()).join() ===
            'Email',
        );
        await page.keyboard.press('Enter');
        await until('cat=email', () => search(page) === '?cat=email');
        check(`${label}: "ema" and Enter pick Email`, true);
        if (viewport === NARROW) {
          await page.keyboard.press('Escape');
          await page.locator('mat-dialog-container').waitFor({ state: 'detached' });
        }

        // ── Cards in the new categories ───────────────────────────────────────────────────────────
        await until('Proton under Email', async () => (await names(page)).join() === 'Proton');
        const email = await chips(page, 'Proton');
        check(
          `${label}: Email keeps Proton's Free, Mail Plus and suites`,
          email.join() === 'Proton Free,Mail Plus,Proton Unlimited,Proton Duo,Proton Family',
          email.join(', '),
        );
        await card(page, 'Proton').screenshot({
          path: path.join(outDir, `proton-email-${label.replace(' ', '-')}.png`),
        });
        await axeCheck(page, `${label}, Proton under Email`);

        await showCategory(page, 'ai', 'Proton');
        const aiNames = await names(page);
        const ai = await chips(page, 'Proton');
        check(
          `${label}: AI assistants keeps Claude and Proton's Free and suites (Lumo Free), not its single products`,
          aiNames.slice().sort().join() === 'Claude,Proton' &&
            ai.join() === 'Proton Free,Proton Unlimited,Proton Duo,Proton Family',
          `${aiNames.join(', ')} / ${ai.join(', ')}`,
        );

        await showCategory(page, 'security', 'Bitdefender');
        check(
          `${label}: Antivirus & device security keeps Bitdefender only`,
          (await names(page)).join() === 'Bitdefender',
          (await names(page)).join(', '),
        );
        await card(page, 'Bitdefender').screenshot({
          path: path.join(outDir, `bitdefender-security-${label.replace(' ', '-')}.png`),
        });
        await axeCheck(page, `${label}, Bitdefender under Antivirus & device security`);

        await page.goto(`${baseUrl}search?cat=passwords`);
        await until('two results', async () => (await names(page)).length === 2, 15000);
        check(
          `${label}: Password managers & authenticators keeps Bitdefender and Proton`,
          (await names(page)).slice().sort().join() === 'Bitdefender,Proton',
          (await names(page)).join(', '),
        );
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        check(`${label}: nothing scrolls sideways`, width <= viewport.width, `${width}px`);

        // ── Every service category's icon is a ligature (once) ────────────────────────────────────
        if (colorScheme === 'light' && viewport === WIDE) {
          const icons = await page.evaluate(async (url) => {
            const body = await (await fetch(url)).json();
            const service = (body.data ?? body).service;
            const box = document.createElement('div');
            document.body.append(box);
            const sizes = service.map(({ id, icon }) => {
              const span = document.createElement('span');
              span.className = 'material-symbols-outlined';
              span.style.fontSize = '24px';
              span.textContent = icon;
              box.append(span);
              return { id, icon, span };
            });
            await document.fonts.ready;
            const result = sizes.map(({ id, icon, span }) => ({
              id,
              icon,
              width: span.getBoundingClientRect().width,
            }));
            box.remove();
            return result;
          }, `${baseUrl}data/catalog/categories.json`);
          const wrong = icons.filter((icon) => icon.width > 30);
          check(
            `every service category's icon (${icons.length}) is a Material Symbols ligature`,
            icons.length === 29 && wrong.length === 0,
            wrong.map((icon) => `${icon.id}: ${icon.icon} ${icon.width}px`).join(', '),
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

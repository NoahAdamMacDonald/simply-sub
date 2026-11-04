// M11.8 in the system Edge: Terms and policies in a file per provider, on the real catalog (data:build's files). The
// region file has no quotes and Proton has its file's policiesUrl. A first visit (light theme) opens Proton's card,
// which says "Loading its terms and policies…" while its file comes (held back 1.5 s), then shows them. A second visit
// in the same profile (dark theme), offline before any card opens, shows Proton's from what the first one kept, without
// asking for the file; Mullvad's, never opened, say they need a connection, and load once the browser is back online.
// Each note with axe, at 1280 and 360 px, screenshots and no horizontal scroll. GET /fx is answered with fixed rates.
// Usage: node check-m11-policies-out.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
const fs = require('fs');
const os = require('os');
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
const LOADING = 'Loading its terms and policies…';
const OFFLINE =
  'Its terms and policies need a connection the first time: they’ll show once you’re online.';
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

/** A visit: the browser on `profile`, kept between visits, and the policy files it asked for. */
async function visit(profile, { colorScheme, label }) {
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'msedge',
    locale: 'en-CA',
    colorScheme,
    viewport: WIDE,
    serviceWorkers: 'block',
  });
  await context.route('**/api/v1/fx?**', (route) =>
    route.fulfill({ json: fxBody(new URL(route.request().url()).searchParams.get('base')) }),
  );
  const asked = [];
  context.on('request', (request) => {
    const url = request.url();
    if (url.includes('/data/policies/')) asked.push(new URL(url).pathname);
  });
  const page = context.pages()[0] ?? (await context.newPage());
  page.on('console', (msg) => {
    const text = msg.text();
    // Offline, the browser logs each request it couldn't send (icons, the policies file).
    const offline = text.includes('ERR_INTERNET_DISCONNECTED');
    const blockedWorker = text === 'Service Worker registration blocked by Playwright';
    if ((msg.type() === 'error' || msg.type() === 'warning') && !offline && !blockedWorker) {
      consoleProblems.push(`[${label}] ${msg.type()}: ${text}`);
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  return { context, page, asked };
}

async function openSearch(page, { firstRun }) {
  await page.goto(`${baseUrl}search`);
  if (firstRun) {
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

/** Opens a card's details. */
async function open(page, name) {
  const found = card(page, name);
  await found.scrollIntoViewIfNeeded();
  await found.locator('button.expand').click();
  return found;
}

/** The card's Terms and policies note (`.policy-note`) and graded lines, as shown now, read at once. */
async function terms(found) {
  return found.evaluate((element) => {
    const note = element.querySelector('.policy-note');
    return {
      note: note?.textContent.trim(),
      role: note?.getAttribute('role') ?? undefined,
      lines: element.querySelectorAll('.policies li').length,
    };
  });
}

async function noSideScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

/** Shows the note's group on screen and saves the viewport. */
async function shoot(page, found, file) {
  await found.locator('.policy-note').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outDir, file) });
}

(async () => {
  await waitForServer();

  // ── The files data:build wrote ─────────────────────────────────────────────────────────────────────────
  const region = await (await fetch(`${baseUrl}data/catalog/CA.json`)).json();
  const proton = region.data.providers.find((provider) => provider.id === 'proton');
  check(
    'CA.json holds no policies or shared documents, and Proton points to its file',
    region.data.providers.every((provider) => provider.policies === undefined) &&
      region.data.policySets === undefined &&
      proton?.policiesUrl === 'https://sub.simplely.ca/data/policies/proton.json',
    proton?.policiesUrl,
  );
  const index = await (await fetch(`${baseUrl}data/policies/index.json`)).json();
  check(
    'policies/index.json lists each provider’s pages and the shared documents',
    index.providers.proton?.links.length > 0 &&
      Object.keys(index.sets).includes('disney-privacy') &&
      index.providers['disney-plus']?.shared?.includes('disney-privacy'),
    `${Object.keys(index.providers).length} providers, ${Object.keys(index.sets).length} sets`,
  );

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'policies-out-'));
  try {
    // ── First visit, light: Proton's file loads as its card opens ────────────────────────────────────────
    {
      const { context, page, asked } = await visit(profile, {
        colorScheme: 'light',
        label: 'first visit',
      });
      try {
        // Held back, so the note can be seen.
        await context.route('**/data/policies/proton.json', async (route) => {
          await sleep(1500);
          await route.continue();
        });
        await openSearch(page, { firstRun: true });
        const found = await open(page, 'Proton');
        await found.locator('.policy-note').waitFor();
        const loading = await terms(found);
        check(
          'light 1280: Proton says it’s loading its terms and policies, as a status',
          loading.note === LOADING && loading.role === 'status' && loading.lines === 0,
          JSON.stringify(loading),
        );
        await shoot(page, found, 'policies-out-loading-light-1280.png');
        await axeCheck(page, 'light 1280, loading');
        // The note shows on Overview while they load; the rated lines are on Terms (the owner's design, 2026-11-03).
        await found.getByRole('tab', { name: 'Terms' }).click();
        await found.locator('.policies li').first().waitFor();
        const loaded = await terms(found);
        check(
          'light 1280: then shows them, the note gone, from its own file',
          loaded.note === undefined &&
            loaded.lines > 5 &&
            asked.includes('/data/policies/proton.json'),
          `${loaded.lines} lines; asked ${asked.join(', ')}`,
        );

        // The same at 360 px, on Netflix's card.
        await page.setViewportSize(NARROW);
        await context.route('**/data/policies/netflix.json', async (route) => {
          await sleep(1500);
          await route.continue();
        });
        const netflix = await open(page, 'Netflix');
        await netflix.locator('.policy-note').waitFor();
        check(
          'light 360: Netflix says it’s loading, with no horizontal scroll',
          (await terms(netflix)).note === LOADING && (await noSideScroll(page)),
        );
        await shoot(page, netflix, 'policies-out-loading-light-360.png');
        await axeCheck(page, 'light 360, loading');
        await netflix.getByRole('tab', { name: 'Terms' }).click();
        await netflix.locator('.policies li').first().waitFor();
      } finally {
        await context.close();
      }
    }

    // ── Second visit, dark, offline before a card opens ─────────────────────────────────────────────────
    {
      const { context, page, asked } = await visit(profile, {
        colorScheme: 'dark',
        label: 'second visit',
      });
      try {
        await openSearch(page, { firstRun: false });
        // The start's catalog check done first, so it's the cards that meet the lost connection.
        await sleep(2000);
        await context.setOffline(true);
        const found = await open(page, 'Proton');
        await found.getByRole('tab', { name: 'Terms' }).click();
        await found.locator('.policies li').first().waitFor({ timeout: 10000 });
        const kept = await terms(found);
        check(
          'dark 1280, offline: Proton’s terms and policies show from the first visit’s file, unasked',
          kept.note === undefined &&
            kept.lines > 5 &&
            !asked.includes('/data/policies/proton.json'),
          `${kept.lines} lines; asked ${asked.join(', ') || 'nothing'}`,
        );
        await page.screenshot({ path: path.join(outDir, 'policies-out-kept-dark-1280.png') });

        const mullvad = await open(page, 'Mullvad VPN');
        await mullvad
          .locator('.policy-note', { hasText: 'connection' })
          .waitFor({ timeout: 10000 });
        const first = await terms(mullvad);
        check(
          'dark 1280, offline: Mullvad’s, never opened, say they need a connection, as a status',
          first.note === OFFLINE && first.role === 'status' && first.lines === 0,
          JSON.stringify(first),
        );
        await shoot(page, mullvad, 'policies-out-offline-dark-1280.png');
        await axeCheck(page, 'dark 1280, offline');

        await page.setViewportSize(NARROW);
        await sleep(500);
        check('dark 360, offline: no horizontal scroll', await noSideScroll(page));
        await shoot(page, mullvad, 'policies-out-offline-dark-360.png');
        await axeCheck(page, 'dark 360, offline');

        await context.setOffline(false);
        await mullvad.getByRole('tab', { name: 'Terms' }).click();
        await mullvad.locator('.policies li').first().waitFor({ timeout: 10000 });
        await mullvad.locator('.policy-note').waitFor({ state: 'detached', timeout: 10000 });
        const back = await terms(mullvad);
        check(
          'dark 360: back online, Mullvad’s load by themselves',
          back.note === undefined &&
            back.lines > 5 &&
            asked.includes('/data/policies/mullvad.json'),
          `${back.lines} lines`,
        );
      } finally {
        await context.close();
      }
    }
  } catch (error) {
    check('the run finished', false, error.message.split('\n')[0]);
  } finally {
    // Edge lets go of its profile a moment after it closes.
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    } catch (error) {
      console.log(`(the profile ${profile} is left: ${error.code})`);
    }
  }

  check(
    'no console errors or warnings',
    consoleProblems.length === 0,
    consoleProblems.join(' || '),
  );
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exitCode = failed > 0 ? 1 : 0;
})();

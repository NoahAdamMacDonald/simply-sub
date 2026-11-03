// M11.1 in the system Edge: policy topics v2 on a Search card's Terms and policies, on the real catalog (data:build's
// files), in both themes at 1280 and 360 px. For a Canadian in Alberta, ICI TOU.TV's grey lines (Account sharing and
// Device and download limits Not stated; its free trial graded since M11.9, Poor since its review) and Mullvad's Closing your account Not
// stated, its citation the page read, reached by Tab with the page's name as its tooltip, and Disney+'s sharing and ads Poor
// (Disney's shared privacy policy outside the US, M11.9); for a US user, Hulu's ratings from that policy beside its
// own data sharing, with one Sources link, and Disney+'s US ratings over the policy's others. With axe, screenshots
// and no horizontal scroll. GET /fx is answered with fixed rates.
// Usage: node check-m11-policies.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

/** Opens a card's details and returns its Terms and policies, once they've finished sliding open. */
async function policies(page, name) {
  const found = card(page, name);
  await found.scrollIntoViewIfNeeded();
  await found.locator('button.expand').click();
  const section = found.locator('.group', {
    has: page.getByRole('heading', { name: 'Terms and policies' }),
  });
  await section.waitFor();
  await sleep(1000);
  return section;
}

/** Each line: its dot's grade id, whether it's unrated, then its words as shown. */
async function rows(section) {
  return section.locator('.policies li').evaluateAll((items) =>
    items.map((item) => {
      const copy = item.querySelector('.rated').cloneNode(true);
      copy.querySelectorAll('.visually-hidden').forEach((node) => node.remove());
      const unrated = item.classList.contains('unrated') ? 'grey ' : '';
      return `${unrated}${item.querySelector('.dot').dataset.tier} | ${copy.textContent.replace(/\s+/g, ' ').trim()}`;
    }),
  );
}

/** Whether the unrated lines' topic is the muted grey and their dot --policy-none, against the tokens. */
async function greyLooks(section) {
  return section.evaluate((group) => {
    const resolved = (property, name) => {
      const probe = document.createElement('span');
      probe.style[property] = `var(${name})`;
      group.append(probe);
      const value = getComputedStyle(probe)[property];
      probe.remove();
      return value;
    };
    const lines = [...group.querySelectorAll('.policies li.unrated')];
    const graded = group.querySelector('.policies li:not(.unrated) .topic');
    return {
      lines: lines.length,
      topicMuted: lines.every(
        (line) =>
          getComputedStyle(line.querySelector('.topic')).color ===
          resolved('color', '--ss-text-muted'),
      ),
      gradeMuted: lines.every(
        (line) =>
          getComputedStyle(line.querySelector('.grade')).color ===
          resolved('color', '--ss-text-muted'),
      ),
      dotGrey: lines.every(
        (line) =>
          getComputedStyle(line.querySelector('.dot')).backgroundColor ===
          resolved('backgroundColor', '--policy-none'),
      ),
      dotHidden: lines.every((line) => line.querySelector('.dot').ariaHidden === 'true'),
      gradedNotMuted: !graded || getComputedStyle(graded).color === resolved('color', '--ss-text'),
    };
  });
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    for (const colorScheme of ['light', 'dark']) {
      for (const viewport of [WIDE, NARROW]) {
        const label = `${colorScheme} ${viewport.width}`;
        // ── A Canadian in Alberta: ICI TOU.TV's and Mullvad's statuses ─────────────────────────────────
        {
          const { context, page } = await newContext(browser, {
            locale: 'en-CA',
            colorScheme,
            viewport,
          });
          await openSearch(page, 'Alberta');
          const tou = await policies(page, 'ICI TOU.TV');
          const touRows = await rows(tou);
          check(
            `${label}: ICI TOU.TV's sharing and device limits Not stated, each grey with its reason; its free trial graded Poor (M11.9's review)`,
            touRows.some((row) =>
              row.startsWith(
                'poor | Free trials (Poor): Your first subscription starts with 7 free days, but you give your payment details',
              ),
            ) &&
              touRows.includes(
                'grey none | Account sharing (Not stated): Its conditions say your username and password are for your personal use, but not whether the people you live with may use your account. [1]',
              ) &&
              touRows.includes(
                'grey none | Device and download limits (Not stated): Its conditions name no limit beyond how many screens can play at once, which its plan shows. [1]',
              ),
            touRows.filter((row) => row.startsWith('grey')).join(' | '),
          );
          const looks = await greyLooks(tou);
          check(
            `${label}: a grey line's topic, grade and dot are the muted grey, hidden dot; a graded topic isn't`,
            // Its three, and the topics rated since (#113).
            looks.lines >= 3 &&
              looks.topicMuted &&
              looks.gradeMuted &&
              looks.dotGrey &&
              looks.dotHidden &&
              looks.gradedNotMuted,
            JSON.stringify(looks),
          );
          const groups = await tou.locator('h4').allTextContents();
          check(
            `${label}: ICI TOU.TV's Service group holds its Not stated lines`,
            groups.includes('Service'),
            groups.join(', '),
          );
          await tou.screenshot({
            path: path.join(outDir, `tou-${colorScheme}-${viewport.width}.png`),
          });
          await axeCheck(page, `${label}, ICI TOU.TV's Terms and policies`);

          const mullvad = await policies(page, 'Mullvad VPN');
          const closure = mullvad.locator('.policies li', {
            has: page.locator('.topic', { hasText: /^Closing your account$/ }),
          });
          const closureRow = (await rows(mullvad)).find((row) =>
            row.includes('Closing your account'),
          );
          const cite = closure.locator('.cite');
          check(
            `${label}: Mullvad's Closing your account is Not stated, citing its terms with no words to scroll to`,
            closureRow ===
              "grey none | Closing your account (Not stated): Its terms don't say whether it can close your account, or what happens to time you've paid for. [1]" &&
              (await cite.getAttribute('href')) === 'https://mullvad.net/en/help/terms-service',
            closureRow,
          );
          const mullvadRows = await rows(mullvad);
          check(
            `${label}: Mullvad's notable term is named by its title, and its security checks graded`,
            mullvadRows.includes(
              'great | Pay with cash in the mail (Great): You can pay by putting cash in an envelope and mailing it, so you never have to give it your name or a card. [5]',
            ) && mullvadRows.some((row) => row.startsWith('good | Security checks (Good):')),
            mullvadRows.filter((row) => /Pay with cash|Security checks/.test(row)).join(' | '),
          );
          const notable = await mullvad.locator('h4').allTextContents();
          check(
            `${label}: the Security and Notable groups follow the registry's order`,
            notable.join() === 'Privacy,Billing,Legal,Security,Service,Notable',
            notable.join(', '),
          );
          // Keyboard: Tab from the citation before it lands on its own, whose tooltip names the page.
          const all = mullvad.locator('.cite');
          const hrefs = await all.evaluateAll((anchors) =>
            anchors.map((a) => a.getAttribute('href')),
          );
          const at = hrefs.indexOf('https://mullvad.net/en/help/terms-service');
          await all.nth(at - 1).focus();
          await page.keyboard.press('Tab');
          const focused = await page.evaluate(() => document.activeElement?.getAttribute('href'));
          const tooltip = page.locator('.mat-mdc-tooltip-show');
          await tooltip.waitFor({ timeout: 5000 }).catch(() => undefined);
          const tip = (await tooltip.count()) > 0 ? (await tooltip.textContent()).trim() : '';
          check(
            `${label}: Tab reaches the Not stated line's citation, its tooltip the page's name`,
            focused === 'https://mullvad.net/en/help/terms-service' && tip === 'Terms of service',
            `${focused} / ${tip}`,
          );
          await page.screenshot({
            path: path.join(outDir, `mullvad-closure-${colorScheme}-${viewport.width}.png`),
          });
          await axeCheck(
            page,
            `${label}, Mullvad's Terms and policies, a Not stated citation's tooltip`,
          );

          // Outside the US, Disney's only controls are each service's cookie settings: Poor (M11.9).
          const disneyCa = await policies(page, 'Disney+');
          const disneyCaRows = await rows(disneyCa);
          check(
            `${label}: Disney+ in Canada shows the shared policy's Poor sharing and ads, its cookie settings the only control`,
            disneyCaRows.some(
              (row) =>
                row.startsWith(
                  'poor | Selling or sharing data (Poor): It gives some details about you, like ID codes or a scrambled copy of your email address',
                ) && row.includes('Outside the US'),
            ) &&
              disneyCaRows.some(
                (row) =>
                  row.startsWith('poor | Ads and tracking (Poor): It picks the ads you see') &&
                  row.includes('Outside the US'),
              ),
            disneyCaRows.filter((row) => /sharing data|Ads and tracking/.test(row)).join(' | '),
          );
          // Its own rating over the shared agreement's: the agreement allows what the plan's tier permits (M11.9).
          check(
            `${label}: Disney+'s own Account sharing (Neutral, Extra Members) replaces the agreement's Poor`,
            disneyCaRows.some((row) =>
              row.startsWith(
                'neutral | Account sharing (Neutral): Only the people who live with you can use your account, and it can check, but you can pay to add an Extra Member',
              ),
            ) && !disneyCaRows.some((row) => row.startsWith('poor | Account sharing')),
            disneyCaRows.filter((row) => row.includes('Account sharing')).join(' | '),
          );
          await disneyCa.screenshot({
            path: path.join(outDir, `disney-ca-${colorScheme}-${viewport.width}.png`),
          });
          await axeCheck(page, `${label}, Disney+'s Terms and policies in Canada`);
          const width = await page.evaluate(() => document.documentElement.scrollWidth);
          check(`${label}: nothing scrolls sideways`, width <= viewport.width, `${width}px`);
          await context.close();
        }
        // ── A US user: Hulu with Disney's shared privacy policy ──────────────────────────────────────────
        {
          const { context, page } = await newContext(browser, {
            locale: 'en-US',
            colorScheme,
            viewport,
          });
          await openSearch(page);
          const hulu = await policies(page, 'Hulu');
          const huluRows = await rows(hulu);
          const links = await hulu.locator('.policy-links a').allTextContents();
          check(
            `${label}: Hulu shows Disney's shared privacy ratings beside its own data sharing, with one source`,
            huluRows.some((row) =>
              row.startsWith('poor | Data collection (Poor): It follows what you do'),
            ) &&
              // Its own sharing and the policy's US rating tie: its own shows (M11.1).
              huluRows.some((row) =>
                row.startsWith(
                  'neutral | Selling or sharing data (Neutral): It gives ID codes or a scrambled email address to ad companies, and data to partners',
                ),
              ) &&
              huluRows.some((row) =>
                row.startsWith(
                  'neutral | Ads and tracking (Neutral): In the US, you can turn off ads',
                ),
              ) &&
              huluRows.some((row) => row.startsWith('neutral | Deleting your data (Neutral):')) &&
              // Disney's privacy policy listed once, its own pages after it.
              links.filter((link) => link.includes('Privacy policy')).length === 1 &&
              links[0].replace(/\s+/g, ' ').includes('[1] Privacy policy'),
            `${huluRows.join(' | ')} / ${links.join(', ')}`,
          );
          const disney = await policies(page, 'Disney+');
          const disneyRows = await rows(disney);
          check(
            `${label}: Disney+ shows the same shared ratings, with the policy's US data sharing over its Poor one`,
            disneyRows.some((row) =>
              row.startsWith(
                'neutral | Selling or sharing data (Neutral): In the US, you can say no to it giving your details to ad companies',
              ),
            ) && disneyRows.length >= 4,
            disneyRows.join(' | '),
          );
          await hulu.screenshot({
            path: path.join(outDir, `hulu-${colorScheme}-${viewport.width}.png`),
          });
          await axeCheck(page, `${label}, Hulu's and Disney+'s Terms and policies`);
          const width = await page.evaluate(() => document.documentElement.scrollWidth);
          check(`${label}: nothing scrolls sideways (US)`, width <= viewport.width, `${width}px`);
          await context.close();
        }
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

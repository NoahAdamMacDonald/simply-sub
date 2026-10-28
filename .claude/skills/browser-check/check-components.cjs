// M4.5 in the system Edge: the shared components on the /dev/components gallery (dev builds only), for a Canadian,
// in both themes at 1280 and 360 px, by keyboard, with axe: budget bars, provider icons, status badges, rank dots,
// chips, counts and selects, the feature summary and list, the mini calendar, tags (creating one in IndexedDB), the
// split button, the empty state and ss-confirm. ss-price has its own script, check-prices.cjs.
// Usage: node check-components.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

async function until(what, condition, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await condition();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** The gallery's "File missing" icon is a deliberate 404. */
const expected404 = (msg) => msg.location().url.endsWith('/icons/missing.webp');

async function newPage(browser, { colorScheme = 'light', viewport = WIDE } = {}) {
  const label = `${colorScheme} ${viewport.width}`;
  const context = await browser.newContext({ locale: 'en-CA', colorScheme, viewport });
  // FxStore asks for rates on start; the dev server has no Worker behind /api.
  await context.route('**/api/v1/fx?**', (route) =>
    route.fulfill({
      json: {
        data: {
          base: 'CAD',
          date: '2026-10-21',
          source: 'European Central Bank via Frankfurter',
          rates: { EUR: 0.664, GBP: 0.5571, USD: 0.7243 },
        },
        meta: { fetchedAt: '2026-10-22T06:00:02Z', stale: false },
      },
    }),
  );
  const page = await context.newPage();
  page.on('console', (msg) => {
    if ((msg.type() === 'error' || msg.type() === 'warning') && !expected404(msg)) {
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  await page.goto(`${baseUrl}dev/components`);
  // The first-run dialog: a Canadian picks Ontario.
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
  await page.locator('ss-feature-list li').first().waitFor({ timeout: 15000 });
  return { context, page, label };
}

const section = (page, heading) => page.locator(`section[aria-labelledby="${heading}-heading"]`);

async function focused(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    return {
      tag: element?.tagName.toLowerCase(),
      text: element?.textContent?.replace(/\s+/g, ' ').trim(),
      label: element?.getAttribute('aria-label'),
      date: element?.getAttribute('data-date'),
      role: element?.getAttribute('role'),
    };
  });
}

/** Tabs until `match` says the focused element is the one wanted. */
async function tabTo(page, what, match, limit = 200) {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    if (match(await focused(page))) return true;
  }
  throw new Error(`Tab never reached ${what}`);
}

async function axe(page, label) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document);
    // Material puts popups (menus, select panels) in an overlay container on <body>, outside the page's landmarks,
    // where axe's best-practice `region` rule flags their text. Every other rule still checks them.
    const inOverlay = (node) =>
      node.target.length === 1 &&
      !!document.querySelector(node.target[0])?.closest('.cdk-overlay-container');
    return result.violations
      .map((v) => ({
        ...v,
        nodes: v.id === 'region' ? v.nodes.filter((n) => !inOverlay(n)) : v.nodes,
      }))
      .filter((v) => v.nodes.length > 0)
      .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(' ')) }));
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

async function budgetBars(page) {
  const bars = await section(page, 'budget').evaluate((element) =>
    Array.from(element.querySelectorAll('.bar')).map((bar) => {
      const progress = bar.querySelector('ss-budget-bar');
      const box = progress.getBoundingClientRect();
      const label = progress.querySelector('.label').getBoundingClientRect();
      const fill = progress.querySelector('.fill').getBoundingClientRect();
      const marker = progress.querySelector('.marker');
      return {
        name: bar.querySelector('.bar-name').textContent.trim(),
        text: progress.querySelector('.label').textContent.trim(),
        level: progress.dataset.level,
        valueText: progress.getAttribute('aria-valuetext'),
        role: progress.getAttribute('role'),
        labelledBy: document
          .getElementById(progress.getAttribute('aria-labelledby'))
          ?.textContent.trim(),
        inside: label.left >= box.left - 0.5 && label.right <= box.right + 0.5,
        labelRight: label.right,
        fillRight: fill.right,
        labelLeft: label.left,
        boxLeft: box.left,
        marker: marker ? marker.getBoundingClientRect().left - box.left : null,
        width: box.width,
      };
    }),
  );
  const byName = Object.fromEntries(bars.map((bar) => [bar.name, bar]));
  const expected = {
    'Half the monthly budget': ['50%', 'ok', '50%, $100.00 of $200.00'],
    'A short fill': ['12%', 'ok', '12%, $24.00 of $200.00'],
    'Almost nothing': ['2%', 'ok', '2%, $4.00 of $200.00'],
    // Renamed for the bars' colour scale (M7.7): its level is still warn from 75%.
    'Most of the budget, nearly yellow': ['80%', 'warn', '80%, $160.00 of $200.00'],
    'Exactly the budget': ['100%', 'warn', '100%, $200.00 of $200.00'],
    'Over the budget': ['112%', 'over', '112%, $224.00 of $200.00'],
    'Calendar: over the budget': ['$44.45', 'over', '$44.45 of $66.45, budget $60.00'],
    'Calendar: well within it': ['$10.00', 'ok', '$10.00 of $40.00, budget $60.00'],
    'Calendar: no payments': ['$0.00', 'ok', '$0.00 of $0.00, budget $60.00'],
  };
  for (const [name, [text, level, valueText]] of Object.entries(expected)) {
    const bar = byName[name];
    check(
      `budget bar "${name}": ${text}, ${level}, "${valueText}"`,
      bar?.text === text && bar.level === level && bar.valueText === valueText,
      JSON.stringify(bar && { text: bar.text, level: bar.level, valueText: bar.valueText }),
    );
  }
  check(
    'budget bars are progressbars named by their heading',
    bars.every((bar) => bar.role === 'progressbar' && bar.labelledBy === bar.name),
  );
  check(
    'every label stays inside its bar',
    bars.every((bar) => bar.inside),
    bars
      .filter((bar) => !bar.inside)
      .map((bar) => bar.name)
      .join(', '),
  );
  const half = byName['Half the monthly budget'];
  check(
    "a label that fits ends at the fill's end",
    Math.abs(half.labelRight - half.fillRight) < 1,
    `${half.labelRight} vs ${half.fillRight}`,
  );
  const short = byName['Almost nothing'];
  check(
    "a label longer than its fill starts at the bar's left edge",
    Math.abs(short.labelLeft - short.boxLeft) < 1 && short.labelRight > short.fillRight,
  );
  const over = byName['Calendar: over the budget'];
  check(
    'the Calendar tick sits at the budget',
    over.marker !== null && Math.abs(over.marker - (60 / 66.45) * over.width) < 3,
    `${over.marker} of ${over.width}`,
  );
  check('no tick past the end of the bar', byName['Calendar: well within it'].marker === null);
}

async function icons(page) {
  // Icons load lazily (NgOptimizedImage), so each is brought into view first: the catalog's are a long column now.
  for (const icon of await section(page, 'icon').locator('.icon-case img').all()) {
    await icon.scrollIntoViewIfNeeded();
  }
  // Every icon but the deliberately missing file, which falls back to its letter.
  await page
    .waitForFunction(() =>
      Array.from(document.querySelectorAll('.icon-case img')).every(
        (img) =>
          img.getAttribute('src')?.endsWith('missing.webp') ||
          (img.complete && img.naturalWidth > 0),
      ),
    )
    .catch(() => undefined);
  const results = await section(page, 'icon').evaluate((element) =>
    Array.from(element.querySelectorAll('.icon-case')).map((icon) => ({
      text: icon.textContent.replace(/\s+/g, ' ').trim(),
      images: Array.from(icon.querySelectorAll('img')).map((img) => ({
        loaded: img.complete && img.naturalWidth > 0,
        alt: img.getAttribute('alt'),
        width: img.getBoundingClientRect().width,
      })),
      letters: Array.from(icon.querySelectorAll('.letter')).map((letter) =>
        letter.textContent.trim(),
      ),
    })),
  );
  const catalog = results.filter((icon) => icon.images.length === 1 && icon.letters.length === 0);
  check(
    "the catalog's icons load, as decoration",
    catalog.length >= 4 &&
      catalog.every((icon) => icon.images[0].loaded && icon.images[0].alt === ''),
    catalog.map((icon) => icon.text).join(', '),
  );
  const missing = results.find((icon) => icon.text.endsWith('File missing'));
  check(
    "a file that doesn't load shows the letter",
    missing?.images.length === 0 && missing.letters[0] === 'S',
    JSON.stringify(missing),
  );
  const noIcon = results.find((icon) => icon.text.endsWith('No icon'));
  check('no icon shows the letter', noIcon?.letters[0] === 'L');
  const capped = results.find((icon) => icon.text.includes('64 px asked'));
  check(
    '64 px is shown at 48',
    Math.round(capped?.images[0]?.width) === 48,
    JSON.stringify(capped),
  );
}

async function statuses(page) {
  const texts = await section(page, 'status').evaluate((element) =>
    Array.from(element.querySelectorAll('li')).map((item) => {
      const copy = item.querySelector('ss-status-badge').cloneNode(true);
      copy.querySelectorAll('mat-icon').forEach((icon) => icon.remove());
      return copy.textContent.replace(/\s+/g, ' ').trim();
    }),
  );
  const expected = [
    'Active',
    'Active Ends Nov 3',
    'Active Renew by Nov 3',
    'Inactive · active from Sep 10, 2027',
    'Inactive',
    'Active · 2 lists',
    'Not listed',
  ];
  check('status badges', JSON.stringify(texts) === JSON.stringify(expected), JSON.stringify(texts));
}

async function ranks(page) {
  const chips = await section(page, 'rank')
    .locator('ss-rank-chip')
    .evaluateAll((all) => all.map((chip) => chip.textContent.trim()));
  check(
    'rank chips name every rank',
    chips.join(',') ===
      'Essential,Critical,Needed,Wanted,Uses,Sometimes,Not ranked,Unused,Unwanted',
    chips.join(','),
  );

  const counts = await section(page, 'counts')
    .locator('ss-rank-counts')
    .first()
    .evaluate((element) =>
      Array.from(element.querySelectorAll('li')).map((item) => ({
        text: item.textContent.trim(),
        colour: getComputedStyle(item).color,
      })),
    );
  const grey = await section(page, 'counts')
    .locator('ss-rank-counts')
    .nth(1)
    .evaluate((element) => getComputedStyle(element.querySelector('li')).color);
  check(
    'rank counts: two columns of all eight, a zero in grey',
    counts.length === 8 &&
      counts[1].text === '0 Critical' &&
      counts[1].colour === grey &&
      counts[0].colour !== grey,
    JSON.stringify(counts.slice(0, 2)),
  );
  const summary = await section(page, 'counts')
    .locator('ss-feature-summary li')
    .evaluateAll((all) =>
      all.map((item) => ({
        shown: Array.from(item.querySelectorAll(':scope > :not(.visually-hidden)'))
          .map((part) => part.textContent.trim())
          .join(' '),
        spoken: item.querySelector('.visually-hidden').textContent.trim(),
      })),
    );
  check(
    'feature summary: "VPN: 2 / 3", read as "2 of 3 active"',
    summary[0].shown === 'VPN: 2 / 3' && summary[0].spoken === '2 of 3 active',
    JSON.stringify(summary[0]),
  );

  // The rank selects, by keyboard.
  const value = (row) => section(page, 'select').locator('.value').nth(row).textContent();
  const adFree = page.getByRole('combobox', { name: /^Ad free/ });
  check('rank select is named by its row', (await adFree.count()) === 1);
  await adFree.focus();
  await page.keyboard.press('Enter');
  await page.locator('.ss-rank-select-panel mat-option').first().waitFor();
  const profileOptions = await page
    .locator('.ss-rank-select-panel mat-option')
    .evaluateAll((all) => all.map((option) => option.textContent.replace(/\s+/g, ' ').trim()));
  check(
    'profile options: Not ranked first',
    profileOptions.join(',') === 'Not ranked,Needed,Wanted,Uses,Sometimes,Unused,Unwanted',
    profileOptions.join(','),
  );
  // From Needed, down to Wanted.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await until('Ad free is Wanted', async () => (await value(0)).trim() === 'wanted');
  check('keyboard: a profile rank is picked', true);
  check(
    'focus returns to the select',
    (await focused(page)).role === 'combobox',
    JSON.stringify(await focused(page)),
  );

  const quality = page.getByRole('combobox', { name: /^Video quality/ });
  check(
    'an item override starts on the profile default',
    (await quality.textContent()).replace(/\s+/g, ' ').trim() === 'Profile default (Wanted)',
    await quality.textContent(),
  );
  // The profile select's panel fades out after its pick: wait for it to go, so only this one's options are read.
  await page.locator('.ss-rank-select-panel').waitFor({ state: 'detached' });
  await quality.focus();
  await page.keyboard.press('Enter');
  await page.locator('.ss-rank-select-panel mat-option').first().waitFor();
  const itemOptions = await page
    .locator('.ss-rank-select-panel mat-option')
    .evaluateAll((all) => all.map((option) => option.innerText.replace(/\s+/g, ' ').trim()));
  check(
    'item options: the profile default, then Essential and Critical with hints',
    itemOptions[0] === 'Profile default (Wanted)' &&
      itemOptions[1] === 'Essential Keep this plan' &&
      itemOptions[2] === 'Critical Keep this provider' &&
      itemOptions.length === 10,
    itemOptions.join(' | '),
  );
  await page.screenshot({ path: path.join(outDir, 'rank-select-open.png') });
  await axe(page, 'rank select open');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await until('override Essential', async () => (await value(1)).trim() === 'essential');
  await page.keyboard.press('Enter');
  await page.locator('.ss-rank-select-panel mat-option').first().waitFor();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await until('back to the default', async () => (await value(1)).includes('profile default'));
  check('keyboard: an override is set, then cleared with the profile default', true);
}

async function featureList(page) {
  const lines = await section(page, 'features')
    .locator('.feature')
    .evaluateAll((all) => all.map((line) => line.innerText.replace(/\s+/g, ' ').trim()));
  check(
    'feature list: the richest plan, VPN with its features under it, ranks shown',
    lines.some((line) => /^VPN Needed$/.test(line)) &&
      lines.some((line) => line.startsWith('VPN protocols: ')) &&
      lines.some((line) => /Wanted · WireGuard/.test(line)),
    lines.slice(0, 8).join(' | '),
  );
}

/** `date` plus `days`, or plus `months` on the same day (or the month's last), as core's addDays and addMonths. */
function shifted(date, { days = 0, months = 0 }) {
  const [year, month, day] = date.split('-').map(Number);
  const last = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, last) + days))
    .toISOString()
    .slice(0, 10);
}

async function miniCalendar(page) {
  const calendar = section(page, 'calendar');
  const status = calendar.locator('.picked');
  const title = async () => (await calendar.locator('.title').textContent()).trim();
  const start = await title();
  await tabTo(page, 'the grid', (element) => element.date !== null && element.date !== undefined);
  const today = (await focused(page)).date;
  check(
    'the grid is one tab stop, on today',
    (await calendar.locator('.day[tabindex="0"]').count()) === 1 &&
      (await calendar.locator('[aria-current="date"]').getAttribute('data-date')) === today,
    today,
  );
  // A key that changes the month moves focus once the grid shows it, a frame later.
  const press = async (key, date) => {
    await page.keyboard.press(key);
    await until(`${key} to ${date}`, async () => (await focused(page)).date === date, 3000).catch(
      () => false,
    );
    return (await focused(page)).date;
  };
  const right = shifted(today, { days: 1 });
  const down = shifted(right, { days: 7 });
  check('Arrow Right moves a day', (await press('ArrowRight', right)) === right);
  check('Arrow Down moves a week', (await press('ArrowDown', down)) === down);
  const nextMonth = shifted(down, { months: 1 });
  check('Page Down moves a month', (await press('PageDown', nextMonth)) === nextMonth);
  check('… and the title follows', (await title()) !== start, `${start} → ${await title()}`);
  check('Page Up moves back', (await press('PageUp', down)) === down);
  check(
    'Home goes to Sunday',
    (await press('Home', shifted(down, { days: -new Date(`${down}T00:00:00Z`).getUTCDay() }))) !==
      down,
  );
  await page.keyboard.press('Enter');
  const day = (await focused(page)).date;
  await until('day clicked', async () => (await status.textContent()).trim() === `Day ${day}`);
  check('Enter on a day emits it', true);

  // A payment day, reached by keyboard (Material shows tooltips on keyboard focus): named with its count, described
  // by its payments.
  const payday = calendar.locator('.day.paid').first();
  const paydate = await payday.getAttribute('data-date');
  await calendar.locator(`[data-date="${shifted(paydate, { days: -1 })}"]`).focus();
  await press('ArrowRight', paydate);
  const tooltip = page.locator('.mat-mdc-tooltip-surface, .mdc-tooltip__surface').first();
  await until('tooltip', async () => (await tooltip.count()) > 0);
  const label = await payday.getAttribute('aria-label');
  const description = await page.evaluate(() => {
    const id = document.activeElement?.getAttribute('aria-describedby');
    return id ? document.getElementById(id)?.textContent : null;
  });
  check(
    'a payment day is named with its count and described by its payments',
    /, 1 payment$/.test(label) && description === 'Mullvad VPN ≈ $7.53 (renew manually)',
    `${label} / ${description}`,
  );
  await page.screenshot({ path: path.join(outDir, 'mini-calendar-tooltip.png') });
  await page.keyboard.press('Escape');

  const before = await title();
  await calendar.getByRole('button', { name: 'Next month' }).click();
  await until('next month', async () => (await title()) !== before);
  check('› shows the next month', true);
  await calendar.locator('.title').click();
  await until('month clicked', async () => (await status.textContent()).startsWith('Month '));
  check('the title emits the month', true);
}

async function tags(page) {
  const tagsSection = section(page, 'tags');
  const input = tagsSection.locator('mat-chip-grid input');
  await input.focus();
  await page.keyboard.type('Family');
  await page.locator('mat-option', { hasText: 'Create tag “Family”' }).waitFor();
  await page.keyboard.press('Enter');
  // Its Name: the hex field beside the presets is a text box too (M6.15).
  const name = tagsSection.locator('.create').getByRole('textbox', { name: 'Name', exact: true });
  await name.waitFor();
  check(
    'creating opens the name and colour, focused on the name',
    (await focused(page)).tag === 'input' && (await name.inputValue()) === 'Family',
  );
  await page.screenshot({ path: path.join(outDir, 'tag-create.png') });
  await page.keyboard.press('Tab');
  const firstColour = await page.evaluate(() => document.activeElement?.value);
  await page.keyboard.press('ArrowRight');
  const colour = await page.evaluate(() => ({
    value: document.activeElement?.value,
    name: document.activeElement?.closest('label')?.textContent.trim(),
  }));
  check(
    'arrow keys pick a colour, each named',
    colour.value !== firstColour && !!colour.name,
    JSON.stringify(colour),
  );
  await tabTo(page, 'Create tag', (element) => element.text === 'Create tag');
  await page.keyboard.press('Enter');
  await tagsSection.locator('mat-chip-row', { hasText: 'Family' }).waitFor();
  check(
    'the new tag is saved, chosen and shown',
    (await tagsSection.locator('.value').textContent()).trim() === 'Chosen: Family' &&
      (await tagsSection.locator('ss-tag-chip', { hasText: 'Family' }).count()) === 1 &&
      (await focused(page)).tag === 'input',
  );
  const stored = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('simply-sub');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const all = request.result.transaction('tags').objectStore('tags').getAll();
          all.onsuccess = () => resolve(all.result.map((tag) => `${tag.name} ${tag.color}`));
        };
      }),
  );
  check(
    'the tag is in IndexedDB with the colour picked',
    stored.length === 1 && stored[0] === `Family ${colour.value}`,
    stored.join(),
  );

  // Escape closes the create row and saves nothing.
  await input.focus();
  await page.keyboard.type('Gym');
  await page.locator('mat-option', { hasText: 'Create tag “Gym”' }).waitFor();
  await page.keyboard.press('Enter');
  await name.waitFor();
  await until(
    'focus on the name',
    async () => await name.evaluate((input) => input === document.activeElement),
  );
  await page.keyboard.press('Escape');
  await name.waitFor({ state: 'detached' });
  check('Escape cancels a new tag', (await tagsSection.locator('ss-tag-chip').count()) === 13);

  // Backspace in the empty input moves to the last chip, and Delete removes it.
  await input.focus();
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  await until(
    'chip removed',
    async () => (await tagsSection.locator('mat-chip-row').count()) === 0,
  );
  check(
    'keyboard: a chip is removed',
    (await tagsSection.locator('.value').textContent()).trim() === 'Chosen: none',
  );
}

async function splitButtons(page) {
  const split = section(page, 'split');
  const status = split.locator('.picked');
  const main = split.getByRole('button', { name: 'Export to file: Calendar (.ics)' });
  check('the main button says what it does', (await main.count()) === 1);
  await main.focus();
  await page.keyboard.press('Enter');
  await until('main action', async () => (await status.textContent()).trim() === 'Export: ics');
  check('Enter on the main button does the first item', true);
  await page.keyboard.press('Tab');
  check(
    'Tab reaches the menu button',
    (await focused(page)).label === 'Export to file, more options',
  );
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem').first().waitFor();
  await page.screenshot({ path: path.join(outDir, 'split-menu.png') });
  await axe(page, 'split button menu open');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await until('menu action', async () => (await status.textContent()).trim() === 'Export: csv');
  check(
    'a menu item by keyboard, focus back on the menu button',
    (await focused(page)).label === 'Export to file, more options',
  );
}

async function confirms(page) {
  const confirmSection = section(page, 'confirm');
  const status = confirmSection.locator('.picked');
  const danger = confirmSection.getByRole('button', { name: 'Ask before deleting' });
  await danger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog', { name: 'Delete “Work Related”?' });
  await dialog.waitFor();
  await until('focus in the dialog', async () => (await focused(page)).text === 'Cancel');
  check('a destructive question starts on Cancel', true);
  check(
    'the dialog is described by its message',
    (await dialog.getAttribute('aria-describedby')) !== null &&
      (await page.evaluate(
        (id) => document.getElementById(id)?.textContent,
        await dialog.getAttribute('aria-describedby'),
      )) === 'Its 12 subscriptions will be removed.',
  );
  await page.screenshot({ path: path.join(outDir, 'confirm-danger.png') });
  await axe(page, 'confirm dialog');
  await page.keyboard.press('Escape');
  await until('cancelled', async () => (await status.textContent()).trim() === 'Cancelled');
  check(
    'Escape cancels, and focus returns to the button',
    (await focused(page)).text === 'Ask before deleting',
  );

  await confirmSection.getByRole('button', { name: 'Ask', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('alertdialog', { name: 'Apply this suggestion?' }).waitFor();
  await until('focus on Apply', async () => (await focused(page)).text === 'Apply');
  await page.keyboard.press('Enter');
  await until('confirmed', async () => (await status.textContent()).trim() === 'Confirmed');
  check('Enter on the action confirms', true);
}

async function behaviour(browser) {
  const { context, page } = await newPage(browser);
  check(
    'the gallery has a heading per component',
    // ss-price's (check-prices.cjs) and ss-sub-card's (M5.2, check-search.cjs) included.
    (await page.locator('section > h2').count()) === 15,
  );
  await budgetBars(page);
  await icons(page);
  await statuses(page);
  await ranks(page);
  await featureList(page);
  await miniCalendar(page);
  await tags(page);
  await splitButtons(page);
  await confirms(page);
  await context.close();
}

async function looks(browser) {
  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [WIDE, NARROW]) {
      const { context, page, label } = await newPage(browser, { colorScheme, viewport });
      await sleep(500);
      await page.screenshot({
        path: path.join(outDir, `components-${colorScheme}-${viewport.width}.png`),
        fullPage: true,
      });
      await axe(page, `gallery, ${label}`);
      await noHorizontalScroll(page, `gallery, ${label}`);
      // The dialog and the create row, for their look and contrast in this theme.
      await section(page, 'confirm').getByRole('button', { name: 'Ask before deleting' }).click();
      await page.getByRole('alertdialog').waitFor();
      await sleep(300);
      await page.screenshot({
        path: path.join(outDir, `confirm-${colorScheme}-${viewport.width}.png`),
      });
      await axe(page, `confirm dialog, ${label}`);
      await page.keyboard.press('Escape');
      await page.getByRole('alertdialog').waitFor({ state: 'detached' });
      const input = section(page, 'tags').locator('mat-chip-grid input');
      await input.fill('Work');
      await page.locator('mat-option', { hasText: 'Create tag “Work”' }).click();
      await section(page, 'tags').locator('.create').waitFor();
      await section(page, 'tags').locator('.create').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(outDir, `tag-create-${colorScheme}-${viewport.width}.png`),
      });
      await axe(page, `tag create row, ${label}`);
      await noHorizontalScroll(page, `tag create row, ${label}`);
      await context.close();
    }
  }
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    await behaviour(browser);
    await looks(browser);
  } catch (error) {
    check('script ran to the end', false, error.stack);
  } finally {
    await browser.close();
  }
  check('no console errors or warnings', consoleProblems.length === 0, consoleProblems.join('\n'));
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();

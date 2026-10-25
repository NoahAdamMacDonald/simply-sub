// Checks the progress preview on Home in the system Edge: full-page screenshots in light and dark at 1280 px and at
// 360 px, axe, no horizontal scroll, no console errors, and the icon lookup (a real site's icon, a typo's letter).
// See SKILL.md. Usage: node check-preview.cjs <deps dir with playwright-core + axe-core> <output dir> <base url>
const path = require('path');

const [depsDir, outDir, baseUrl] = process.argv.slice(2);
const { chromium } = require(path.join(depsDir, 'node_modules', 'playwright-core'));
const axePath = path.join(depsDir, 'node_modules', 'axe-core', 'axe.min.js');

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  for (const [colorScheme, width] of [
    ['light', 1280],
    ['dark', 1280],
    ['light', 360],
  ]) {
    const label = `${colorScheme} ${width}px`;
    // bypassCSP only so axe can be injected: csp-check.cjs checks the CSP itself.
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      colorScheme,
      bypassCSP: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${baseUrl}/`);
    await page.getByRole('heading', { name: /Progress preview/ }).waitFor({ timeout: 15000 });
    // The catalog cards and the API answers load after the page: wait for the first card.
    await page.locator('.cards .card').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: path.join(outDir, `preview-${colorScheme}-${width}.png`),
      fullPage: true,
    });
    const scrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    await page.addScriptTag({ path: axePath });
    const violations = await page.evaluate(async () =>
      (await axe.run(document)).violations.map(
        (violation) =>
          `${violation.id}: ${violation.nodes.map((node) => node.html.slice(0, 80)).join(' / ')}`,
      ),
    );
    check(`${label}: axe`, violations.length === 0, violations.join(' | '));
    check(`${label}: no horizontal scroll`, !scrolls);
    check(`${label}: no console errors`, errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // The icon lookup: a real site's icon, and the letter for a site without one.
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${baseUrl}/`);
  const domain = page.getByRole('textbox', { name: 'Website domain' });
  await domain.fill('gooooogle.com');
  await page.getByRole('button', { name: 'Get icon' }).click();
  const letter = await page
    .getByText('No usable icon for gooooogle.com')
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check('a site without an icon shows its letter', letter);
  await domain.fill('proton.me');
  await page.getByRole('button', { name: 'Get icon' }).click();
  const icon = page.locator('img[alt="Icon for proton.me"]');
  await icon.waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  check('a real site shows its icon', await icon.evaluate((image) => image.naturalWidth > 0));

  await browser.close();
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

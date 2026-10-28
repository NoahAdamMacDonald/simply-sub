// Reads a provider's pricing page in the system Edge, running steps in order on one tab, and saves what it sees.
// See SKILL.md. Usage: node read-page.cjs <deps dir with playwright-core> <output dir> <url> [step ...]
//
// Steps:
//   wait:<ms>                     pause (every page load already waits LOAD_WAIT ms for scripts to render)
//   click:<text>                  click the first element whose whole visible text is <text> (buttons, links, FAQ
//                                 questions)
//   click?:<text>                 the same, but carry on if it isn't there (cookie banners: "click?:Reject All")
//   tab:<text>                    click the first role="tab" button whose visible text is <text> (Proton's
//                                 Mail/VPN/… and Monthly/Yearly; their accessible names don't match the text)
//   select:<aria-label>=<value>   pick an option in a <select> (Proton: "select:Change currency=CAD")
//   country:<option>              Disney+ help centre: open the country picker, pick "United States (English)"
//   goto:<url>                    load another page in the same tab (keeps cookies and choices)
//   snap:<name>                   save <name>.txt (visible text, URL first) and <name>.png (full-page screenshot)
// With no snap step, the page is saved as page.txt / page.png at the end.
//
// Environment: LOCALE (browser locale, default en-CA), LOAD_WAIT (ms after each load, default 6000).
const fs = require('fs');
const path = require('path');

const [depsDir, outDir, url, ...steps] = process.argv.slice(2);
if (!depsDir || !outDir || !url) {
  console.error('Usage: node read-page.cjs <deps dir> <output dir> <url> [step ...]');
  process.exit(2);
}
const { chromium } = require(path.join(depsDir, 'node_modules', 'playwright-core'));
const loadWait = Number(process.env.LOAD_WAIT ?? 6000);
const exactly = (text) => new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);

async function snap(page, name) {
  const text = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(path.join(outDir, `${name}.txt`), `${page.url()}\n\n${text}`);
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
  console.log(`snap ${name}: ${text.length} chars, ${page.url()}`);
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({
    locale: process.env.LOCALE ?? 'en-CA',
    viewport: { width: 1400, height: 1000 },
  });
  let snapped = false;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(loadWait);
    for (const step of steps) {
      const [kind, ...rest] = step.split(':');
      const arg = rest.join(':');
      switch (kind) {
        case 'wait':
          await page.waitForTimeout(Number(arg));
          break;
        case 'click':
          await page.getByText(arg, { exact: true }).first().click({ timeout: 10000 });
          await page.waitForTimeout(1500);
          break;
        case 'click?':
          await page
            .getByText(arg, { exact: true })
            .first()
            .click({ timeout: 3000 })
            .then(() => page.waitForTimeout(1500))
            .catch(() => console.log(`skip ${step}: not found`));
          break;
        case 'tab':
          await page
            .locator('[role="tab"]')
            .filter({ hasText: exactly(arg) })
            .first()
            .click({ timeout: 10000 });
          await page.waitForTimeout(2000);
          break;
        case 'select': {
          const [label, value] = arg.split('=');
          await page.selectOption(`select[aria-label="${label}"]`, value);
          await page.waitForTimeout(2500);
          break;
        }
        case 'country':
          // The picker's button showed the country's code (2026-10-26); since, its flag and the language, and it's
          // named "Change country or language. Current country Canada, language EN" (2026-10-28).
          await page
            .getByRole('button', { name: /^Change country or language/ })
            .or(page.locator('header button').filter({ hasText: /^\s*[A-Z]{2}\s*$/ }))
            .first()
            .click();
          await page.waitForTimeout(1000);
          await page.getByPlaceholder('Search by country').fill(arg.split(' (')[0]);
          await page.waitForTimeout(1000);
          await page.getByText(arg, { exact: true }).first().click();
          await page.waitForTimeout(loadWait);
          break;
        case 'goto':
          await page.goto(arg, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForTimeout(loadWait);
          break;
        case 'snap':
          await snap(page, arg);
          snapped = true;
          break;
        default:
          throw new Error(`Unknown step "${step}"`);
      }
    }
    if (!snapped) await snap(page, 'page');
  } catch (error) {
    console.error(`FAILED: ${error.message.split('\n')[0]}`);
    await snap(page, 'failure').catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();

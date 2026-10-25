// CSP and Trusted Types check of the production build (wrangler dev serves it with public/_headers).
// Usage: node csp-check.cjs <deps dir> <output dir> <base url>
// Records every securitypolicyviolation event and console error while visiting every page, navigating in the app,
// toggling the theme, opening the drawer and the error snackbar. Cloudflare Web Analytics' beacon tag, as the live site
// gets it, is added to each HTML page the way Cloudflare's edge does, and its reports are aborted (never sent).
const path = require('path');

const [depsDir, outDir, baseUrl] = process.argv.slice(2);
const { chromium } = require(path.join(depsDir, 'node_modules', 'playwright-core'));

const PAGES = [
  '/',
  '/lists',
  '/payment',
  '/features',
  '/calendar',
  '/search',
  '/settings',
  '/no-such-page',
];
const SIDEBAR = ['Lists', 'Payment', 'Features', 'Calendar', 'Search', 'Settings', 'Home'];
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0';

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

(async () => {
  const live = await (
    await fetch('https://sub.simplely.ca/', { headers: { 'User-Agent': UA, Accept: 'text/html' } })
  ).text();
  const beacon = /<script[^>]*static\.cloudflareinsights\.com[^>]*><\/script>/.exec(live)?.[0];
  check('found the live beacon tag to inject', Boolean(beacon), beacon?.slice(0, 90));

  const browser = await chromium.launch({ channel: 'msedge' });
  const violations = [];
  const problems = [];
  const rumReports = [];
  const beaconLoads = [];

  async function newPage(viewport, colorScheme) {
    const context = await browser.newContext({ viewport, colorScheme, userAgent: UA });
    await context.exposeBinding('__reportViolation', (_source, text) => violations.push(text));
    await context.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        window.__reportViolation(
          `${event.effectiveDirective}: ${event.blockedURI || 'inline'} at ${event.sourceFile || '?'}:${event.lineNumber} (${event.sample || ''})`,
        );
      });
    });
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = request.url();
      // The beacon reports to /cdn-cgi/rum on the site itself (Cloudflare's edge answers it) or to cloudflareinsights.com.
      if (
        url.startsWith('https://cloudflareinsights.com/') ||
        new URL(url).pathname.startsWith('/cdn-cgi/rum')
      ) {
        rumReports.push(url);
        return route.abort();
      }
      if (request.resourceType() === 'document' && url.startsWith(baseUrl) && beacon) {
        const response = await route.fetch();
        const headers = response.headers();
        delete headers['content-length'];
        const html = await response.text();
        // Production's HTML already has the beacon Cloudflare's edge inserts.
        const body = html.includes('static.cloudflareinsights.com')
          ? html
          : html.replace('</body>', `${beacon}</body>`);
        return route.fulfill({ status: response.status(), headers, body });
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('console', (message) => {
      const aborted = message.location().url.includes('/cdn-cgi/rum');
      if ((message.type() === 'error' || message.type() === 'warning') && !aborted) {
        problems.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('response', (response) => {
      if (response.url().startsWith('https://static.cloudflareinsights.com/')) {
        beaconLoads.push(`${response.status()} ${response.url().slice(0, 70)}`);
      }
    });
    return { context, page };
  }

  // Every page as a deep link, in both themes.
  for (const colorScheme of ['light', 'dark']) {
    const { context, page } = await newPage({ width: 1280, height: 800 }, colorScheme);
    for (const url of PAGES) {
      await page.goto(baseUrl + url);
      await page.locator('main h1').waitFor();
    }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outDir, `csp-${colorScheme}.png`) });
    await context.close();
  }

  // Navigating in the app (lazy chunks), the theme toggle and the error snackbar.
  {
    const { context, page } = await newPage({ width: 1280, height: 800 }, 'light');
    await page.goto(baseUrl + '/');
    await page.locator('main h1').waitFor();
    for (const name of SIDEBAR) {
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();
      await page.waitForFunction(
        (label) => document.title.includes(label) || label === 'Home',
        name,
      );
    }
    await page.getByRole('button', { name: 'Dark theme' }).click();
    await page.waitForFunction(() => document.documentElement.dataset['theme'] === 'dark');
    await page.evaluate(() =>
      setTimeout(() => {
        throw new Error('csp check');
      }),
    );
    await page
      .getByText('Dismiss')
      .waitFor({ timeout: 5000 })
      .catch(() => problems.push('no error snackbar'));
    await page.screenshot({ path: path.join(outDir, 'csp-snackbar.png') });
    await context.close();
  }

  // The drawer on a phone.
  {
    const { context, page } = await newPage({ width: 360, height: 740 }, 'light');
    await page.goto(baseUrl + '/settings');
    await page.locator('main h1').waitFor();
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(outDir, 'csp-drawer.png') });
    await context.close();
  }

  await browser.close();

  // The deliberate snackbar error is the only console error expected.
  const unexpected = problems.filter((line) => !line.includes('csp check'));
  check('no CSP or Trusted Types violations', violations.length === 0, violations.join(' | '));
  check(
    'no unexpected console errors or warnings',
    unexpected.length === 0,
    unexpected.join(' | '),
  );
  check(
    'the beacon loaded from static.cloudflareinsights.com',
    beaconLoads.length > 0,
    beaconLoads[0],
  );
  check('the beacon could send its report (aborted here)', rumReports.length > 0, rumReports[0]);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

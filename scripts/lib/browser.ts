// The discovery pipeline's browser (BLUEPRINT §6.5 ③, M3.3): the system Edge (or Chrome) through playwright-core, run
// on this machine so sites that price by location show Canada's prices. Each page is opened once, in Canadian English
// with the browser's User-Agent and the bot's token after it (so robots.txt's SimplySubBot rules and a site's owner
// can tell it's us), after robots.txt allows it. It declines cookie banners, clicks the Monthly and Yearly toggles of
// a pricing page, and keeps the page's text (as shown, and as served before its scripts), each toggle's text and a
// screenshot as evidence. A bot check is never got past: the page is reported unread.
import { pageText, userAgent } from '@simply-sub/core';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { RegionBrowser } from '@simply-sub/core';
import { pipelineHeaders, type PoliteWeb } from './web';

/** A page as the browser showed it. */
export interface RenderedPage {
  url: string;
  /** Where it ended up, after redirects. */
  finalUrl: string;
  title: string;
  status: number;
  /** The visible text, as shown (innerText). */
  renderedText: string;
  /** The text of the HTML as served, before any script ran: what a plain fetch reads (the nightly bot's view). */
  servedText: string;
  /** The visible text after each toggle clicked (Yearly, Monthly …). */
  views: { label: string; text: string }[];
  /** The screenshot's absolute path, when one was taken. */
  screenshot?: string;
}

/** Words of a page that checks for bots instead of showing itself. */
const botCheck =
  /\b(?:just a moment|verify you are (?:a )?human|checking your browser|are you a robot|captcha|attention required|unusual traffic|access denied|request blocked|pardon our interruption)\b/i;

/** Words of an app's error page, in place of what was asked for. */
const errorPage =
  /\b(?:something went wrong|an error (?:has )?occurred|page not found|we couldn.t find)\b/i;

/** Cookie banners' buttons that decline: never accept on the user's behalf. */
const decline =
  /^(?:reject all|reject|decline all|decline|refuse all|only (?:necessary|essential|required)(?: cookies)?|necessary only|use necessary cookies only|continue without accepting|tout refuser|refuser)$/i;

/** A pricing page's period toggles. */
const toggle =
  /^(?:monthly|annual|annually|yearly|1 month|12 months|month|year|billed (?:monthly|annually|yearly)|pay (?:monthly|annually|yearly)|mensuel|annuel)$/i;

const navigationMs = 45_000;
/** The tallest screenshot taken: a page's top is where its plans are. */
const maxScreenshotHeight = 12_000;

export class Renderer {
  private browser?: Browser;
  private context?: BrowserContext;
  private readonly opened = new Set<string>();

  constructor(
    private readonly web: PoliteWeb,
    /** How pages are read: in Canada's English and time zone, unless a region's are read (M10.12). */
    private readonly settings: RegionBrowser = {
      locale: 'en-CA',
      acceptLanguage: pipelineHeaders['Accept-Language'],
      timeZone: 'America/Toronto',
    },
  ) {}

  /**
   * Opens `url` once and reads it, or says why it couldn't be: robots.txt, a bot check, an error status, a timeout.
   * `screenshot` is the absolute path the screenshot is saved to, its folder made already; none without it.
   */
  async render(
    url: string,
    options: { screenshot?: string; toggles?: boolean } = {},
  ): Promise<RenderedPage | { error: string }> {
    const address = URL.parse(url);
    if (!address) return { error: 'Not a web address' };
    if (this.opened.has(address.href)) return { error: 'Already opened this run' };
    if (!(await this.web.allowed(address)))
      return { error: 'robots.txt doesn’t allow the bot to read it' };
    this.opened.add(address.href);
    const page = await (await this.contextOf()).newPage();
    try {
      const response = await open(page, address.href);
      if (!response) return { error: 'The page didn’t load' };
      const status = response.status();
      const served = await response.text().catch(() => '');
      await declineCookies(page);
      await expandSections(page);
      await page.waitForTimeout(1_500);
      const title = await page.title();
      const renderedText = await page.innerText('body').catch(() => '');
      if (botCheck.test(title) || (renderedText.length < 2_000 && botCheck.test(renderedText))) {
        return { error: 'A bot check: not read (never got past)' };
      }
      if (status >= 400) return { error: `The page answered ${status}` };
      // An app that shows its own error page to the bot (Crunchyroll's /premium/error): unreadable, like a bot check.
      if (
        /\/error\b/.test(new URL(page.url()).pathname) ||
        (renderedText.length < 2_000 && errorPage.test(renderedText))
      ) {
        return { error: 'The site showed the bot an error page: not read' };
      }
      const views = options.toggles ? await toggleViews(page) : [];
      if (options.screenshot)
        await page.screenshot({
          path: options.screenshot,
          type: 'jpeg',
          quality: 70,
          clip: {
            x: 0,
            y: 0,
            width: 1280,
            height: Math.min(
              maxScreenshotHeight,
              Number(await page.evaluate('document.documentElement.scrollHeight')),
            ),
          },
        });
      return {
        url: address.href,
        finalUrl: page.url(),
        title,
        status,
        renderedText,
        servedText: pageText(served),
        views,
        ...(options.screenshot && { screenshot: options.screenshot }),
      };
    } catch (error) {
      return {
        error: `The browser couldn’t read it: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
      };
    } finally {
      await page.close();
    }
  }

  /** The page's HTML and text as the browser shows them, for find-urls on a page that a plain fetch can't read. */
  async renderForLinks(
    url: string,
  ): Promise<{ url: string; html: string; text: string } | { error: string }> {
    const address = URL.parse(url);
    if (!address) return { error: 'Not a web address' };
    if (this.opened.has(address.href)) return { error: 'Already opened this run' };
    if (!(await this.web.allowed(address)))
      return { error: 'robots.txt doesn’t allow the bot to read it' };
    this.opened.add(address.href);
    const page = await (await this.contextOf()).newPage();
    try {
      const response = await open(page, address.href);
      if (!response) return { error: 'The page didn’t load' };
      if (response.status() >= 400) return { error: `The page answered ${response.status()}` };
      await declineCookies(page);
      await page.waitForTimeout(1_000);
      const text = await page.innerText('body').catch(() => '');
      if (botCheck.test(await page.title()) || (text.length < 2_000 && botCheck.test(text))) {
        return { error: 'A bot check: not read (never got past)' };
      }
      if (
        /\/error\b/.test(new URL(page.url()).pathname) ||
        (text.length < 2_000 && errorPage.test(text))
      ) {
        return { error: 'The site showed the bot an error page: not read' };
      }
      return { url: page.url(), html: await page.content(), text };
    } catch {
      return { error: 'The browser couldn’t read it' };
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
    this.context = undefined;
  }

  private async contextOf(): Promise<BrowserContext> {
    if (this.context) return this.context;
    // PIPELINE_BROWSER picks another installed browser: chrome, msedge (the default), chromium.
    const channel = process.env['PIPELINE_BROWSER'] ?? 'msedge';
    this.browser = await chromium.launch({ channel, headless: true });
    const probe = await this.browser.newPage();
    const browserAgent = String(await probe.evaluate('navigator.userAgent'));
    await probe.close();
    this.context = await this.browser.newContext({
      // The browser's own, so sites show their normal page, with the bot's token after it to say who's asking.
      userAgent: `${browserAgent.replace('HeadlessChrome', 'Chrome')} ${userAgent}`,
      locale: this.settings.locale,
      timezoneId: this.settings.timeZone,
      viewport: { width: 1280, height: 900 },
      extraHTTPHeaders: { 'Accept-Language': this.settings.acceptLanguage },
    });
    return this.context;
  }
}

/**
 * Opens a page with one navigation, then waits for its requests to quiet down: some pages never do (chat widgets,
 * analytics), and what has loaded by then is read. Null when it didn't load.
 */
async function open(page: Page, url: string) {
  const response = await page
    .goto(url, { waitUntil: 'load', timeout: navigationMs })
    .catch(() => null);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  return response;
}

/**
 * Opens a page's folded sections, so their words are read: up to 25 closed <details> and collapsed buttons named like a
 * question (a help article's "What are the prices for each plan?"), which role locators find inside components too.
 * Menus and other collapsed buttons stay shut.
 */
async function expandSections(page: Page): Promise<void> {
  let opened = 0;
  // Playwright's locators see inside components' shadow DOM, where Crunchyroll's help articles keep theirs.
  for (const summary of await page.locator('details:not([open]) > summary').all()) {
    if (opened >= 25) break;
    if (!(await summary.isVisible().catch(() => false))) continue;
    await summary.click({ timeout: 2_000 }).catch(() => undefined);
    opened++;
  }
  for (const button of await page.getByRole('button', { expanded: false }).all()) {
    if (opened >= 25) break;
    const name = (await button.innerText().catch(() => '')).trim();
    if (!/\?\s*$/.test(name) || !(await button.isVisible().catch(() => false))) continue;
    await button.click({ timeout: 2_000 }).catch(() => undefined);
    opened++;
  }
  if (opened > 0) await page.waitForTimeout(800);
}

async function declineCookies(page: Page): Promise<void> {
  for (const button of await page.getByRole('button').all()) {
    const text = (await button.innerText().catch(() => '')).trim();
    if (decline.test(text) && (await button.isVisible().catch(() => false))) {
      await button.click({ timeout: 2_000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      return;
    }
  }
}

/** Each period toggle's view: the page's text after clicking it, a toggle at a time (at most four). */
async function toggleViews(page: Page): Promise<{ label: string; text: string }[]> {
  const views: { label: string; text: string }[] = [];
  const seen = new Set<string>();
  const candidates = await page
    .locator('button, [role="tab"], [role="radio"], [role="switch"], label')
    .all();
  for (const candidate of candidates) {
    if (views.length >= 4) break;
    const label = (await candidate.innerText().catch(() => '')).trim().replace(/\s+/g, ' ');
    if (!toggle.test(label) || seen.has(label.toLowerCase())) continue;
    if (!(await candidate.isVisible().catch(() => false))) continue;
    seen.add(label.toLowerCase());
    await candidate.click({ timeout: 2_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);
    views.push({ label, text: await page.innerText('body').catch(() => '') });
  }
  return views;
}

// The discovery pipeline's way to the web from this machine (BLUEPRINT §6.5): polite, as the nightly bot is. Every
// request has the bot's User-Agent and Canadian English, follows each host's robots.txt (read once a run), waits a
// moment between requests to the same host, and reads each URL at most once a run.
import {
  pageText,
  parseRobots,
  robotsAllow,
  userAgent,
  type FetchedPage,
  type Robots,
} from '@simply-sub/core';
import { gunzipSync } from 'node:zlib';

const timeoutMs = 20_000;
const maxBytes = 5_000_000;
/** The pause between two requests to the same host. */
const spacingMs = 750;

export const pipelineHeaders = { 'User-Agent': userAgent, 'Accept-Language': 'en-CA,en;q=0.9' };

export class PoliteWeb {
  /** What every request sends: Canada's English unless a region's pages are read (M10.12). */
  private readonly headers: Record<string, string>;
  /** Each host's robots.txt: its rules, and its text for the sitemaps it names. */
  private readonly robots = new Map<string, Promise<{ rules: Robots; text?: string }>>();
  private readonly pages = new Map<string, Promise<FetchedPage | { error: string }>>();
  private readonly files = new Map<string, Promise<string | undefined>>();
  private readonly lastRequest = new Map<string, number>();
  /** Every URL requested this run, in order, for the run's report. */
  readonly requested: string[] = [];

  constructor(acceptLanguage = pipelineHeaders['Accept-Language']) {
    this.headers = { ...pipelineHeaders, 'Accept-Language': acceptLanguage };
  }

  /** A page's HTML and words, as robots.txt allows; or why it couldn't be read. */
  page(url: string): Promise<FetchedPage | { error: string }> {
    let page = this.pages.get(url);
    if (!page) {
      page = this.fetchPage(url);
      this.pages.set(url, page);
    }
    return page;
  }

  /** A file's text (robots.txt, a sitemap, gzipped or not), or undefined. */
  file(url: string): Promise<string | undefined> {
    const address = URL.parse(url);
    // robots.txt was read for its rules already: one request per URL.
    if (address?.pathname === '/robots.txt' && !address.search) {
      return this.robotsOf(address).then((robots) => robots.text);
    }
    let file = this.files.get(url);
    if (!file) {
      file = this.fetchFile(url);
      this.files.set(url, file);
    }
    return file;
  }

  /** A link resolved against its page: an absolute http(s) URL without its fragment, or undefined. */
  resolve(href: string, base: string): string | undefined {
    const url = URL.parse(href, base);
    if (!url || !/^https?:$/.test(url.protocol)) return undefined;
    url.hash = '';
    return url.href;
  }

  /** Whether robots.txt lets the bot read `url`. */
  async allowed(url: URL): Promise<boolean> {
    return robotsAllow((await this.robotsOf(url)).rules, `${url.pathname}${url.search}`);
  }

  private robotsOf(url: URL): Promise<{ rules: Robots; text?: string }> {
    let robots = this.robots.get(url.host);
    if (!robots) {
      robots = this.readRobots(url);
      this.robots.set(url.host, robots);
    }
    return robots;
  }

  private async fetchPage(address: string): Promise<FetchedPage | { error: string }> {
    const got = await this.get(address, 'text/html,application/xhtml+xml');
    if ('error' in got) return got;
    const html = new TextDecoder().decode(got.bytes);
    return { url: got.url, html, text: pageText(html) };
  }

  private async fetchFile(address: string): Promise<string | undefined> {
    const got = await this.get(address, 'application/xml,text/xml,text/plain,*/*');
    if ('error' in got) return undefined;
    // A sitemap.xml.gz, or a server that sends it gzipped without saying so.
    const gzipped = got.bytes[0] === 0x1f && got.bytes[1] === 0x8b;
    try {
      return new TextDecoder().decode(gzipped ? gunzipSync(got.bytes) : got.bytes);
    } catch {
      return undefined;
    }
  }

  private async readRobots(url: URL): Promise<{ rules: Robots; text?: string }> {
    try {
      await this.wait(url.host);
      this.requested.push(`${url.origin}/robots.txt`);
      const response = await fetch(`${url.origin}/robots.txt`, {
        headers: this.headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      // RFC 9309: a 4xx allows everything; a 5xx or no answer allows nothing.
      if (response.status >= 400 && response.status < 500) return { rules: 'allow-all' };
      if (!response.ok) return { rules: 'disallow-all' };
      const text = (await response.text()).slice(0, 500_000);
      return { rules: parseRobots(text), text };
    } catch {
      return { rules: 'disallow-all' };
    }
  }

  private async get(
    address: string,
    accept: string,
  ): Promise<{ url: string; bytes: Uint8Array } | { error: string }> {
    const url = URL.parse(address);
    if (!url || !/^https?:$/.test(url.protocol)) return { error: 'Not a web address' };
    if (!(await this.allowed(url))) return { error: 'robots.txt doesn’t allow the bot to read it' };
    try {
      await this.wait(url.host);
      this.requested.push(url.href);
      const response = await fetch(url, {
        headers: { ...this.headers, Accept: accept },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return { error: `The page answered ${response.status}` };
      if (Number(response.headers.get('content-length')) > maxBytes)
        return { error: 'The page is too big' };
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.length > maxBytes
        ? { error: 'The page is too big' }
        : { url: response.url, bytes };
    } catch (error) {
      return {
        error:
          error instanceof Error && error.name === 'TimeoutError'
            ? 'The page timed out'
            : 'The page couldn’t be reached',
      };
    }
  }

  /** Waits until `spacingMs` after the last request to `host`. */
  private async wait(host: string): Promise<void> {
    const last = this.lastRequest.get(host) ?? 0;
    const wait = last + spacingMs - Date.now();
    this.lastRequest.set(host, Math.max(Date.now(), last + spacingMs));
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

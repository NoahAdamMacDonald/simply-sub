import { pageText } from './page-text';
import { hostOnDomain, parseWebAddress } from './web-address';

// Sites that turn bots away (OpenAI's, M11.15): the nightly bot never reads their pages itself. It reads the Internet
// Archive's newest copy of each instead, and compares that copy's text with the page's baseline, so a changed page
// still reaches the weekly review, which reads the live page with the standard reader (the owner's choice of
// 2026-11-04). The copy is for telling that a page changed, never a source of the catalog's facts.

/** The Internet Archive's Wayback Machine, where the copies are. */
const wayback = 'https://web.archive.org';

/** Whether `url` is on one of the archived hosts (data/automation.yaml's `archived`), or a subdomain of one. */
export function onArchivedHost(url: string, hosts: readonly string[]): boolean {
  const address = parseWebAddress(url);
  return address !== undefined && hosts.some((domain) => hostOnDomain(address.host, domain));
}

/** The Wayback Machine's CDX query for the newest successful capture of `url`. */
export function newestCaptureQuery(url: string): string {
  const fields = {
    url,
    output: 'json',
    fl: 'timestamp,statuscode',
    filter: 'statuscode:200',
    limit: '-1',
  };
  const query = Object.entries(fields)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('&');
  return `${wayback}/cdx/search/cdx?${query}`;
}

/** The newest capture's timestamp (YYYYMMDDhhmmss) in the CDX query's answer, or undefined when there's none. */
export function newestCapture(answer: string): string | undefined {
  let rows: unknown;
  try {
    rows = JSON.parse(answer);
  } catch {
    return undefined;
  }
  if (!Array.isArray(rows)) return undefined;
  // The first row names the fields; the rest are captures, oldest first.
  const timestamps = rows
    .slice(1)
    .map((row: unknown) => (Array.isArray(row) ? row[0] : undefined))
    .filter((value): value is string => typeof value === 'string' && /^\d{14}$/.test(value));
  return timestamps.sort().at(-1);
}

/** A capture as the site served it (`id_`: without the Wayback Machine's own banner and links). */
export function captureUrl(url: string, timestamp: string): string {
  return `${wayback}/web/${timestamp}id_/${url}`;
}

/** A capture's date, from its timestamp: 20261102071630 is 2026-11-02. */
export function captureDate(timestamp: string): string {
  return `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
}

/**
 * The text a captured page shows, as `pageText` reads a page, without lines that change with the day alone: a help
 * article's "Updated: 3 hours ago" or "Updated: yesterday".
 */
export function archivedText(html: string): string {
  return pageText(html)
    .split('\n')
    .filter((line) => !relativeTime.test(line.trim()))
    .join('\n');
}

const relativeTime =
  /^(?:updated|last updated|edited)\b:?\s*(?:(?:about |over |almost )?(?:an?|\d+) \w+ ago|yesterday|today|just now)$/i;

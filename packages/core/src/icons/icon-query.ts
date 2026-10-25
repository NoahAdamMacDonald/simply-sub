import type { QueryProblem } from '../api/error-body';

// GET /icon's query string (docs/api-output-examples.json): the domain of a website a user typed for a custom
// subscription (BLUEPRINT §5.4). The domain only ever goes into the icon services' URLs (iconServices), never into a
// request to the site itself, so it needs to be a well-formed public host name, not a safe one: an IP address, a
// URL, a port or a single label like localhost is a problem, which the API answers with 400 bad_request.

export interface IconQuery {
  /** Lower case, without a trailing dot, an international name in its xn-- (punycode) form. */
  domain: string;
}

export interface IconQueryContext {
  /**
   * An international host name in ASCII (xn--) form, or undefined when it can't be one. Core has no URL parser:
   * the Worker passes `(host) => URL.parse(`https://${host}`)?.hostname`.
   */
  toAscii: (host: string) => string | undefined;
}

const bareHostname = "Expected a bare hostname like 'example.com' (no scheme or path).";
const notADomain =
  'Not a domain name: use letters, digits and hyphens between dots, such as example.com.';
const maxDomainLength = 253;

/** GET /icon's query, or each problem with it, in the order the parameters came. */
export function readIconQuery(
  queries: Readonly<Record<string, readonly string[]>>,
  { toAscii }: IconQueryContext,
): { query: IconQuery } | { problems: QueryProblem[] } {
  const problems: QueryProblem[] = [];
  let domain: string | undefined;
  for (const [param, values] of Object.entries(queries)) {
    if (param !== 'domain') {
      problems.push({ param, issue: 'Unknown parameter. GET /icon takes domain.' });
    } else if (values.length > 1) {
      problems.push({ param, issue: 'Give one value.' });
    } else {
      const read = iconDomain(values[0], toAscii);
      if ('issue' in read) {
        problems.push({ param, issue: read.issue });
      } else {
        domain = read.domain;
      }
    }
  }
  if (!Object.hasOwn(queries, 'domain')) {
    problems.unshift({
      param: 'domain',
      issue: "Needed: the website's domain, such as example.com.",
    });
  }
  return problems.length > 0 || domain === undefined ? { problems } : { query: { domain } };
}

/** `value` as a public domain name, normalized, or why it isn't one. */
function iconDomain(
  value: string,
  toAscii: IconQueryContext['toAscii'],
): { domain: string } | { issue: string } {
  const text = value.trim();
  if (isIpAddress(text)) {
    return { issue: 'Use a domain name, not an IP address.' };
  }
  if (/[/:?#@\\\s[\]%]/.test(text)) {
    return { issue: bareHostname };
  }
  // Anything but printable ASCII goes through the URL parser, which rejects control characters.
  const ascii = /^[!-~]*$/.test(text) ? text : toAscii(text);
  if (ascii === undefined) {
    return { issue: notADomain };
  }
  const host = ascii.toLowerCase().replace(/\.$/, '');
  // Checked again: an international name can map to digits ("１.２.３.４").
  if (isIpAddress(host)) {
    return { issue: 'Use a domain name, not an IP address.' };
  }
  if (host.length > maxDomainLength) {
    return { issue: `Use a domain name of at most ${maxDomainLength} characters.` };
  }
  const labels = host.split('.');
  if (labels.length < 2) {
    return { issue: 'Use a full domain name, such as example.com.' };
  }
  const tld = labels[labels.length - 1];
  const valid =
    labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
    /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld);
  return valid ? { domain: host } : { issue: notADomain };
}

/** An IPv4 address, or what looks like an IPv6 one (hex digits and colons, maybe in brackets). */
function isIpAddress(text: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}\.?$/.test(text) || /^\[?[0-9a-f]*:[0-9a-f:.]*\]?$/i.test(text);
}

// Absolute web addresses for the discovery pipeline (BLUEPRINT §6.5). Core has no URL parser (it type-checks without
// DOM or Node APIs), and the pipeline only ever needs the parts of an absolute http(s) address, so a regular
// expression reads them. Relative links are resolved by the caller, which has the runtime's URL.

export interface WebAddress {
  /** `https` or `http`. */
  protocol: 'http' | 'https';
  /** The host in lower case, without a port: www.netflix.com. */
  host: string;
  /** The path, `/` when there's none: /en/node/24926/ca. */
  path: string;
  /** The query with its `?`, or empty. */
  query: string;
}

/** The parts of an absolute http(s) address, or undefined for anything else (relative, mailto:, a bare host). */
export function parseWebAddress(url: string): WebAddress | undefined {
  const match =
    /^(https?):\/\/(?:[^@/?#\s]*@)?([a-z0-9.-]+)(?::\d{1,5})?(\/[^?#\s]*)?(\?[^#\s]*)?(?:#\S*)?$/i.exec(
      url.trim(),
    );
  if (!match) return undefined;
  const host = match[2].toLowerCase().replace(/\.$/, '');
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$/.test(host))
    return undefined;
  return {
    protocol: match[1].toLowerCase() as 'http' | 'https',
    host,
    path: match[3] ?? '/',
    query: match[4] ?? '',
  };
}

/** The address as https, without its fragment: `http://netflix.com/ca#plans` → `https://netflix.com/ca`. */
export function httpsAddress(address: WebAddress): string {
  return `https://${address.host}${address.path}${address.query}`;
}

/** The host without `www.`: netflix.com. */
export function bareHost(host: string): string {
  return host.replace(/^www\./, '');
}

/** Whether `host` is `domain` or a subdomain of it: help.netflix.com is on netflix.com. */
export function hostOnDomain(host: string, domain: string): boolean {
  const bare = bareHost(host);
  const wanted = bareHost(domain);
  return bare === wanted || bare.endsWith(`.${wanted}`);
}

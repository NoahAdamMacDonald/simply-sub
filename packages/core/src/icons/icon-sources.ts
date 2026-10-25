// Where to look for a website's icon. A site's own icons come first: the links its home page declares, then the
// well-known paths. The icon services come last, and they're all GET /icon may ask (BLUEPRINT §5.4, M2.6).

/** An icon a page declares with `<link rel="icon">`, `apple-touch-icon` and similar, its href as written. */
export interface IconLink {
  href: string;
  rel: string;
  sizes?: string;
}

/** Paths many sites serve their icon at without declaring it, from the site's root. */
export const wellKnownIconPaths = ['/apple-touch-icon.png', '/favicon.ico'];

const iconRels = new Set(['icon', 'apple-touch-icon', 'apple-touch-icon-precomposed']);

/**
 * The icons a page's HTML declares, the largest declared size first (an apple-touch-icon without sizes counts as
 * 180, the size Apple asks for). SVG and Safari's mask icons are left out, since showing them needs a renderer.
 */
export function iconLinksIn(html: string): IconLink[] {
  const links: { link: IconLink; size: number }[] = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = attributesOf(tag);
    const rels = (attributes.get('rel') ?? '').toLowerCase().split(/\s+/);
    const rel = rels.find((name) => iconRels.has(name));
    const href = attributes.get('href');
    const type = attributes.get('type')?.toLowerCase();
    if (!rel || !href || type === 'image/svg+xml' || /\.svg(?:[?#]|$)/i.test(href)) {
      continue;
    }
    const sizes = attributes.get('sizes');
    links.push({
      link: { href, rel, ...(sizes && { sizes }) },
      size: largestSize(sizes) ?? (rel.startsWith('apple-touch-icon') ? 180 : 0),
    });
  }
  // Array.prototype.sort is stable, so links of the same size keep the page's order.
  return links.sort((a, b) => b.size - a.size).map(({ link }) => link);
}

/** An icon service, by the name GET /icon's X-Icon-Source header gives it. */
export type IconServiceName = 'google' | 'duckduckgo';

/**
 * The icon services for a host name, in order: Google's favicon service (a PNG of up to 128 pixels), then
 * DuckDuckGo's (the site's favicon). Both answer 404 with a placeholder image for a site they don't know.
 */
export function iconServices(host: string): { name: IconServiceName; url: string }[] {
  const domain = encodeURIComponent(host.toLowerCase());
  return [
    { name: 'google', url: `https://www.google.com/s2/favicons?domain=${domain}&sz=128` },
    { name: 'duckduckgo', url: `https://icons.duckduckgo.com/ip3/${domain}.ico` },
  ];
}

/** The icon services' URLs for a host name, in iconServices' order. */
export function iconServiceUrls(host: string): string[] {
  return iconServices(host).map((service) => service.url);
}

/**
 * Whether `url` is on an icon service's own hosts, the only ones GET /icon may fetch. Google's favicon service
 * redirects to its gstatic.com servers (t0 to t3).
 */
export function isIconServiceUrl(url: string): boolean {
  return /^https:\/\/(?:www\.google\.com|t\d\.gstatic\.com|icons\.duckduckgo\.com)\//.test(url);
}

/** A tag's attributes, names in lower case and values with their HTML entities decoded. */
function attributesOf(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const body = tag.replace(/^<link\b/i, '').replace(/\/?>$/, '');
  for (const match of body.matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g)) {
    const [, name, double, single, bare] = match;
    attributes.set(name.toLowerCase(), decodeEntities(double ?? single ?? bare ?? ''));
  }
  return attributes;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/** The largest side in a sizes attribute ("16x16 32x32" → 32). Undefined for "any" or no sizes. */
function largestSize(sizes: string | undefined): number | undefined {
  const sides = [...(sizes ?? '').matchAll(/(\d+)x(\d+)/gi)].map(([, width]) => Number(width));
  return sides.length > 0 ? Math.max(...sides) : undefined;
}

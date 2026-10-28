import {
  iconLinksIn,
  iconServiceUrls,
  pickIcon,
  readIconImage,
  wellKnownIconPaths,
  type IconImage,
} from '@simply-sub/core';

// Logos (BLUEPRINT §6.4): a provider's or reseller's best icon, found the way `npm run data:icons` finds it
// (scripts/fetch-icons.ts): the icons its home page declares, the well-known paths, then the icon services, and the
// largest square PNG of at least 32 pixels among them. It's compared with the committed data/logos/<id>.png by its Git
// blob hash, which GitHub lists, so the committed file isn't downloaded.

/** A downloaded file, with the URL it came from after redirects. */
export interface Downloaded {
  url: string;
  bytes: Uint8Array;
}

export type Download = (
  url: string,
  maxBytes: number,
  accept: string,
) => Promise<Downloaded | undefined>;

const maxPageBytes = 2_000_000;
const maxIconFileBytes = 1_000_000;
/** A page can declare a dozen sizes; its largest few are enough. */
const maxDeclaredIcons = 6;

export interface FoundIcon {
  png: Uint8Array;
  width: number;
  url: string;
}

/** The best icon for a website, as data:icons picks it, or undefined when none will do. */
export async function findIcon(
  website: string,
  download: Download,
): Promise<FoundIcon | undefined> {
  const site = new URL(website);
  const urls: string[] = [];
  const page = await download(site.href, maxPageBytes, 'text/html');
  if (page) {
    const html = new TextDecoder().decode(page.bytes);
    for (const link of iconLinksIn(html).slice(0, maxDeclaredIcons)) {
      const url = URL.parse(link.href, page.url);
      if (url && /^https?:$/.test(url.protocol)) urls.push(url.href);
    }
  }
  const origin = new URL(page?.url ?? site.href).origin;
  urls.push(...wellKnownIconPaths.map((path) => new URL(path, origin).href));
  urls.push(...iconServiceUrls(site.hostname));
  const candidates: (IconImage & { url: string })[] = [];
  for (const url of new Set(urls)) {
    const file = await download(url, maxIconFileBytes, 'image/*');
    const image = file && readIconImage(file.bytes);
    if (image) candidates.push({ ...image, url });
  }
  const best = pickIcon(candidates);
  return best && { png: best.png, width: best.width, url: best.url };
}

/** A file's Git blob hash: the SHA-1 of "blob <size>\0" and its bytes, as GitHub lists it. */
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const whole = new Uint8Array(header.length + bytes.length);
  whole.set(header);
  whole.set(bytes, header.length);
  const digest = await crypto.subtle.digest('SHA-1', whole);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Bytes as base64, for a Git blob and a Workflow step's result. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

import {
  iconServices,
  isIconServiceUrl,
  pickIcon,
  readIconImage,
  type IconImage,
  type IconServiceName,
} from '@simply-sub/core';

// Icons for custom subscriptions, for GET /icon (BLUEPRINT §5.4, M2.6). Only the icon services are ever fetched,
// never the site, and KV keeps each answer: an icon for 30 days, "no icon" for a day, so a site that adds one shows
// up soon. A KV key is a SHA-256 of the domain, so the namespace's key list doesn't show what people subscribe to,
// and nothing here logs the domain or a URL that contains it.

/** How long an icon is kept, in KV and in caches: 30 days. */
export const iconSeconds = 30 * 24 * 60 * 60;
/** How long "no icon" is kept: a day. */
export const noIconSeconds = 24 * 60 * 60;
/** How long each icon service gets to answer. */
const timeoutMs = 5000;
/** An ICO holding several BMP sizes can be large. The PNG kept from it is held to core's 100 KB limit. */
const maxFileBytes = 1_000_000;
const userAgent = 'SimplySubBot/1.0 (+https://sub.simplely.ca/)';

export interface FoundIcon {
  png: Uint8Array<ArrayBuffer>;
  source: IconServiceName;
}

interface IconMetadata {
  source: IconServiceName | 'none';
}

/** The icon for `domain` that KV keeps, else the best the icon services give, which KV then keeps. */
export async function keptIcon(env: Env, domain: string): Promise<FoundIcon | undefined> {
  const key = `icon:${await sha256Hex(domain)}`;
  const kept = await env.KV.getWithMetadata<IconMetadata>(key, 'arrayBuffer');
  const source = kept.metadata?.source;
  if (kept.value !== null && source !== undefined) {
    return source === 'none' ? undefined : { png: new Uint8Array(kept.value), source };
  }
  const found = await serviceIcon(domain);
  try {
    await env.KV.put(key, found?.png ?? new Uint8Array(), {
      expirationTtl: found ? iconSeconds : noIconSeconds,
      metadata: { source: found?.source ?? 'none' } satisfies IconMetadata,
    });
  } catch (error) {
    // Over the free plan's 1,000 writes a day, say: the icon is still answered, just not kept.
    console.warn(`KV didn't keep an icon: ${error instanceof Error ? error.name : 'unknown'}.`);
  }
  return found;
}

/** The best icon the icon services give for `domain`: core's pickIcon, so Google's wins a tie. */
async function serviceIcon(domain: string): Promise<FoundIcon | undefined> {
  const candidates = await Promise.all(
    iconServices(domain).map(async ({ name, url }) => {
      const bytes = await download(url, name);
      const image = bytes && readIconImage(bytes);
      return image && { ...image, source: name };
    }),
  );
  const best = pickIcon(
    candidates.filter(
      (candidate): candidate is IconImage & { source: IconServiceName } => candidate !== undefined,
    ),
  );
  // A copy in an ArrayBuffer of its own, as a response body needs.
  return best && { png: new Uint8Array(best.png), source: best.source };
}

/**
 * A successful response's body, or undefined for an error status (the services answer 404 for a site they don't
 * know), a timeout or a body over the limit. One redirect is followed, and only to an icon service's own host.
 */
async function download(url: string, service: IconServiceName): Promise<Uint8Array | undefined> {
  const init: RequestInit = {
    headers: { Accept: 'image/*', 'User-Agent': userAgent },
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  };
  try {
    let response = await fetch(url, init);
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get('Location');
      const next = location === null ? undefined : URL.parse(location, url)?.href;
      if (next === undefined || !isIconServiceUrl(next)) {
        console.warn(`The ${service} icon service redirected to another host.`);
        return undefined;
      }
      response = await fetch(next, init);
    }
    if (!response.ok || Number(response.headers.get('Content-Length')) > maxFileBytes) {
      await response.body?.cancel();
      return undefined;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length <= maxFileBytes ? bytes : undefined;
  } catch (error) {
    console.warn(
      `The ${service} icon service didn't answer: ${error instanceof Error ? error.name : 'unknown'}.`,
    );
    return undefined;
  }
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

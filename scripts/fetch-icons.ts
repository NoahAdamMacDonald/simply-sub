// Fetches provider icons into data/logos/<id>.png, where they're committed and reviewed; a build only copies them
// (BLUEPRINT §6.3). It works for any website: it collects the icons the home page declares, the well-known paths
// (/apple-touch-icon.png, /favicon.ico) and the icon services (Google, DuckDuckGo), downloads each, and keeps the
// largest square PNG of at least 32 pixels, using @simply-sub/core's icon functions. A site without one keeps no
// logo, and the app shows its first letter.
//
//   npm run data:icons                            every provider that has no logo yet
//   npm run data:icons -- netflix proton          these providers, replacing their logos
//   npm run data:icons -- hulu=https://hulu.com   any website, listed or not, saved as data/logos/hulu.png
import {
  iconLinksIn,
  iconServiceUrls,
  pickIcon,
  readIconImage,
  slugSchema,
  wellKnownIconPaths,
  type IconImage,
} from '@simply-sub/core';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalogFiles, plural, repoRoot } from './lib/catalog-files';

const userAgent = 'SimplySubBot/1.0 (+https://simplely.ca/simply/sub/)';
const timeoutMs = 15_000;
const maxPageBytes = 2_000_000;
/** An ICO holding several BMP sizes can be large. The PNG kept from it is held to core's 100 KB limit. */
const maxIconFileBytes = 1_000_000;
/** A page can declare a dozen sizes; its largest few are enough. */
const maxDeclaredIcons = 6;

interface Target {
  id: string;
  website: string;
}

interface Candidate extends IconImage {
  url: string;
}

const targets = await targetsFrom(process.argv.slice(2));
let written = 0;
for (const { id, website } of targets) {
  const file = `data/logos/${id}.png`;
  const { icon, tried } = await findIcon(website);
  if (icon) {
    const path = fileURLToPath(new URL(file, repoRoot));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, icon.png);
    written++;
    console.log(`${id}: ${icon.width}×${icon.height} from ${icon.url} → ${file}`);
  } else {
    console.log(
      `${id}: no square PNG of at least 32 pixels in ${plural(tried, 'place')}, so the app shows a letter. Add ${file} by hand to give it a logo.`,
    );
  }
}
console.log(
  targets.length === 0
    ? 'Every provider has a logo. Name providers to replace theirs: npm run data:icons -- netflix'
    : `Wrote ${plural(written, 'logo')}. Check them, then run npm run data:validate.`,
);

/** The sites to fetch icons for: the named ones, or every provider that has no logo yet. */
async function targetsFrom(args: string[]): Promise<Target[]> {
  const { files, sources } = await loadCatalogFiles();
  const websites = new Map<string, string>();
  for (const source of sources) {
    const id = /^data\/providers\/([^/]+)\.yaml$/.exec(source.file)?.[1];
    const website = 'data' in source ? (source.data as { website?: unknown } | null)?.website : '';
    if (id && typeof website === 'string') {
      websites.set(id, website);
    }
  }
  if (args.length === 0) {
    return [...websites]
      .filter(([id]) => !files.includes(`data/logos/${id}.png`))
      .map(([id, website]) => ({ id, website }));
  }
  return args.map((arg) => {
    const [id, website = websites.get(id)] = arg.split(/=(.*)/s);
    if (!slugSchema.safeParse(id).success) {
      fail(`"${id}" isn't a kebab-case id. Use a provider id, or <id>=<website> for another site.`);
    }
    if (website === undefined) {
      fail(`"${id}" isn't in data/providers/. For another site, use ${id}=<website>.`);
    }
    if (!/^https?:\/\/[^/]+/i.test(website)) {
      fail(`"${website}" isn't a website. Write it as https://example.com.`);
    }
    return { id, website };
  });
}

/** The best icon for a website, from its own pages first and then the icon services. */
async function findIcon(website: string): Promise<{ icon?: Candidate; tried: number }> {
  const site = new URL(website);
  const urls: string[] = [];
  const page = await download(site.href, maxPageBytes, 'text/html');
  if (page) {
    const html = new TextDecoder().decode(page.bytes);
    for (const link of iconLinksIn(html).slice(0, maxDeclaredIcons)) {
      const url = URL.parse(link.href, page.url);
      if (url && /^https?:$/.test(url.protocol)) {
        urls.push(url.href);
      }
    }
  }
  const origin = new URL(page?.url ?? site.href).origin;
  urls.push(...wellKnownIconPaths.map((path) => new URL(path, origin).href));
  urls.push(...iconServiceUrls(site.hostname));

  const unique = [...new Set(urls)];
  const candidates: Candidate[] = [];
  for (const url of unique) {
    const file = await download(url, maxIconFileBytes, 'image/*');
    const image = file && readIconImage(file.bytes);
    if (image) {
      candidates.push({ ...image, url });
    }
  }
  return { icon: pickIcon(candidates), tried: unique.length };
}

/**
 * The body of a successful response, with the URL it came from after redirects. Undefined for an error status
 * (the icon services answer 404 with a placeholder for a site they don't know), a timeout or a body over the limit.
 */
async function download(
  url: string,
  maxBytes: number,
  accept: string,
): Promise<{ url: string; bytes: Uint8Array } | undefined> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': userAgent, Accept: accept },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok || Number(response.headers.get('content-length')) > maxBytes) {
      return undefined;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length <= maxBytes ? { url: response.url, bytes } : undefined;
  } catch {
    return undefined;
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

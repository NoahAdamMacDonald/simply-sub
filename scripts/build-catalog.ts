// Builds the catalog snapshot files and the provider icons from data/ (BLUEPRINT §6.3):
//   apps/web/public/data/catalog.json              the full snapshot, which the Angular build publishes as
//                                                  /data/catalog.json
//   apps/web/public/data/catalog/<region>.json     one per priced country and group (EU): only the prices
//                                                  pickPrice can pick there
//   apps/web/public/data/catalog/index.json        the catalog version and the regions with a file
//   apps/web/public/data/catalog/features.json     the GET /features body
//   apps/web/public/data/catalog/categories.json   the GET /categories body
//   apps/web/public/data/catalog/ids.json          every provider id with its plan ids, for the API's suggestions
//   apps/web/public/icons/<id>.webp                each provider's logo from data/logos/, as a WebP of at most 96 px,
//                                                  published as /icons/<id>.webp
// It refuses to build a catalog with validation errors. The catalog version is a hash of the snapshot's data, so it
// changes only when the catalog does. The deploy seeds D1 from catalog.json (scripts/seed-d1.ts).
import {
  buildCatalogData,
  buildCatalogIndex,
  buildCatalogMeta,
  catalogIconFile,
  catalogIconSize,
  catalogIds,
  categoriesBody,
  featuresBody,
  readCatalogSource,
  regionSnapshot,
  type CatalogSnapshot,
} from '@simply-sub/core';
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  catalogFile,
  checkCatalog,
  countErrors,
  plural,
  printIssues,
  repoRoot,
} from './lib/catalog-files';

const iconBaseUrl = 'https://sub.simplely.ca/icons/';
const catalogDir = 'apps/web/public/data/catalog/';
const iconsDir = 'apps/web/public/icons/';

const { sources, issues } = await checkCatalog();
const errors = countErrors(issues);
if (errors > 0) {
  printIssues(issues);
  console.error(`Not building the catalog: data/ has ${plural(errors, 'error')}.`);
  process.exitCode = 1;
} else {
  const source = readCatalogSource(sources);
  const data = buildCatalogData(source, iconBaseUrl);
  const catalogVersion = createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex')
    .slice(0, 7);
  const generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const snapshot: CatalogSnapshot = {
    data,
    meta: buildCatalogMeta(data, { catalogVersion, generatedAt }),
  };
  const json = JSON.stringify(snapshot);
  await write(catalogFile, json);

  // Only the current regions' files and providers' and resellers' icons: an old build's go first. The folder also holds
  // the index, the GET /features and GET /categories bodies and the ids file.
  await clear(catalogDir);
  const index = buildCatalogIndex(snapshot.meta);
  const sizes: string[] = [];
  for (const region of index.regions) {
    const regionJson = JSON.stringify(regionSnapshot(snapshot, region));
    await write(`${catalogDir}${region}.json`, regionJson);
    sizes.push(`${region} ${kilobytes(regionJson)}`);
  }
  await write(`${catalogDir}index.json`, JSON.stringify(index));
  await write(`${catalogDir}features.json`, JSON.stringify(featuresBody(snapshot)));
  await write(`${catalogDir}categories.json`, JSON.stringify(categoriesBody(snapshot)));
  await write(`${catalogDir}ids.json`, JSON.stringify(catalogIds(snapshot)));

  await clear(iconsDir);
  const icons = [...data.providers, ...data.resellers].filter(({ iconUrl }) => iconUrl);
  let iconBytes = 0;
  for (const { id } of icons) {
    const png = source.logos.get(id);
    if (png) {
      const webp = await webpIcon(png);
      await write(`${iconsDir}${catalogIconFile(id)}`, webp);
      iconBytes += webp.length;
    }
  }

  const warnings = issues.length - errors;
  console.log(
    [
      `Catalog ${catalogVersion}: wrote ${catalogFile} (${kilobytes(json)}),`,
      ` ${plural(index.regions.length, 'region file')} in ${catalogDir} (${sizes.join(', ')}),`,
      ' features.json, categories.json, ids.json',
      ` and ${plural(icons.length, 'WebP icon')} (${Math.ceil(iconBytes / 1024)} KB in all).`,
      warnings > 0 ? ` ${plural(warnings, 'warning')}: run npm run data:validate.` : '',
    ].join(''),
  );
}

/**
 * A logo as the app gets it: at most catalogIconSize pixels wide (a smaller one isn't enlarged), as a lossy WebP whose
 * transparency stays exact. At icon sizes, quality 90 looks the same as the PNG, at about a fifth of the bytes.
 */
async function webpIcon(png: Uint8Array): Promise<Buffer> {
  return sharp(png)
    .resize(catalogIconSize, catalogIconSize, { withoutEnlargement: true })
    .webp({ quality: 90, alphaQuality: 100, effort: 6 })
    .toBuffer();
}

async function write(file: string, contents: string | Uint8Array): Promise<void> {
  const path = fileURLToPath(new URL(file, repoRoot));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

async function clear(dir: string): Promise<void> {
  await rm(fileURLToPath(new URL(dir, repoRoot)), { recursive: true, force: true });
}

function kilobytes(text: string): string {
  return `${Math.ceil(Buffer.byteLength(text) / 1024)} KB`;
}

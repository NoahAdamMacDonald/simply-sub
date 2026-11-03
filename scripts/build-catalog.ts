// Builds the catalog snapshot files and the provider icons from data/ (BLUEPRINT §6.3):
//   apps/web/public/data/catalog.json              the full snapshot, which the Angular build publishes as
//                                                  /data/catalog.json
//   apps/web/public/data/catalog/<region>.json     one per priced country and group (EU): only the prices
//                                                  pickPrice can pick there
//   apps/web/public/data/catalog/index.json        the catalog version and the regions with a file
//   apps/web/public/data/catalog/features.json     the GET /features body
//   apps/web/public/data/catalog/categories.json   the GET /categories body
//   apps/web/public/data/catalog/ids.json          every provider id with its plan ids, for the API's suggestions
//   apps/web/public/data/policies/<id>.json        a provider's Terms and policies (M11.8), out of every other file
//   apps/web/public/data/policies/shared/<id>.json a shared policy document
//   apps/web/public/data/policies/index.json       the pages each of those cites, for the nightly check
//   apps/web/public/icons/<id>.webp                each provider's logo from data/logos/, as a WebP of at most 96 px,
//                                                  published as /icons/<id>.webp
// It refuses to build a catalog with validation errors, and fails on a file over 20 MiB, naming it, before Cloudflare's
// 25 MiB refuses the deploy (M11.8). The catalog version is a hash of the snapshot's data, so it changes only when the
// catalog does. The deploy seeds D1 from catalog.json (scripts/seed-d1.ts).
import {
  buildCatalogIndex,
  catalogIconFile,
  catalogIconSize,
  catalogIds,
  buildPolicyIndex,
  categoriesBody,
  featuresBody,
  policyFilePath,
  policyFiles,
  policyIndexPath,
  regionSnapshot,
  sharedPolicyFilePath,
} from '@simply-sub/core';
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
import { buildSnapshot } from './lib/snapshot';

const publicDir = 'apps/web/public/';
const catalogDir = 'apps/web/public/data/catalog/';
const policiesDir = 'apps/web/public/data/policies/';
const iconsDir = 'apps/web/public/icons/';
/** Cloudflare refuses a static file over 25 MiB: the build stops first, at 20 (M11.8). */
const maxFileBytes = 20 * 1024 * 1024;

const { sources, issues } = await checkCatalog();
const errors = countErrors(issues);
if (errors > 0) {
  printIssues(issues);
  console.error(`Not building the catalog: data/ has ${plural(errors, 'error')}.`);
  process.exitCode = 1;
} else {
  const generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const { source, snapshot } = buildSnapshot(sources, generatedAt);
  const { data } = snapshot;
  const { catalogVersion } = snapshot.meta;
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

  // Terms and policies: a file per provider and shared document, and their index (M11.8).
  await clear(policiesDir);
  const policies = policyFiles(source);
  let policyBytes = 0;
  for (const file of policies.providers) {
    const json = JSON.stringify(file);
    await write(`${publicDir}${policyFilePath(file.id)}`, json);
    policyBytes += Buffer.byteLength(json);
  }
  for (const set of policies.sets) {
    const json = JSON.stringify(set);
    await write(`${publicDir}${sharedPolicyFilePath(set.id)}`, json);
    policyBytes += Buffer.byteLength(json);
  }
  await write(`${publicDir}${policyIndexPath}`, JSON.stringify(buildPolicyIndex(policies)));

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
      ' features.json, categories.json, ids.json,',
      ` ${plural(policies.providers.length + policies.sets.length, 'policies file')} (${Math.ceil(policyBytes / 1024)} KB in all)`,
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
  const bytes = typeof contents === 'string' ? Buffer.byteLength(contents) : contents.length;
  if (bytes > maxFileBytes) {
    throw new Error(
      `${file} would be ${Math.ceil(bytes / 1024 / 1024)} MiB, over the 20 MiB a static file may have here (Cloudflare refuses 25): split it`,
    );
  }
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

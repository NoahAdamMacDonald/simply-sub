// Builds the catalog snapshot, the provider icons and the D1 seed from data/ (BLUEPRINT §6.3):
//   apps/web/public/data/catalog.json  the snapshot, which the Angular build publishes as /simply/sub/data/catalog.json
//   apps/web/public/icons/<id>.png     each provider's logo from data/logos/, published as /simply/sub/icons/<id>.png
//   apps/api/dist/seed.sql             the SQL the deploy runs against D1 (BLUEPRINT §7.6)
// It refuses to build a catalog with validation errors. The catalog version is a hash of the snapshot's data, so it
// changes only when the catalog does.
import {
  buildCatalogData,
  buildCatalogMeta,
  buildSeedSql,
  readCatalogSource,
  type CatalogSnapshot,
} from '@simply-sub/core';
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCatalog, countErrors, plural, printIssues, repoRoot } from './lib/catalog-files';

const iconBaseUrl = 'https://simplely.ca/simply/sub/icons/';
const catalogFile = 'apps/web/public/data/catalog.json';
const iconsDir = 'apps/web/public/icons/';
const seedFile = 'apps/api/dist/seed.sql';

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
  const seed = buildSeedSql(snapshot);
  await write(catalogFile, json);
  await write(seedFile, seed);

  // Only the current providers' icons: an old build's icons go first.
  await rm(fileURLToPath(new URL(iconsDir, repoRoot)), { recursive: true, force: true });
  const icons = data.providers.filter((provider) => provider.iconUrl);
  for (const { id } of icons) {
    const png = source.logos.get(id);
    if (png) {
      await write(`${iconsDir}${id}.png`, png);
    }
  }

  const warnings = issues.length - errors;
  console.log(
    [
      `Catalog ${catalogVersion}: wrote ${catalogFile} (${Math.ceil(Buffer.byteLength(json) / 1024)} KB),`,
      ` ${plural(icons.length, 'icon')} and ${seedFile} (${plural(seed.trimEnd().split('\n').length, 'statement')}).`,
      warnings > 0 ? ` ${plural(warnings, 'warning')}: run npm run data:validate.` : '',
    ].join(''),
  );
}

async function write(file: string, contents: string | Uint8Array): Promise<void> {
  const path = fileURLToPath(new URL(file, repoRoot));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

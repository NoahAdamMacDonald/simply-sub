// Writes data/schema/<kind>.schema.json from the catalog's Zod schemas (BLUEPRINT §4.5), so VS Code autocompletes
// and validates the YAML files. With --check it writes nothing and fails if a committed file is out of date (CI).
import { catalogJsonSchemas } from '@simply-sub/core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

const check = process.argv.includes('--check');
const outDir = new URL('../data/schema/', import.meta.url);
const stale: string[] = [];

await mkdir(outDir, { recursive: true });
for (const [kind, schema] of Object.entries(catalogJsonSchemas())) {
  const name = `${kind}.schema.json`;
  const file = fileURLToPath(new URL(name, outDir));
  const text = await format(JSON.stringify(schema), {
    ...(await resolveConfig(file)),
    filepath: file,
  });
  const current = await readFile(file, 'utf8').catch(() => undefined);
  if (current === text) {
    continue;
  }
  stale.push(`data/schema/${name}`);
  if (!check) {
    await writeFile(file, text);
  }
}

if (check && stale.length > 0) {
  console.error(
    `Out of date: ${stale.join(', ')}\nRun \`npm run data:schema\` and commit the result.`,
  );
  process.exitCode = 1;
} else {
  console.log(stale.length > 0 ? `Wrote ${stale.join(', ')}` : 'data/schema is up to date.');
}

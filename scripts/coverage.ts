// The coverage report (M11.7, the guide's §3.2): `npm run data:coverage` lists, for each provider, the regions it's
// sold in where a paid plan of it has no price, so a region left unread shows before a buyer there sees only the free
// plan (Claude's before M10.17). A gap its provider file explains in a "Coverage:" note passes; the rest are errors.
// Exits with 1 on any error.
import { readFile } from 'node:fs/promises';
import {
  coverageGaps,
  coverageNotes,
  explains,
  providerSchema,
  type CoverageGap,
  type Provider,
} from '@simply-sub/core';
import { loadCatalogFiles, plural } from './lib/catalog-files';
import { absolute } from './lib/pipeline-files';

const { sources } = await loadCatalogFiles();
const providers: { provider: Provider; file: string }[] = [];
for (const source of sources) {
  if (!source.file.startsWith('data/providers/') || !('data' in source)) continue;
  const parsed = providerSchema.safeParse(source.data);
  if (parsed.success) providers.push({ provider: parsed.data, file: source.file });
  else console.log(`Skipped ${source.file}: it doesn't match its schema (npm run data:validate)`);
}

/** Why a region counts, as the report says it. */
const why: Record<CoverageGap['why'], string> = {
  priced: 'though its other plans have one there',
  available: 'though its availableIn lists them',
  global: 'though a plan of it is priced for everywhere',
};

let errors = 0;
let covered = 0;
for (const { provider, file } of providers) {
  const gaps = coverageGaps([provider]);
  const notes = coverageNotes(await readFile(absolute(file), 'utf8'));
  const open = gaps.filter((gap) => !notes.some((note) => explains(note, gap)));
  if (open.length === 0) {
    covered++;
    continue;
  }
  errors += open.length;
  console.log(`Error: ${file}: ${plural(open.length, 'gap')} no "Coverage:" note explains`);
  // One line a plan and reason: its regions with no price.
  const lines = new Map<string, string[]>();
  for (const gap of open) {
    const key = `${gap.plan}: no price in ${'{regions}'}, ${why[gap.why]}`;
    lines.set(key, [...(lines.get(key) ?? []), gap.region]);
  }
  for (const [line, regions] of lines)
    console.log(`  ${line.replace('{regions}', regions.join(', '))}`);
}

console.log(
  `Checked ${plural(providers.length, 'provider')}: ${covered} covered, ${providers.length - covered} with gaps` +
    `${errors > 0 ? `, ${plural(errors, 'error')}` : ''}.`,
);
console.log(
  'Explain a gap in the provider file with a comment block of its own: "# Coverage: <plan id> (or <provider>.*) in <REGION>: <why>".',
);
process.exitCode = errors > 0 ? 1 : 0;

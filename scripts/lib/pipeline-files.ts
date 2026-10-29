// The discovery pipeline's working files (BLUEPRINT §6.5), in .pipeline/ at the repository's root, which Git ignores:
// for each provider, the pages found (urls.json), each page read (pages/<kind>.json and its screenshot), and the
// extraction's request and answer. What the catalog keeps goes into data/; these stay on this machine as evidence.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './catalog-files';

/** A path in a provider's working folder, from the repository's root: .pipeline/<id>/<name>. */
export function workFile(id: string, name: string): string {
  return `.pipeline/${id}/${name}`;
}

/** The absolute path of a repository path. */
export function absolute(path: string): string {
  return fileURLToPath(new URL(path, repoRoot));
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  const file = absolute(path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(absolute(path), 'utf8')) as T;
  } catch {
    return undefined;
  }
}

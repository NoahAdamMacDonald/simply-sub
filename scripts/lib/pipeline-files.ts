// The discovery pipeline's working files (BLUEPRINT §6.5), in .pipeline/ at the repository's root, which Git ignores:
// for each provider, the pages found (urls.json), each page read (pages/<kind>.json and its screenshot), and the
// extraction's request and answer. What the catalog keeps goes into data/; these stay on this machine as evidence.
import type { KindReport, PageKind } from '@simply-sub/core';
import type { RenderedPage } from './browser';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './catalog-files';

/** What find-urls writes for a provider: urls.json. */
export interface FoundUrls {
  id: string;
  name: string;
  website: string;
  domains?: string[];
  /** When the pages were found. */
  found: string;
  pages: Partial<Record<PageKind, { url: string; via: string; fit: string }>>;
  reports: KindReport[];
}

/** What render-pages writes for a page: pages/<name>.json. */
export interface PageRecord extends RenderedPage {
  kind: PageKind;
  /** When it was read. */
  read: string;
  /** How many prices it shows in each currency (a bare $ is `dollar`), to spot a page priced for another country. */
  currencies: Record<string, number>;
}

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

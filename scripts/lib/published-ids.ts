// The ids guard (BLUEPRINT §4.3, M10.27), for check-ids.ts and validate-data.ts: the ids main publishes, read from its
// data/ at the merge base through git, against the branch's working tree. Main's own files are read leniently (core's
// publishedIds), so a schema change on the branch doesn't hide them.
import {
  missingIdIssue,
  missingIds,
  publishedIds,
  publishedRedirects,
  type CatalogSourceFile,
} from '@simply-sub/core';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { loadCatalogFiles, repoRoot, type LocatedIssue } from './catalog-files';

export interface IdsCheck {
  /** The commit compared with: main's at the merge base, or undefined when there's none to read. */
  base?: string;
  /** Why there's no base: no git, or no main fetched. */
  skipped?: string;
  /** How many ids main publishes. */
  checked: number;
  issues: LocatedIssue[];
}

/** Each id main publishes that the branch has lost without retiring or redirecting it, as an error in its file. */
export async function checkIds(): Promise<IdsCheck> {
  const base = mergeBase();
  if ('skipped' in base) return { skipped: base.skipped, checked: 0, issues: [] };
  const main = publishedIds(filesAt(base.commit));
  const { sources } = await loadCatalogFiles();
  const lost = missingIds(main, publishedIds(sources), publishedRedirects(sources));
  return {
    base: base.commit,
    checked: main.length,
    issues: lost.map((id) => ({ issue: missingIdIssue(id) })),
  };
}

/** The commit where the branch left main: origin/main's (CI fetches it), else a local main's. */
function mergeBase(): { commit: string } | { skipped: string } {
  for (const ref of ['origin/main', 'main']) {
    try {
      return { commit: git('merge-base', 'HEAD', ref).trim() };
    } catch {
      // The next ref, or none.
    }
  }
  return { skipped: 'no main branch to compare with: run git fetch origin main' };
}

/** data/'s YAML files at `commit`, parsed; one that doesn't parse is left out. */
function filesAt(commit: string): CatalogSourceFile[] {
  return git('ls-tree', '-r', '--name-only', commit, '--', 'data/')
    .split('\n')
    .filter((file) => /\.ya?ml$/.test(file))
    .flatMap((file) => {
      try {
        return [{ file, data: parse(git('show', `${commit}:${file}`)) as unknown }];
      } catch {
        return [];
      }
    });
}

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: fileURLToPath(repoRoot),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

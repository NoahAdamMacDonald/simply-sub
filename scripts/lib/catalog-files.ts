// Reads and checks data/ for the catalog scripts (validate-data.ts, build-catalog.ts): parses every .yaml and .yml
// file as YAML 1.2, runs validateCatalog from @simply-sub/core with today's date, and finds each issue's line.
import {
  formatCatalogIssue,
  toIsoDate,
  validateCatalog,
  type CatalogIssue,
  type CatalogIssuePath,
  type CatalogSourceFile,
} from '@simply-sub/core';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isMap, isScalar, isSeq, LineCounter, parseAllDocuments, type Document } from 'yaml';

export const repoRoot = new URL('../../', import.meta.url);

export interface LocatedIssue {
  issue: CatalogIssue;
  line?: number;
}

export interface CheckedCatalog {
  /** Every .yaml and .yml file under data/, from the repo root, sorted. */
  files: string[];
  sources: CatalogSourceFile[];
  /** YAML errors and validateCatalog's issues, sorted by file and line. */
  issues: LocatedIssue[];
}

interface ParsedDocument {
  document: Document;
  lineCounter: LineCounter;
}

export async function checkCatalog(): Promise<CheckedCatalog> {
  const files = (await readdir(new URL('data/', repoRoot), { recursive: true }))
    .map((name) => `data/${name.replaceAll('\\', '/')}`)
    .filter((file) => /\.ya?ml$/.test(file))
    .sort();

  const sources: CatalogSourceFile[] = [];
  const yamlIssues: LocatedIssue[] = [];
  const documents = new Map<string, ParsedDocument>();
  for (const file of files) {
    const text = await readFile(fileURLToPath(new URL(file, repoRoot)), 'utf8');
    const lineCounter = new LineCounter();
    // YAML 1.2 is the package's default, so dates such as 2026-10-21 stay strings.
    const parsed = parseAllDocuments(text, { lineCounter, prettyErrors: false });
    const [document, ...extra] = parsed;
    const yamlIssue = (severity: CatalogIssue['severity'], message: string, offset: number) =>
      yamlIssues.push({
        issue: { severity, file, path: [], message },
        line: lineCounter.linePos(offset).line,
      });
    for (const { errors, warnings } of parsed) {
      errors.forEach((error) => yamlIssue('error', error.message, error.pos[0]));
      warnings.forEach((warning) => yamlIssue('warning', warning.message, warning.pos[0]));
    }
    if (extra.length > 0) {
      yamlIssue(
        'error',
        'Put one YAML document in each file: remove the --- line',
        extra[0].range[0],
      );
    }
    if (parsed.some(({ errors }) => errors.length > 0) || extra.length > 0) {
      sources.push({ file, invalidYaml: true });
    } else if (document) {
      documents.set(file, { document, lineCounter });
      sources.push({ file, data: document.toJS() });
    } else {
      sources.push({ file, data: null }); // an empty file
    }
  }

  const issues: LocatedIssue[] = [
    ...yamlIssues,
    ...validateCatalog(sources, toIsoDate(new Date())).map((issue) => ({
      issue,
      line: lineOf(documents.get(issue.file), issue.path),
    })),
  ].sort(
    (a, b) =>
      Number(a.issue.file > b.issue.file) - Number(a.issue.file < b.issue.file) ||
      (a.line ?? 0) - (b.line ?? 0),
  );
  return { files, sources, issues };
}

/** Prints each issue as `Error: file:line path: message`, or in GitHub Actions as an annotation. */
export function printIssues(issues: readonly LocatedIssue[]): void {
  const inActions = process.env['GITHUB_ACTIONS'] === 'true';
  for (const { issue, line } of issues) {
    const text = formatCatalogIssue(issue, line);
    if (inActions) {
      // A workflow command: GitHub shows it in the log as `Error: <text>` and as an annotation on the file.
      const properties = [`file=${escapeProperty(issue.file)}`, line ? `line=${line}` : []].flat();
      console.log(`::${issue.severity} ${properties.join(',')}::${escapeData(text)}`);
    } else {
      console.error(`${issue.severity === 'error' ? 'Error' : 'Warning'}: ${text}`);
    }
  }
}

export function countErrors(issues: readonly LocatedIssue[]): number {
  return issues.filter(({ issue }) => issue.severity === 'error').length;
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The line `path` points at: the key it ends on, or the list item. A path that goes past what's in the file
 * (a missing key) points at the deepest part that exists. An issue about the whole file has no line.
 */
function lineOf(parsed: ParsedDocument | undefined, path: CatalogIssuePath): number | undefined {
  if (!parsed || path.length === 0) {
    return undefined;
  }
  let node: unknown = parsed.document.contents;
  let offset: number | undefined;
  for (const key of path) {
    if (isMap(node)) {
      const pair = node.items.find(
        (item) => isScalar(item.key) && String(item.key.value) === String(key),
      );
      if (!pair || !isScalar(pair.key)) {
        break;
      }
      offset = pair.key.range?.[0];
      node = pair.value;
    } else if (isSeq(node) && typeof key === 'number') {
      const item: unknown = node.items[key];
      if (!isMap(item) && !isSeq(item) && !isScalar(item)) {
        break;
      }
      offset = item.range?.[0];
      node = item;
    } else {
      break;
    }
  }
  return offset === undefined ? undefined : parsed.lineCounter.linePos(offset).line;
}

// https://docs.github.com/actions/reference/workflows-and-actions/workflow-commands
function escapeData(text: string): string {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function escapeProperty(text: string): string {
  return escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C');
}

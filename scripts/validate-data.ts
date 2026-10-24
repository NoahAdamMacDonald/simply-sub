// Validates the catalog (BLUEPRINT §6.2): parses every .yaml and .yml file under data/ as YAML 1.2, runs
// validateCatalog from @simply-sub/core with today's date, and prints each problem as `file:line path: message`.
// In GitHub Actions each one is also an annotation on the pull request. Exits with 1 on any error; warnings alone
// pass.
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

const root = new URL('../', import.meta.url);
const inActions = process.env['GITHUB_ACTIONS'] === 'true';

interface Located {
  issue: CatalogIssue;
  line?: number;
}

const files = (await readdir(new URL('data/', root), { recursive: true }))
  .map((name) => `data/${name.replaceAll('\\', '/')}`)
  .filter((file) => /\.ya?ml$/.test(file))
  .sort();

const sources: CatalogSourceFile[] = [];
const yamlIssues: Located[] = [];
const documents = new Map<string, { document: Document; lineCounter: LineCounter }>();
for (const file of files) {
  const text = await readFile(fileURLToPath(new URL(file, root)), 'utf8');
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

const located: Located[] = [
  ...yamlIssues,
  ...validateCatalog(sources, toIsoDate(new Date())).map((issue) => ({
    issue,
    line: lineOf(issue.file, issue.path),
  })),
].sort(
  (a, b) =>
    Number(a.issue.file > b.issue.file) - Number(a.issue.file < b.issue.file) ||
    (a.line ?? 0) - (b.line ?? 0),
);

for (const { issue, line } of located) {
  const text = formatCatalogIssue(issue, line);
  if (inActions) {
    // A workflow command: GitHub shows it in the log as `Error: <text>` and as an annotation on the file.
    const properties = [`file=${escapeProperty(issue.file)}`, line ? `line=${line}` : []].flat();
    console.log(`::${issue.severity} ${properties.join(',')}::${escapeData(text)}`);
  } else {
    console.error(`${issue.severity === 'error' ? 'Error' : 'Warning'}: ${text}`);
  }
}

const errors = located.filter(({ issue }) => issue.severity === 'error').length;
const warnings = located.length - errors;
const counts = [
  errors > 0 ? plural(errors, 'error') : [],
  warnings > 0 ? plural(warnings, 'warning') : [],
].flat();
console.log(
  `Checked ${plural(files.length, 'catalog file')}: ${counts.length > 0 ? counts.join(' and ') : 'no problems'}.`,
);
process.exitCode = errors > 0 ? 1 : 0;

/**
 * The line `path` points at: the key it ends on, or the list item. A path that goes past what's in the file
 * (a missing key) points at the deepest part that exists. An issue about the whole file has no line.
 */
function lineOf(file: string, path: CatalogIssuePath): number | undefined {
  const parsed = documents.get(file);
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

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

// https://docs.github.com/actions/reference/workflows-and-actions/workflow-commands
function escapeData(text: string): string {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function escapeProperty(text: string): string {
  return escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C');
}

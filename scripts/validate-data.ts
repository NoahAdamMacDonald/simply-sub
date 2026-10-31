// Validates the catalog (BLUEPRINT §6.2): parses every .yaml and .yml file under data/ as YAML 1.2, runs
// validateCatalog from @simply-sub/core with today's date, and prints each problem as `file:line path: message`.
// In GitHub Actions each one is also an annotation on the pull request. Then the ids guard (check-ids.ts, M10.27): an id
// main publishes that's gone from the branch without being retired or redirected is an error too. Exits with 1 on any
// error; warnings alone pass.
import { checkCatalog, countErrors, plural, printIssues } from './lib/catalog-files';
import { checkIds } from './lib/published-ids';

const catalog = await checkCatalog();
const ids = await checkIds();
const { files } = catalog;
const issues = [...catalog.issues, ...ids.issues];
printIssues(issues);

const errors = countErrors(issues);
const warnings = issues.length - errors;
const counts = [
  errors > 0 ? plural(errors, 'error') : [],
  warnings > 0 ? plural(warnings, 'warning') : [],
].flat();
console.log(
  `Checked ${plural(files.length, 'catalog file')}: ${counts.length > 0 ? counts.join(' and ') : 'no problems'}.`,
);
console.log(
  ids.skipped
    ? `Ids not checked: ${ids.skipped}.`
    : `Ids: ${plural(ids.checked, 'published id')} on main at ${ids.base?.slice(0, 7)}, ${ids.issues.length > 0 ? `${plural(ids.issues.length, 'id')} gone` : 'none gone'}.`,
);
const unchecked = ids.skipped !== undefined && process.env['GITHUB_ACTIONS'] === 'true';
process.exitCode = errors > 0 || unchecked ? 1 : 0;

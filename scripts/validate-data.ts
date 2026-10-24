// Validates the catalog (BLUEPRINT §6.2): parses every .yaml and .yml file under data/ as YAML 1.2, runs
// validateCatalog from @simply-sub/core with today's date, and prints each problem as `file:line path: message`.
// In GitHub Actions each one is also an annotation on the pull request. Exits with 1 on any error; warnings alone
// pass.
import { checkCatalog, countErrors, plural, printIssues } from './lib/catalog-files';

const { files, issues } = await checkCatalog();
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
process.exitCode = errors > 0 ? 1 : 0;

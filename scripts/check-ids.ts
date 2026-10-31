// The ids guard (BLUEPRINT §4.3, M10.27): fails when an id main publishes (a provider, plan, add-on, bundle or rank key)
// is gone from the branch without being retired or redirected, naming it and the ways to keep it. data:validate runs
// it too; in CI, the checkout fetches main for it.
import { countErrors, plural, printIssues } from './lib/catalog-files';
import { checkIds } from './lib/published-ids';

const { base, skipped, checked, issues } = await checkIds();
printIssues(issues);
const errors = countErrors(issues);
if (skipped) {
  console.log(`Ids not checked: ${skipped}.`);
} else {
  console.log(
    `Checked ${plural(checked, 'published id')} against main at ${base?.slice(0, 7)}: ${errors > 0 ? `${plural(errors, 'id')} gone` : 'none gone'}.`,
  );
}
process.exitCode = errors > 0 || (skipped && process.env['GITHUB_ACTIONS'] === 'true') ? 1 : 0;

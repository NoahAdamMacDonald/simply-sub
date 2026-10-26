import { suggestedPlanId, type CatalogIds } from '../catalog/catalog-ids';
import { planIdSchema } from '../catalog/formats';
import { defaultCurrency } from '../catalog/region-currency';
import type { QueryProblem } from '../api/error-body';
import { currencyIssue, needsRegion, regionIssue } from '../search/providers-query';

// The query strings of GET /providers/:id, GET /plans/:id and GET /bundles (docs/api-output-examples.json). Region and
// currency follow GET /providers' rules: a region picks prices, the currency defaults to the region's own (or US
// dollars when the ECB has no rate for it), and a currency without a region is a problem. Anything unknown or
// invalid is a problem too, which the API answers with 400 bad_request (BLUEPRINT §5.4).

/** Where prices are picked, and in which currency: both or neither. */
export interface PricingQuery {
  region?: string;
  currency?: string;
}

/** GET /bundles' query: the plans to find bundles for, each listed once. */
export interface BundlesQuery extends PricingQuery {
  plans: string[];
}

/** The most plan ids GET /bundles takes. */
export const maxBundlePlans = 20;

/** GET /providers/:id's or GET /plans/:id's query (`route` names it in messages), or each problem with it. */
export function readPricingQuery(
  queries: Readonly<Record<string, readonly string[]>>,
  { route, currencies }: { route: string; currencies?: readonly string[] },
): { query: PricingQuery } | { problems: QueryProblem[] } {
  const { pricing, problems } = readQuery(queries, route, currencies, {});
  return problems.length > 0 ? { problems } : { query: pricing };
}

/** GET /bundles' query, or each problem with it. Whether the plans exist is the caller's question (unknownPlans). */
export function readBundlesQuery(
  queries: Readonly<Record<string, readonly string[]>>,
  { currencies }: { currencies?: readonly string[] },
): { query: BundlesQuery } | { problems: QueryProblem[] } {
  let plans: string[] = [];
  const { pricing, problems } = readQuery(queries, 'GET /bundles', currencies, {
    plans: (value) => {
      plans = [...new Set(value.split(',').map((id) => id.trim()))].filter(Boolean);
      if (plans.length === 0) {
        return 'List at least one plan id, such as netflix.standard.';
      }
      if (plans.length > maxBundlePlans) {
        return `List at most ${maxBundlePlans} plan ids.`;
      }
      const malformed = plans.filter((id) => !planIdSchema.safeParse(id).success);
      return malformed.length > 0
        ? `${malformed.map((id) => `"${id}" isn't a plan id: use <provider id>.<slug>, such as netflix.standard`).join('; ')}.`
        : undefined;
    },
  });
  if (!Object.hasOwn(queries, 'plans')) {
    problems.unshift({
      param: 'plans',
      issue: 'Needed: the plan ids to find bundles for, such as netflix.standard.',
    });
  }
  return problems.length > 0 ? { problems } : { query: { plans, ...pricing } };
}

/** The problem with plan ids the catalog doesn't have, each with the plan it looks like a typo of, if any. */
export function unknownPlans(ids: readonly string[], catalogIds?: CatalogIds): QueryProblem {
  const issues = ids.map((id) => {
    const suggestion = catalogIds && suggestedPlanId(id, catalogIds);
    return `"${id}" isn't a plan${suggestion === undefined ? '' : ` (did you mean ${suggestion}?)`}`;
  });
  return { param: 'plans', issue: `${issues.join('; ')}.` };
}

/** Reads region, currency and the `other` parameters, each checked by its function, in the order they came. */
function readQuery(
  queries: Readonly<Record<string, readonly string[]>>,
  route: string,
  currencies: readonly string[] | undefined,
  other: Readonly<Record<string, (value: string) => string | undefined>>,
): { pricing: PricingQuery; problems: QueryProblem[] } {
  const params = [...Object.keys(other), 'region', 'currency'];
  const problems: QueryProblem[] = [];
  let region: string | undefined;
  let currency: string | undefined;
  for (const [param, values] of Object.entries(queries)) {
    if (!params.includes(param)) {
      problems.push({
        param,
        issue: `Unknown parameter. ${route} takes ${params.slice(0, -1).join(', ')} and ${params[params.length - 1]}.`,
      });
      continue;
    }
    if (values.length > 1) {
      problems.push({
        param,
        issue:
          param === 'plans'
            ? 'Give one plans parameter, with the plan ids separated by commas.'
            : 'Give one value.',
      });
      continue;
    }
    const [value] = values;
    let issue: string | undefined;
    if (param === 'region') {
      region = value;
      issue = regionIssue(value);
    } else if (param === 'currency') {
      currency = value;
      issue = currencyIssue(value, currencies);
    } else {
      issue = other[param](value);
    }
    if (issue) {
      problems.push({ param, issue });
    }
  }
  if (region === undefined && currency !== undefined) {
    problems.push({ param: 'currency', issue: needsRegion });
  }
  return {
    pricing:
      region === undefined
        ? {}
        : { region, currency: currency ?? defaultCurrency(region, currencies) },
    problems,
  };
}

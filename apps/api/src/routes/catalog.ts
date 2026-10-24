import { isCatalogRegion, regionFileFor, regionProblem } from '@simply-sub/core';
import { Hono } from 'hono';
import { catalogFile } from '../catalog-files';
import { badQuery, type ParamProblem } from '../http';

/**
 * GET /catalog and GET /catalog?region=CA (docs/api-output-examples.json): the snapshot files that
 * `npm run data:build` writes (BLUEPRINT §6.3), data/catalog.json or a region's
 * data/catalog/<region>.json, streamed as they are (catalog-files.ts).
 */
export const catalog = new Hono<{ Bindings: Env }>().get('/', (c) => {
  const problems = queryProblems(c.req.queries());
  if (problems.length > 0) {
    return badQuery(c, problems);
  }
  const region = c.req.query('region');
  return catalogFile(c, (index) => {
    const code = region === undefined ? undefined : regionFileFor(region, index);
    return code === undefined ? '/data/catalog.json' : `/data/catalog/${code}.json`;
  });
});

/** Each problem with the query: GET /catalog takes one optional `region`, a catalog region code. */
function queryProblems(queries: Record<string, string[]>): ParamProblem[] {
  return Object.entries(queries).flatMap(([param, values]): ParamProblem[] => {
    if (param !== 'region') {
      return [{ param, issue: 'Unknown parameter. GET /catalog takes only region.' }];
    }
    if (values.length > 1) {
      return [{ param, issue: 'Give one region.' }];
    }
    return isCatalogRegion(values[0]) ? [] : [{ param, issue: `${regionProblem(values[0])}.` }];
  });
}

import { Hono } from 'hono';
import { catalogFile } from '../catalog-files';
import { badQuery, noParams } from '../http';

/**
 * GET /features (docs/api-output-examples.json): the feature registry in data/features.yaml order, each group
 * before its features. The body is data/catalog/features.json, which `npm run data:build` writes (BLUEPRINT §6.3),
 * streamed as it is (catalog-files.ts). It takes no query parameters.
 */
export const features = new Hono<{ Bindings: Env }>().get('/', (c) => {
  const problems = noParams(c, 'GET /features');
  return problems.length > 0
    ? badQuery(c, problems)
    : catalogFile(c, () => '/data/catalog/features.json');
});

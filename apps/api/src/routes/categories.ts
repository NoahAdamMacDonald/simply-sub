import { Hono } from 'hono';
import { badQuery, catalogFile, noParams } from '../catalog-files';

/**
 * GET /categories (docs/api-output-examples.json): the service, feature and spend categories in
 * data/categories.yaml order. The body is data/catalog/categories.json, which `npm run data:build` writes
 * (BLUEPRINT §6.3), streamed as it is (catalog-files.ts). It takes no query parameters.
 */
export const categories = new Hono<{ Bindings: Env }>().get('/', (c) => {
  const problems = noParams(c, 'GET /categories');
  return problems.length > 0
    ? badQuery(c, problems)
    : catalogFile(c, () => '/data/catalog/categories.json');
});

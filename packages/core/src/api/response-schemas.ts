import type * as z from 'zod';
import { fxBodySchema } from '../catalog/ecb-rates';
import { categoriesBodySchema, featuresBodySchema } from '../catalog/registry-files';
import { catalogSnapshotSchema } from '../catalog/snapshot';
import { bundlesBodySchema, planBodySchema, providerBodySchema } from '../lookup/lookup-bodies';
import { providersBodySchema } from '../search/providers-body';
import { healthBodySchema } from './health-body';

// The contract's success bodies (docs/api-output-examples.json), by endpoint as the examples file names them. The
// contract tests (M2.7) check every example and every route's answers against them; errors use errorBodySchema
// (error-body.ts), and a 304 has no body. An endpoint the examples list that isn't built yet (Phase 5) gets its
// schema here when it is.

/** GET /icon answers with the icon's bytes, not JSON. */
export const pngBody = 'image/png';

export const successBodySchemas = {
  'GET /health': healthBodySchema,
  'GET /catalog': catalogSnapshotSchema,
  'GET /features': featuresBodySchema,
  'GET /categories': categoriesBodySchema,
  'GET /providers': providersBodySchema,
  'GET /providers/:id': providerBodySchema,
  'GET /plans/:id': planBodySchema,
  'GET /bundles': bundlesBodySchema,
  'GET /fx': fxBodySchema,
  'GET /icon': pngBody,
} as const satisfies Record<string, z.ZodType | typeof pngBody>;

export type BuiltEndpoint = keyof typeof successBodySchemas;

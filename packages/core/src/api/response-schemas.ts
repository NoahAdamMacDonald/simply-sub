import * as z from 'zod';
import { fxBodySchema } from '../catalog/ecb-rates';
import { categoriesBodySchema, featuresBodySchema } from '../catalog/registry-files';
import { catalogSnapshotSchema } from '../catalog/snapshot';
import {
  calendarBody,
  calendarSetBodySchema,
  calendarSetUpdateBodySchema,
} from '../export/calendar-feed';
import { bundlesBodySchema, planBodySchema, providerBodySchema } from '../lookup/lookup-bodies';
import { providersBodySchema } from '../search/providers-body';
import { syncBody, syncWriteBodySchema } from '../user/sync';
import { healthBodySchema } from './health-body';

// The contract's success bodies (docs/api-output-examples.json), by endpoint as the examples file names them. The
// contract tests (M2.7) check every example and every route's answers against them; errors use errorBodySchema
// (error-body.ts), and a 304 or 204 has no body. An endpoint the examples list that isn't built yet (Phase 5) gets its
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
  'POST /cal': calendarSetBodySchema,
  'PUT /cal/:id': calendarSetUpdateBodySchema,
  // 204 No Content.
  'DELETE /cal/:id': z.null(),
  'GET /cal/:token.ics': calendarBody,
  'GET /sync/:chain': syncBody,
  'PUT /sync/:chain': syncWriteBodySchema,
  // 204 No Content.
  'DELETE /sync/:chain': z.null(),
} as const satisfies Record<
  string,
  z.ZodType | typeof pngBody | typeof calendarBody | typeof syncBody
>;

export type BuiltEndpoint = keyof typeof successBodySchemas;

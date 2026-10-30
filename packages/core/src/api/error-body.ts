import * as z from 'zod';

// The API's error envelope (docs/api-output-examples.json, PROJECT-PLAN §6): { error: { code, message, details? } }.
// Every error the Worker answers with has this shape, and the contract tests (M2.7) hold the examples and the routes
// to it.

/**
 * Each error code and the HTTP status it comes with, as the examples' errorCodes list them. The writes (M10.1) brought
 * a sync copy changed since it was read (412), a body over its limit (413) and a daily cap reached (503).
 */
export const errorStatuses = {
  bad_request: 400,
  forbidden: 403,
  not_found: 404,
  stale_version: 412,
  too_large: 413,
  rate_limited: 429,
  upstream_unavailable: 502,
  internal: 500,
  over_capacity: 503,
} as const;
export type ErrorCode = keyof typeof errorStatuses;

const errorCodes = Object.keys(errorStatuses) as [ErrorCode, ...ErrorCode[]];

/** One problem with a query parameter, in a 400's details. */
export const queryProblemSchema = z.strictObject({
  param: z.string().min(1),
  issue: z.string().min(1),
});
export type QueryProblem = z.infer<typeof queryProblemSchema>;

/**
 * One problem with a request's JSON body, in a 400's details (M10.1): where it is, as a path of keys and indexes
 * (`feeds.0.events.3.date`, or "" for the whole body), and what's wrong.
 */
export const bodyProblemSchema = z.strictObject({
  path: z.string(),
  issue: z.string().min(1),
});
export type BodyProblem = z.infer<typeof bodyProblemSchema>;

export const errorBodySchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(errorCodes),
    message: z.string().min(1),
    details: z
      .array(
        z.union([
          queryProblemSchema,
          bodyProblemSchema,
          // The id a 404's request may have meant (M2.4).
          z.strictObject({ suggestion: z.string().min(1) }),
        ]),
      )
      .min(1)
      .optional(),
  }),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

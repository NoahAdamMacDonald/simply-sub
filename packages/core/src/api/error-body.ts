import * as z from 'zod';

// The API's error envelope (docs/api-output-examples.json, PROJECT-PLAN §6): { error: { code, message, details? } }.
// Every error the Worker answers with has this shape, and the contract tests (M2.7) hold the examples and the routes
// to it.

/** Each error code and the HTTP status it comes with, as the examples' errorCodes list them. */
export const errorStatuses = {
  bad_request: 400,
  forbidden: 403,
  not_found: 404,
  rate_limited: 429,
  upstream_unavailable: 502,
  internal: 500,
} as const;
export type ErrorCode = keyof typeof errorStatuses;

const errorCodes = Object.keys(errorStatuses) as [ErrorCode, ...ErrorCode[]];

/** One problem with a query parameter, in a 400's details. */
export const queryProblemSchema = z.strictObject({
  param: z.string().min(1),
  issue: z.string().min(1),
});
export type QueryProblem = z.infer<typeof queryProblemSchema>;

export const errorBodySchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(errorCodes),
    message: z.string().min(1),
    details: z
      .array(
        z.union([
          queryProblemSchema,
          // The id a 404's request may have meant (M2.4).
          z.strictObject({ suggestion: z.string().min(1) }),
        ]),
      )
      .min(1)
      .optional(),
  }),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

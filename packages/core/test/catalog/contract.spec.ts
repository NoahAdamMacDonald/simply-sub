import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import contract from '../../../../docs/api-output-examples.json';
import {
  bundleSchema,
  catalogSnapshotSchema,
  errorBodySchema,
  errorStatuses,
  pngBody,
  successBodySchemas,
  categoriesBodySchema,
  categoriesFileSchema,
  featuresBodySchema,
  featuresFileSchema,
  fxRatesSchema,
  fxSource,
  pickPrice,
  providerSchema,
  regionSnapshot,
  type CatalogSnapshot,
  type ErrorBody,
  type FxRates,
  type PickedPrice,
  type Price,
} from '../../src';
import { issues } from './helpers';

// The YAML source files must stay compatible with the API contract: each catalog object in the examples, minus
// what the build and the API add (icon URLs, picked pricing, expanded bundle plans, savings, feature unions),
// is a valid source file. The GET /catalog body is the snapshot that scripts/build-catalog.ts writes (M1.5).
// Every example also matches the contract's response schemas (M2.7): an error, whatever its endpoint, the error
// envelope; a built endpoint's success body, its schema. The Worker's own answers are held to the same schemas
// in apps/api/test/contract.spec.ts.

function toSource(value: unknown, added: readonly string[] = ['iconUrl', 'pricing']): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toSource(item, added));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !key.startsWith('_') && !added.includes(key))
        .map(([key, item]) => [key, toSource(item, added)]),
    );
  }
  return value;
}

function dataOf<T>(body: { data: T } | null): T {
  if (!body) {
    throw new Error('This example has no body');
  }
  return body.data;
}

/** A GET /catalog example's body when it's a snapshot, not a 304 or an error. */
type SnapshotBody = Extract<
  (typeof contract.endpoints)['GET /catalog']['examples'][number]['response']['body'],
  { data: unknown }
>;

const catalog = dataOf(
  contract.endpoints['GET /catalog'].examples[0].response.body as SnapshotBody,
);
const providerExamples = contract.endpoints['GET /providers/:id'].examples;
const providers: [name: string, provider: unknown][] = [
  ...catalog.providers.map((provider): [string, unknown] => [
    `GET /catalog ${provider.id}`,
    provider,
  ]),
  ['GET /providers/netflix', providerExamples[0].response.body.data],
  ['GET /providers/proton', providerExamples[1].response.body.data],
];

describe('the contract examples, as source files', () => {
  it.each([
    ['GET /features', contract.endpoints['GET /features'].examples[0].response.body.data],
    ['GET /catalog features', catalog.features],
  ])('%s are a valid features.yaml', (_name, features) => {
    expect(issues(featuresFileSchema, toSource(features))).toEqual([]);
  });

  it.each([
    ['GET /categories', contract.endpoints['GET /categories'].examples[0].response.body.data],
    ['GET /catalog categories', catalog.categories],
  ])('%s are a valid categories.yaml', (_name, categories) => {
    expect(issues(categoriesFileSchema, toSource(categories))).toEqual([]);
  });

  it.each(providers)('%s is a valid provider file', (_name, provider) => {
    expect(issues(providerSchema, toSource(provider))).toEqual([]);
  });

  it('GET /bundles is a valid bundle file once its plans are ids again', () => {
    const { data } = contract.endpoints['GET /bundles'].examples[0].response.body;
    if (!data) {
      throw new Error('The first GET /bundles example has no bundles');
    }
    const [bundle] = data;
    const source = {
      ...(toSource(bundle, ['pricing', 'savings', 'features', 'includes']) as object),
      includes: bundle.includes.map((included) => included.planId),
    };
    expect(issues(bundleSchema, source)).toEqual([]);
  });
});

describe('the GET /catalog examples', () => {
  const [full, canada] = contract.endpoints['GET /catalog'].examples.map(
    (example) => toSource(example.response.body, []) as CatalogSnapshot,
  );

  it.each([
    ['full', full],
    ['?region=CA', canada],
  ])(
    'the %s snapshot is a catalog snapshot, once the documentation notes are gone',
    (_name, body) => {
      expect(issues(catalogSnapshotSchema, body)).toEqual([]);
    },
  );

  it("?region=CA is the full snapshot's region file for Canada", () => {
    expect(canada).toEqual(regionSnapshot(full, 'CA'));
  });
});

describe('the GET /features and GET /categories examples', () => {
  const features = toSource(contract.endpoints['GET /features'].examples[0].response.body, []);
  const categories = toSource(contract.endpoints['GET /categories'].examples[0].response.body, []);

  it('GET /features is a features body that counts its features', () => {
    expect(issues(featuresBodySchema, features)).toEqual([]);
    const { data, meta } = featuresBodySchema.parse(features);
    expect(meta.count).toBe(data.length);
  });

  it('GET /categories is a categories body', () => {
    expect(issues(categoriesBodySchema, categories)).toEqual([]);
  });
});

describe('the GET /fx examples', () => {
  const bodies = contract.endpoints['GET /fx'].examples
    .map((example) => toSource(example.response.body, []))
    .filter((body): body is { data: unknown; meta: unknown } => 'data' in (body as object));

  it.each(bodies.map((body, index) => [index, body]))(
    'example %i is rates in the base currency, with when they were fetched and whether they are stale',
    (_index, body) => {
      expect(issues(fxRatesSchema.extend({ source: z.literal(fxSource) }), body.data)).toEqual([]);
      expect(body.meta).toEqual({ fetchedAt: expect.any(String), stale: expect.any(Boolean) });
    },
  );
});

/**
 * Every object in `value` with a picked `pricing`, and its stored `prices`. Search results leave the stored prices
 * out, so theirs are rebuilt from each picked price's source: that still checks the conversion.
 */
function pricedIn(value: unknown): { prices: Price[]; pricing: PickedPrice[] }[] {
  if (Array.isArray(value)) {
    return value.flatMap(pricedIn);
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  const record = value as Record<string, unknown>;
  const pricing = Array.isArray(record['pricing'])
    ? (record['pricing'] as PickedPrice[])
    : undefined;
  const prices =
    (record['prices'] as Price[] | undefined) ??
    pricing?.map(({ source, interval, intervalCount, autoRenew }) => ({
      ...source,
      interval,
      intervalCount,
      autoRenew,
      lastVerified: '2026-10-21',
    }));
  return [
    ...(pricing && prices ? [{ prices, pricing }] : []),
    ...Object.values(record).flatMap(pricedIn),
  ];
}

/** A picked price the way the API writes it: amounts to 2 decimals and the rate to 4 (PROJECT-PLAN §3.1). */
function asApiWritesIt(picked: PickedPrice): PickedPrice {
  const round = (value: number, decimals: number) =>
    Math.round(value * 10 ** decimals) / 10 ** decimals;
  return {
    ...picked,
    amount: round(picked.amount, 2),
    monthlyEquivalent: round(picked.monthlyEquivalent, 2),
    ...(picked.fx && { fx: { ...picked.fx, rate: round(picked.fx.rate, 4) } }),
  };
}

describe('the picked pricing in the examples', () => {
  const fx = contract.endpoints['GET /fx'].examples[0].response.body.data as FxRates;
  const examples = Object.entries(
    contract.endpoints as unknown as Record<
      string,
      { examples: { title: string; response: { body: unknown } }[] }
    >,
  ).flatMap(([endpoint, { examples }]) =>
    examples.flatMap(({ title, response }) => {
      const meta = (response.body as { meta?: Record<string, unknown> } | null)?.meta ?? {};
      const query = (meta['query'] ?? {}) as Record<string, unknown>;
      const region = meta['region'] ?? query['region'];
      const currency = meta['currency'] ?? query['currency'];
      return typeof region === 'string' && typeof currency === 'string'
        ? pricedIn(response.body).map(
            ({ prices, pricing }, index): [string, string, string, Price[], PickedPrice[]] => [
              `${endpoint} "${title}" #${index}`,
              region,
              currency,
              prices,
              pricing,
            ],
          )
        : [];
    }),
  );

  it('covers every endpoint that picks prices', () => {
    expect(new Set(examples.map(([name]) => name.split(' "')[0]))).toEqual(
      new Set(['GET /providers', 'GET /providers/:id', 'GET /plans/:id', 'GET /bundles']),
    );
  });

  it.each(examples)('%s is what pickPrice gives', (_name, region, currency, prices, pricing) => {
    expect(toSource(pricing, [])).toEqual(
      pickPrice(prices, { region, currency, fx }).map(asApiWritesIt),
    );
  });
});

interface ExampleFile {
  endpoints: Record<
    string,
    { phase?: number; examples: { title: string; response: { status: number; body: unknown } }[] }
  >;
  errorCodes: { code: string; status: number }[];
}

describe('every example, against the response schemas', () => {
  const file = contract as unknown as ExampleFile;
  const responses = Object.entries(file.endpoints).flatMap(([endpoint, { phase, examples }]) =>
    examples.map(({ title, response }) => ({
      name: `${endpoint} "${title}"`,
      endpoint,
      built: phase === undefined,
      status: response.status,
      body: toSource(response.body, []),
    })),
  );
  const errors = responses.filter((response) => response.status >= 400);
  const successes = responses.filter((response) => response.built && response.status < 400);

  it.each(errors.map((response) => [response.name, response] as const))(
    "%s is the error envelope, with its code's status",
    (_name, { status, body }) => {
      expect(issues(errorBodySchema, body)).toEqual([]);
      expect(errorStatuses[(body as ErrorBody).error.code]).toBe(status);
    },
  );

  it.each(successes.map((response) => [response.name, response] as const))(
    "%s is its endpoint's success body",
    (_name, { endpoint, status, body }) => {
      const schema = successBodySchemas[endpoint as keyof typeof successBodySchemas];
      if (status === 304 || schema === pngBody) {
        expect(body).toBeNull();
      } else {
        expect(issues(schema, body)).toEqual([]);
      }
    },
  );

  it('has a schema for every built endpoint, and none yet for the Phase 5 ones', () => {
    const built = Object.entries(file.endpoints)
      .filter(([, { phase }]) => phase === undefined)
      .map(([endpoint]) => endpoint);

    expect(Object.keys(successBodySchemas).sort()).toEqual(built.sort());
    expect(successes.length).toBeGreaterThan(built.length);
  });

  it("knows the same error codes and statuses as the examples' errorCodes", () => {
    expect(Object.fromEntries(file.errorCodes.map(({ code, status }) => [code, status]))).toEqual(
      errorStatuses,
    );
  });
});

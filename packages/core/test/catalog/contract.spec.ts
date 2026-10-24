import { describe, expect, it } from 'vitest';
import contract from '../../../../docs/api-output-examples.json';
import {
  bundleSchema,
  catalogSnapshotSchema,
  categoriesFileSchema,
  featuresFileSchema,
  providerSchema,
} from '../../src';
import { issues } from './helpers';

// The YAML source files must stay compatible with the API contract: each catalog object in the examples, minus
// what the build and the API add (icon URLs, picked pricing, expanded bundle plans, savings, feature unions),
// is a valid source file. The GET /catalog body is the snapshot that scripts/build-catalog.ts writes (M1.5);
// the other response schemas come in M2.7.

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

const catalog = dataOf(contract.endpoints['GET /catalog'].examples[0].response.body);
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
    const [bundle] = contract.endpoints['GET /bundles'].examples[0].response.body.data;
    const source = {
      ...(toSource(bundle, ['pricing', 'savings', 'features', 'includes']) as object),
      includes: bundle.includes.map((included) => included.planId),
    };
    expect(issues(bundleSchema, source)).toEqual([]);
  });
});

describe('the GET /catalog example', () => {
  it('is a catalog snapshot, once the documentation notes are gone', () => {
    const body = contract.endpoints['GET /catalog'].examples[0].response.body;
    expect(issues(catalogSnapshotSchema, toSource(body, []))).toEqual([]);
  });
});

import * as z from 'zod';
import { bankOfCanadaFileSchema } from './bank-of-canada';
import { bundleSchema } from './bundle';
import { categoriesFileSchema } from './category';
import { featuresFileSchema } from './feature';
import { policySetSchema } from './policy';
import { policyTopicsFileSchema } from './policy-topic';
import { automationSchema } from '../pipeline/automation';
import { queueFileSchema } from '../pipeline/queue';
import { providerSchema } from './provider';
import { ratersFileSchema } from './rater';
import { redirectsFileSchema } from './redirects';
import { resellersFileSchema } from './reseller';

function toJsonSchema(schema: z.ZodType) {
  // The input side, since that's what people type into the YAML files.
  return z.toJSONSchema(schema, { io: 'input' });
}

/**
 * The JSON Schema of each kind of catalog file, for autocomplete and validation in the editor.
 * scripts/generate-json-schema.ts writes them to data/schema/<kind>.schema.json. They cover the shapes and
 * formats; the cross-field checks (duplicate ids, id prefixes, tier min ≤ max) only run in Zod.
 */
export function catalogJsonSchemas() {
  return {
    features: toJsonSchema(featuresFileSchema),
    categories: toJsonSchema(categoriesFileSchema),
    provider: toJsonSchema(providerSchema),
    bundle: toJsonSchema(bundleSchema),
    resellers: toJsonSchema(resellersFileSchema),
    'policy-topics': toJsonSchema(policyTopicsFileSchema),
    'policy-set': toJsonSchema(policySetSchema),
    queue: toJsonSchema(queueFileSchema),
    automation: toJsonSchema(automationSchema),
    redirects: toJsonSchema(redirectsFileSchema),
    raters: toJsonSchema(ratersFileSchema),
    'bank-of-canada': toJsonSchema(bankOfCanadaFileSchema),
  };
}
export type CatalogFileKind = keyof ReturnType<typeof catalogJsonSchemas>;

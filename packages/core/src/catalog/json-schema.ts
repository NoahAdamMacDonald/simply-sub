import * as z from 'zod';
import { bundleSchema } from './bundle';
import { categoriesFileSchema } from './category';
import { featuresFileSchema } from './feature';
import { providerSchema } from './provider';
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
  };
}
export type CatalogFileKind = keyof ReturnType<typeof catalogJsonSchemas>;

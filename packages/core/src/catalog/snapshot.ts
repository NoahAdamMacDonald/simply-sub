import * as z from 'zod';
import { bundleSchema, type Bundle } from './bundle';
import { categoriesFileSchema, type Categories } from './category';
import { featuresFileSchema, type Feature } from './feature';
import { httpsUrlSchema, regionSchema } from './formats';
import { providerSchema, type Provider } from './provider';
import { resellerSchema, resellersFileSchema, type Reseller } from './reseller';
import { locateCatalogFile, type CatalogSourceFile } from './validate-catalog';

// The catalog snapshot (BLUEPRINT §5.2, §6.3): the body of GET /catalog, which is also published byte for byte
// as the static file data/catalog.json that the app reads. scripts/build-catalog.ts builds it from data/. These
// are output schemas: the source shapes plus what the build adds.

export const catalogSchemaVersion = 1;

/**
 * The most pixels a published provider icon is wide: the app shows icons at up to 48 px, so this covers screens
 * with twice the pixel density. data:build converts each logo in data/logos/ to a WebP this size (BLUEPRINT §6.3).
 */
export const catalogIconSize = 96;

/** The file a provider's or reseller's icon is published as, under /icons/. Their ids never clash. */
export function catalogIconFile(id: string): string {
  return `${id}.webp`;
}

/** A published icon's URL, as the snapshot gives it. */
const iconUrlSchema = httpsUrlSchema
  .describe(
    "Its icon, a WebP of at most 96 pixels under /icons/. Left out when there's no logo: the app shows a letter",
  )
  .optional();

export const snapshotProviderSchema = providerSchema.safeExtend({ iconUrl: iconUrlSchema });
export type SnapshotProvider = z.infer<typeof snapshotProviderSchema>;

export const snapshotResellerSchema = resellerSchema.safeExtend({ iconUrl: iconUrlSchema });
export type SnapshotReseller = z.infer<typeof snapshotResellerSchema>;

export const catalogDataSchema = z.strictObject({
  schemaVersion: z.literal(catalogSchemaVersion),
  features: featuresFileSchema,
  categories: categoriesFileSchema,
  providers: z.array(snapshotProviderSchema),
  bundles: z.array(bundleSchema),
  resellers: z
    .array(snapshotResellerSchema)
    .describe(
      "data/resellers.yaml: the shops that providers' resellers sections name (BLUEPRINT §4.9)",
    ),
});
export type CatalogData = z.infer<typeof catalogDataSchema>;

const countSchema = z.int().nonnegative();

export const catalogMetaSchema = z.strictObject({
  catalogVersion: z
    .string()
    .regex(/^[0-9a-f]{7}$/, 'Use 7 lowercase hex digits')
    .describe("The start of a SHA-256 of data's JSON: it changes only when the catalog does"),
  generatedAt: z.iso.datetime().describe('When the snapshot was built, in UTC'),
  region: regionSchema
    .describe(
      'In a region file (data/catalog/<region>.json), the region whose prices it keeps. The full snapshot has none',
    )
    .optional(),
  regions: z
    .array(regionSchema)
    .describe(
      "Every region with a price in the catalog, sorted: the full catalog's, even in a region file",
    ),
  counts: z.strictObject({
    providers: countSchema,
    plans: countSchema,
    addOns: countSchema,
    bundles: countSchema,
    features: countSchema,
  }),
});
export type CatalogMeta = z.infer<typeof catalogMetaSchema>;

export const catalogSnapshotSchema = z.strictObject({
  data: catalogDataSchema,
  meta: catalogMetaSchema,
});
export type CatalogSnapshot = z.infer<typeof catalogSnapshotSchema>;

/** The catalog files, parsed. */
export interface CatalogSource {
  features: Feature[];
  categories: Categories;
  providers: Provider[];
  bundles: Bundle[];
  /** data/resellers.yaml's, or none without the file. */
  resellers: Reseller[];
  /** Provider or reseller id → its logo, a PNG from data/logos/. */
  logos: ReadonlyMap<string, Uint8Array>;
}

/**
 * Parses the catalog files with their schemas, for a catalog that validateCatalog found no errors in: it throws
 * on a file that doesn't parse. Providers and bundles are sorted by id, so file order doesn't matter.
 */
export function readCatalogSource(files: readonly CatalogSourceFile[]): CatalogSource {
  let features: Feature[] | undefined;
  let categories: Categories | undefined;
  const providers: Provider[] = [];
  const bundles: Bundle[] = [];
  let resellers: Reseller[] = [];
  const logos = new Map<string, Uint8Array>();
  for (const source of files) {
    const where = locateCatalogFile(source.file);
    switch (where?.kind) {
      case 'logo':
        if ('bytes' in source) {
          logos.set(where.name, source.bytes);
        }
        break;
      case 'features':
        features = parsed(featuresFileSchema, source);
        break;
      case 'categories':
        categories = parsed(categoriesFileSchema, source);
        break;
      case 'provider':
        providers.push(parsed(providerSchema, source));
        break;
      case 'bundle':
        bundles.push(parsed(bundleSchema, source));
        break;
      case 'resellers':
        resellers = parsed(resellersFileSchema, source);
        break;
    }
  }
  if (!features || !categories) {
    throw new Error('data/features.yaml and data/categories.yaml are both needed');
  }
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    features,
    categories,
    providers: providers.sort(byId),
    bundles: bundles.sort(byId),
    resellers: resellers.sort(byId),
    logos,
  };
}

function parsed<T>(schema: z.ZodType<T>, source: CatalogSourceFile): T {
  const result = 'data' in source ? schema.safeParse(source.data) : undefined;
  if (!result?.success) {
    throw new Error(`${source.file} doesn't match its schema: run npm run data:validate`);
  }
  return result.data;
}

/**
 * The snapshot's data: the source files, in a fixed order. A provider or reseller with a logo gets its icon URL; one
 * without has none, and the app shows its first letter.
 */
export function buildCatalogData(source: CatalogSource, iconBaseUrl: string): CatalogData {
  return {
    schemaVersion: catalogSchemaVersion,
    features: source.features,
    categories: source.categories,
    providers: source.providers.map(({ id, name, aliases, website, ...rest }) => ({
      // iconUrl after website, where the API examples put it.
      id,
      name,
      ...(aliases && { aliases }),
      website,
      ...(source.logos.has(id) && { iconUrl: `${iconBaseUrl}${catalogIconFile(id)}` }),
      ...rest,
    })),
    bundles: source.bundles,
    resellers: source.resellers.map(({ id, name, website, ...rest }) => ({
      id,
      name,
      website,
      ...(source.logos.has(id) && { iconUrl: `${iconBaseUrl}${catalogIconFile(id)}` }),
      ...rest,
    })),
  };
}

/** The snapshot's meta. `catalogVersion` is a hash of data's JSON, which the caller computes. */
export function buildCatalogMeta(
  data: CatalogData,
  { catalogVersion, generatedAt }: Pick<CatalogMeta, 'catalogVersion' | 'generatedAt'>,
): CatalogMeta {
  const priced = [
    ...data.providers.flatMap((provider) => [...provider.plans, ...(provider.addOns ?? [])]),
    ...data.bundles,
  ];
  const regions = new Set(priced.flatMap((item) => item.prices.map((price) => price.region)));
  return {
    catalogVersion,
    generatedAt,
    regions: [...regions].sort(),
    counts: {
      providers: data.providers.length,
      plans: data.providers.reduce((sum, provider) => sum + provider.plans.length, 0),
      addOns: data.providers.reduce((sum, provider) => sum + (provider.addOns?.length ?? 0), 0),
      bundles: data.bundles.length,
      features: data.features.length,
    },
  };
}

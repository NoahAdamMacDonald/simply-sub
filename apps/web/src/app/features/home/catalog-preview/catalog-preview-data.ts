// TEMPORARY: the catalog preview on Home reads the hand-written YAML in data/ directly, because catalog.json
// doesn't exist yet (M1.5). Delete this folder, the `yaml` dependency of apps/web and the ".yaml" loader in
// angular.json when work on Home (P2, M7.3) begins.
import {
  bundleSchema,
  categoriesFileSchema,
  featuresFileSchema,
  providerSchema,
  type Bundle,
  type Categories,
  type Feature,
  type Provider,
} from '@simply-sub/core';
import { parse } from 'yaml';
import disneyCravePremium from '../../../../../../../data/bundles/disney-crave-premium.yaml';
import categories from '../../../../../../../data/categories.yaml';
import features from '../../../../../../../data/features.yaml';
import crave from '../../../../../../../data/providers/crave.yaml';
import disneyPlus from '../../../../../../../data/providers/disney-plus.yaml';
import mullvad from '../../../../../../../data/providers/mullvad.yaml';
import netflix from '../../../../../../../data/providers/netflix.yaml';
import proton from '../../../../../../../data/providers/proton.yaml';

// A new catalog file only shows up once it's imported and listed here.
const providerFiles: Record<string, string> = {
  'netflix.yaml': netflix,
  'disney-plus.yaml': disneyPlus,
  'crave.yaml': crave,
  'mullvad.yaml': mullvad,
  'proton.yaml': proton,
};
const bundleFiles: Record<string, string> = {
  'disney-crave-premium.yaml': disneyCravePremium,
};

/** One file: its parsed content when it's valid, and the schema or YAML errors otherwise. */
export interface PreviewFile<T> {
  file: string;
  data?: T;
  issues: string[];
}

export interface PreviewCatalog {
  features: PreviewFile<Feature[]>;
  categories: PreviewFile<Categories>;
  providers: PreviewFile<Provider>[];
  bundles: PreviewFile<Bundle>[];
}

interface Schema<T> {
  safeParse(
    input: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

function load<T>(file: string, text: string, schema: Schema<T>): PreviewFile<T> {
  let input: unknown;
  try {
    input = parse(text);
  } catch (error) {
    return { file, issues: [`YAML: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const result = schema.safeParse(input);
  if (result.success) {
    return { file, data: result.data, issues: [] };
  }
  return {
    file,
    issues: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
  };
}

/** Parses and validates every catalog file the preview knows about. */
export function loadPreviewCatalog(): PreviewCatalog {
  return {
    features: load('features.yaml', features, featuresFileSchema),
    categories: load('categories.yaml', categories, categoriesFileSchema),
    providers: Object.entries(providerFiles).map(([file, text]) =>
      load(file, text, providerSchema),
    ),
    bundles: Object.entries(bundleFiles).map(([file, text]) => load(file, text, bundleSchema)),
  };
}

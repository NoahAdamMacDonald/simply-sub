import * as z from 'zod';
import { httpsUrlSchema, slugSchema } from './formats';
import { policiesSchema, policySetSchema, type PolicySet } from './policy';
import type { Provider } from './provider';

// Terms and policies in a file per provider (M11.8, BLUEPRINT §4.10, §6.3): the quotes are most of a provider's
// catalog data, so they're out of catalog.json, the region files and D1, and the card loads a provider's when its Terms
// and policies opens. data:build writes /data/policies/<provider id>.json for each provider that rates its policies,
// /data/policies/shared/<id>.json for each shared document, and /data/policies/index.json, which lists the pages each
// one cites, for the nightly check.

/** A provider's policies file: its id and its policies as its file has them. */
export const policyFileSchema = z.strictObject({
  id: slugSchema.describe('The provider whose policies these are'),
  policies: policiesSchema,
});
export type PolicyFile = z.infer<typeof policyFileSchema>;

/** A shared document's file is the document itself. */
export const sharedPolicyFileSchema = policySetSchema;

/** What /data/policies/index.json says of a file: the pages its ratings cite, and a provider's shared documents. */
const policyIndexEntrySchema = z.strictObject({
  links: z.array(httpsUrlSchema),
  shared: z.array(slugSchema).min(1).optional(),
});

/** /data/policies/index.json: every provider's and shared document's file, with the pages it cites. */
export const policyIndexSchema = z.strictObject({
  providers: z.record(slugSchema, policyIndexEntrySchema),
  sets: z.record(slugSchema, policyIndexEntrySchema),
});
export type PolicyIndex = z.infer<typeof policyIndexSchema>;

/** A provider's policies file, under the site's root. */
export function policyFilePath(providerId: string): string {
  return `data/policies/${providerId}.json`;
}

/** A shared document's file, under the site's root: a folder of its own, so its id never meets a provider's. */
export function sharedPolicyFilePath(setId: string): string {
  return `data/policies/shared/${setId}.json`;
}

/** The index's path under the site's root. */
export const policyIndexPath = 'data/policies/index.json';

/** Each provider's policies file, for those that rate theirs, and each shared document's. */
export function policyFiles(source: {
  providers: readonly Pick<Provider, 'id' | 'policies'>[];
  policySets: readonly PolicySet[];
}): {
  providers: PolicyFile[];
  sets: PolicySet[];
} {
  return {
    providers: source.providers.flatMap(({ id, policies }) => (policies ? [{ id, policies }] : [])),
    sets: [...source.policySets],
  };
}

/** The index of the files: each one's pages, and each provider's shared documents. */
export function buildPolicyIndex(files: ReturnType<typeof policyFiles>): PolicyIndex {
  return {
    providers: Object.fromEntries(
      files.providers.map(({ id, policies }) => [
        id,
        {
          links: (policies.links ?? []).map((link) => link.url),
          ...(policies.shared && { shared: policies.shared }),
        },
      ]),
    ),
    sets: Object.fromEntries(
      files.sets.map((set) => [set.id, { links: set.links.map((link) => link.url) }]),
    ),
  };
}

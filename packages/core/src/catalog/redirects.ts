import * as z from 'zod';
import type { IsoDate } from '../dates/iso-date';
import { listedMoreThanOnce } from './checks';
import { bundleIdSchema, isoDateSchema, planIdSchema, rankKeySchema, slugSchema } from './formats';
import type { Plan } from './provider';

// data/redirects.yaml (BLUEPRINT §4.3, M10.27): ids are permanent once published, so this is for the rare id that had
// to change (a feature renamed, M11.4's ad-free; a perk that became a feature, M11.6) and for a retired plan's
// subscribers moved to another plan on a date. The app follows an entry when it resolves an item and rewrites the
// user's records to the new id once; the API answers an old provider or plan id with a redirect.

/** What an entry redirects. Feature and perk entries are rank keys, the rest catalog ids. */
export const redirectKinds = ['provider', 'plan', 'add-on', 'bundle', 'feature', 'perk'] as const;
export type RedirectKind = (typeof redirectKinds)[number];

/** A perk's rank key, `perk:<provider>/<perk>` (M11.6). */
export const perkKeySchema = z
  .string()
  .regex(/^perk:[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    error: 'Use perk:<provider id>/<perk id> (perk:xbox-game-pass/fortnite-crew)',
  });

const idFormats: Record<RedirectKind, z.ZodType<string>> = {
  provider: slugSchema,
  plan: planIdSchema,
  'add-on': planIdSchema,
  bundle: bundleIdSchema,
  feature: rankKeySchema,
  perk: perkKeySchema,
};

export const redirectSchema = z
  .strictObject({
    kind: z
      .enum(redirectKinds)
      .describe(
        'What it redirects: a provider, plan, add-on or bundle id, or a feature or perk rank key (video.quality=4k, perk:xbox-game-pass/fortnite-crew)',
      ),
    from: z.string().describe('The old id: gone from the catalog, or a retired plan or provider'),
    to: z
      .string()
      .describe(
        'The id it points to now, which exists and is still sold. A perk can point to a feature rank key',
      ),
    on: isoDateSchema.describe(
      "The day the id changed, or the day a retired plan's subscribers move to the new one",
    ),
  })
  .superRefine((redirect, ctx) => {
    for (const key of ['from', 'to'] as const) {
      // A perk that became a feature points to the feature's rank key.
      const format =
        key === 'to' && redirect.kind === 'perk' && !redirect.to.startsWith('perk:')
          ? rankKeySchema
          : idFormats[redirect.kind];
      const result = format.safeParse(redirect[key]);
      if (!result.success) {
        ctx.addIssue({
          code: 'custom',
          message: result.error.issues[0]?.message ?? 'Not an id of this kind',
          path: [key],
        });
      }
    }
    if (redirect.from === redirect.to) {
      ctx.addIssue({ code: 'custom', message: 'Points to itself', path: ['to'] });
    }
  });
export type Redirect = z.infer<typeof redirectSchema>;

export const redirectsFileSchema = z
  .array(redirectSchema)
  .superRefine((redirects, ctx) => {
    // One entry per old id: ids and rank keys are separate namespaces.
    const seen = new Set<string>();
    redirects.forEach(({ kind, from }, index) => {
      const key = `${idSpace(kind)} ${from}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: 'custom', message: listedMoreThanOnce(from), path: [index, 'from'] });
      }
      seen.add(key);
    });
  })
  .meta({
    title: 'Simply Sub redirects',
    description:
      "data/redirects.yaml: old id → new id, for an id that had to change or a retired plan's subscribers moved (BLUEPRINT §4.3)",
  });

/** Ids share one namespace (provider, plan, add-on and bundle ids), and rank keys another (features and perks). */
export function idSpace(kind: RedirectKind): 'id' | 'rank key' {
  return kind === 'feature' || kind === 'perk' ? 'rank key' : 'id';
}

/** What `dueRedirects` reads of a catalog. */
export interface RedirectCatalog {
  providers: readonly {
    id: string;
    plans: readonly Pick<Plan, 'id'>[];
    addOns?: readonly { id: string }[];
  }[];
  bundles: readonly { id: string }[];
  redirects?: readonly Redirect[];
}

/**
 * The entries that apply on `today`: each whose `from` is gone from the catalog, and each move of a retired plan or
 * provider (its `from` still there) from its date. A feature or perk entry's `from` is never in the registry, which
 * validation checks.
 */
export function dueRedirects(catalog: RedirectCatalog, today: IsoDate): Redirect[] {
  const ids = new Set<string>([
    ...catalog.providers.flatMap((provider) => [
      provider.id,
      ...provider.plans.map((plan) => plan.id),
      ...(provider.addOns ?? []).map((addOn) => addOn.id),
    ]),
    ...catalog.bundles.map((bundle) => bundle.id),
  ]);
  return (catalog.redirects ?? []).filter(
    (redirect) =>
      idSpace(redirect.kind) === 'rank key' || !ids.has(redirect.from) || redirect.on <= today,
  );
}

/** The ids due entries move, by kind: from → to. */
export type RedirectMap = ReadonlyMap<RedirectKind, ReadonlyMap<string, string>>;

const noRedirects: RedirectMap = new Map();
const dueMaps = new WeakMap<RedirectCatalog, { today: IsoDate; map: RedirectMap }>();

/** redirectMap of dueRedirects, kept per catalog for the day: resolution asks for it once per item. */
export function dueRedirectMap(catalog: RedirectCatalog, today: IsoDate): RedirectMap {
  if (!catalog.redirects) return noRedirects;
  const kept = dueMaps.get(catalog);
  if (kept?.today === today) return kept.map;
  const map = redirectMap(dueRedirects(catalog, today));
  dueMaps.set(catalog, { today, map });
  return map;
}

export function redirectMap(redirects: readonly Redirect[]): RedirectMap {
  const map = new Map<RedirectKind, Map<string, string>>();
  for (const { kind, from, to } of redirects) {
    const forKind = map.get(kind) ?? new Map<string, string>();
    forKind.set(from, to);
    map.set(kind, forKind);
  }
  return map;
}

/** The id `id` of `kind` is now, or itself. Entries never chain (validation), so one step is all there is. */
export function redirected(
  map: RedirectMap,
  kind: Exclude<RedirectKind, 'feature' | 'perk'>,
  id: string,
): string {
  return map.get(kind)?.get(id) ?? id;
}

/**
 * The rank key `key` is now, or itself: a feature entry moves its own key, and an entry from a feature id moves the
 * keys of its values and tiers with it (`video.res=4k` → `video.quality=4k`); a perk entry moves its key; a provider
 * entry moves the keys of its perks (`perk:<old>/…`).
 */
export function redirectedRankKey(map: RedirectMap, key: string): string {
  for (const kind of ['feature', 'perk'] as const) {
    const exact = map.get(kind)?.get(key);
    if (exact !== undefined) return exact;
  }
  const equals = key.indexOf('=');
  if (equals > 0) {
    const to = map.get('feature')?.get(key.slice(0, equals));
    if (to !== undefined && !to.includes('=')) return `${to}${key.slice(equals)}`;
  }
  const perk = /^perk:([^/]+)\/(.+)$/.exec(key);
  const provider = perk && map.get('provider')?.get(perk[1]);
  return provider ? `perk:${provider}/${perk[2]}` : key;
}

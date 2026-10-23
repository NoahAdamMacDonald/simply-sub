import { z } from 'zod';

// String formats shared by every catalog file. Zod reports `message` when data is validated, and the generated
// JSON Schema carries the same text as `patternErrorMessage`, which the VS Code YAML extension shows in place of
// the raw regex.

function pattern(regex: RegExp, message: string) {
  return z
    .string({
      // A value of the wrong type (an unquoted `id: 1` in YAML) gets the format message too. A missing key
      // keeps Zod's default.
      error: (issue) => (issue.input === undefined ? undefined : message),
    })
    .regex(regex, message)
    .meta({ patternErrorMessage: message });
}

const slug = '[a-z0-9]+(?:-[a-z0-9]+)*';

/** One kebab-case segment: `netflix`, `disney-plus`, `streaming`, `480p`. */
export const slugSchema = pattern(
  new RegExp(`^${slug}$`),
  'Use a kebab-case id: lowercase letters and digits, joined by single hyphens (disney-plus)',
);

/** Kebab-case segments joined by dots: `video.quality`, `password-manager.item-types`, `proton.pass-plus`. */
export const dottedSlugSchema = pattern(
  new RegExp(`^${slug}(?:\\.${slug})*$`),
  'Use kebab-case segments joined by dots (video.quality, password-manager.item-types)',
);

/** A plan or add-on id: the provider id, a dot, then the plan's own slug (`netflix.standard`). */
export const planIdSchema = pattern(
  new RegExp(`^${slug}(?:\\.${slug})+$`),
  'Use <provider id>.<slug> (netflix.standard)',
);

/** A bundle id: `bundle.` and a slug (`bundle.disney-crave-premium`). */
export const bundleIdSchema = pattern(
  new RegExp(`^bundle\\.${slug}$`),
  'Use bundle.<slug> (bundle.disney-crave-premium)',
);

/** A number tier id: a slug that may end in `+` (`1`, `2-4`, `5+`). */
export const tierIdSchema = pattern(
  new RegExp(`^${slug}\\+?$`),
  'Use a tier id such as 1, 2-4 or 5+ (in YAML, quote ids that are plain numbers: "1")',
);

/** `<featureId>` or `<featureId>=<value or tier id>` (PROJECT-PLAN.md §3.2). */
export const rankKeySchema = pattern(
  new RegExp(`^${slug}(?:\\.${slug})*(?:=${slug}\\+?)?$`),
  'Use a feature id or <feature id>=<value or tier id> (video.quality=4k)',
);

/** ISO 3166-1 alpha-2, or `GLOBAL` for one worldwide price. */
export const regionSchema = pattern(
  /^(?:[A-Z]{2}|GLOBAL)$/,
  'Use a two-letter ISO 3166-1 region in capitals (CA, US) or GLOBAL',
);

/** ISO 4217 currency code. */
export const currencySchema = pattern(
  /^[A-Z]{3}$/,
  'Use a three-letter ISO 4217 currency code in capitals (CAD)',
);

/** A calendar date, `YYYY-MM-DD`. */
export const isoDateSchema = z.iso
  .date('Use a real date written YYYY-MM-DD')
  .meta({ patternErrorMessage: 'Use a real date written YYYY-MM-DD' });

/** An absolute `https://` URL on a public domain name. */
export const httpsUrlSchema = z
  .url({ protocol: /^https$/, hostname: z.regexes.domain, error: 'Use a full https:// URL' })
  // JSON Schema's `format: uri` allows any scheme, so the editor also gets the https check as a pattern.
  .meta({ pattern: '^https://', patternErrorMessage: 'Use a full https:// URL' });

/** A Material Symbols icon name (`live_tv`). */
export const iconNameSchema = pattern(/^[a-z0-9_]+$/, 'Use a Material Symbols icon name (live_tv)');

/** Text shown to people: names, notes, perks, labels. */
export const textSchema = z.string().trim().min(1, 'Must not be empty');

/** Other wording people use for the same thing, matched by search and the AI drafting pipeline. */
export const aliasesSchema = z
  .array(textSchema)
  .min(1, 'Leave aliases out instead of listing none')
  .describe('Other names people or providers use for this, matched by search');

// Zod compiles its parsers with `new Function` when it can, and finds out by trying, which the strict CSP's Trusted
// Types report as a violation (apps/api/public/_headers). Parsing without it is fast enough for the catalog. Zod reads
// its settings from this global, so setting it here, before any Zod code loads, keeps Zod out of the first bundle.
// zod-setup.spec.ts checks that Zod still reads it.
// Zod keeps the object it finds there, so the flag goes on that object, whichever of the two loads first.
const zod = globalThis as { __zod_globalConfig?: { jitless?: boolean } };
(zod.__zod_globalConfig ??= {}).jitless = true;

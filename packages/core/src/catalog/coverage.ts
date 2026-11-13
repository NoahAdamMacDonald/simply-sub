import { names, providerAvailability, soldRegions } from './availability';
import type { Plan, Provider } from './provider';
import { countryOf, globalRegion, groupsOf, isSubdivision } from './regions';

// Regional coverage (M11.7, the guide's §3.2): where a provider is sold and which of its paid plans have no price
// there, so a region left unread shows. Claude's paid plans had US prices only until M10.17, and a Canadian with Sold
// in on saw only Free. `npm run data:coverage` prints the gaps; a gap its provider file explains, in a "Coverage:"
// note of its own, passes.

/**
 * The regions research covers for a provider whose plans are priced for everywhere (GLOBAL): Canada's and the US's,
 * where the catalog's users are (the guide's §3.2).
 */
export const researchRegions: readonly string[] = ['CA', 'US'];

/**
 * Why a region counts for a provider: its plans are priced there, its availableIn lists it, it sells everywhere, or
 * it's Canada or the US, where whether it's sold is unknown (`home`).
 */
export type CoverageReason = 'priced' | 'available' | 'global' | 'home';

export interface CoverageGap {
  provider: string;
  plan: string;
  region: string;
  why: CoverageReason;
}

/**
 * The regions a provider is sold in, for coverage, each with why: every region (or group) its plans have a price
 * still sold in, its `availableIn`, and the research regions when a plan is priced for everywhere.
 */
export function coverageRegions(
  provider: Pick<Provider, 'plans' | 'availableIn'>,
): Map<string, CoverageReason> {
  const regions = new Map<string, CoverageReason>();
  const prices = provider.plans
    .filter((plan) => plan.retired === undefined)
    .flatMap((plan) => plan.prices.filter((price) => price.retired === undefined));
  for (const price of prices) {
    if (price.region !== globalRegion) regions.set(price.region, 'priced');
  }
  for (const region of provider.availableIn ?? []) {
    if (!regions.has(region)) regions.set(region, 'available');
  }
  if (prices.some((price) => price.region === globalRegion)) {
    for (const region of researchRegions) if (!regions.has(region)) regions.set(region, 'global');
  }
  return regions;
}

/**
 * Whether a plan has a price still sold for a buyer in `region`: its own, its country's or a group's it's in, or
 * everywhere's; for a country, one of its provinces' too (M11.17: a plan sold in some provinces is sold in it).
 */
function pricedIn(plan: Pick<Plan, 'prices'>, region: string): boolean {
  const places = new Set([region, ...groupsOf(region), globalRegion]);
  return plan.prices.some(
    (price) =>
      price.retired === undefined &&
      (places.has(price.region) ||
        (!isSubdivision(region) &&
          isSubdivision(price.region) &&
          countryOf(price.region) === region)),
  );
}

/**
 * Every region a provider is sold in where one of its paid plans still sold has no price: plans priced in some of its
 * regions and not others, and paid plans with no price where it sells. A free plan (every price 0) has none to give,
 * and a region a plan's notSoldIn names isn't a gap (M11.20). Its soldIn closes none: the price is still missing.
 */
export function coverageGaps(providers: readonly Provider[]): CoverageGap[] {
  return providers.flatMap((provider) => {
    if (provider.retired !== undefined) return [];
    const regions = coverageRegions(provider);
    const plans = provider.plans
      .filter((plan) => plan.retired === undefined && plan.prices.some((price) => price.amount > 0))
      .flatMap((plan) =>
        [...regions]
          .filter(
            ([region]) => !pricedIn(plan, region) && !names(soldRegions(plan.notSoldIn), region),
          )
          .map(([region, why]) => ({ provider: provider.id, plan: plan.id, region, why })),
      );
    return [...plans, ...unknownAtHome(provider)];
  });
}

/**
 * Canada and the US, where the catalog's users are, when whether the provider is sold there is unknown: no price
 * there and no availableIn. Search's Sold in hides it there, so a provider sold in Canada vanished for Canadians
 * (Mixcloud, 2026-11-10). The fix is a price there, or availableIn from an official list when it isn't sold there.
 */
function unknownAtHome(provider: Provider): CoverageGap[] {
  return researchRegions
    .filter((region) => providerAvailability(provider, region) === 'unknown')
    .map((region) => ({ provider: provider.id, plan: `${provider.id}.*`, region, why: 'home' }));
}

/** A "Coverage:" note in a provider file: its words, for the gaps it explains. */
export interface CoverageNote {
  text: string;
}

/**
 * The "Coverage:" notes of a provider file's text: each a comment block of its own (comment lines from one starting
 * "# Coverage:" up to a blank line or YAML), its lines joined.
 */
export function coverageNotes(fileText: string): CoverageNote[] {
  const notes: CoverageNote[] = [];
  let current: string[] | undefined;
  for (const line of fileText.split('\n')) {
    const comment = /^\s*#\s?(.*)$/.exec(line);
    if (comment && /^Coverage:/.test(comment[1])) {
      if (current) notes.push({ text: current.join(' ') });
      current = [comment[1]];
    } else if (comment && current) {
      current.push(comment[1]);
    } else if (current) {
      notes.push({ text: current.join(' ') });
      current = undefined;
    }
  }
  if (current) notes.push({ text: current.join(' ') });
  return notes;
}

/**
 * Whether a note explains a gap: it names the plan's id, or `<provider>.*` for every plan, and the region's code as
 * a word ("Coverage: netflix.standard-ads isn't sold in NZ, IE or NL: …").
 */
export function explains(note: CoverageNote, gap: Pick<CoverageGap, 'plan' | 'region'>): boolean {
  const provider = gap.plan.slice(0, gap.plan.indexOf('.'));
  const word = (text: string) =>
    new RegExp(`(?<![\\w.-])${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(
      note.text,
    );
  return (word(gap.plan) || note.text.includes(`${provider}.*`)) && word(gap.region);
}

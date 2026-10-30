import { availability } from '../catalog/availability';
import { planCategories } from '../catalog/plan-categories';
import { pickPrice, type PickedPrice } from '../catalog/pick-price';
import { isRetired } from '../catalog/retired';
import type { IsoDate } from '../dates/iso-date';
import { samePeriod } from '../dates/period';
import { providedKeys, type RankKey } from '../ranking/rank-keys';
import { next12Range } from '../schedule/list-metrics';
import { itemTitle } from '../user/item-text';
import type { OptimizerInput } from './model';

// Before an item's plan ends for its subscribers (its `endsOn`, BLUEPRINT §4.3, M10.27), Optimizations lists the plans
// that would keep what the user can't lose: every key the item ranks Needed or above, from the same provider when one is
// Critical, in one of the item's service categories. Only plans still sold where the item was bought, cheapest per month
// first. It's not a saving, so it's a list
// above the suggestions, not a suggestion: the user picks one in Search.

/** The most plans listed for one item. */
export const maxReplacements = 3;

/** A plan that keeps an ending item's Needed keys, priced for the user. */
export interface ReplacementPlan {
  providerId: string;
  planId: string;
  /** "Anthropic", "Max". */
  name: string;
  planName: string;
  /** For the item's billing period when it's sold that way, else its shortest. */
  price: PickedPrice;
}

/** An item whose plan ends within the next 12 months, and the plans that would keep its Needed keys. */
export interface Replacement {
  itemId: string;
  /** itemTitle: "Claude Max", "Mom's (Claude Max)". */
  title: string;
  endsOn: IsoDate;
  /** The keys it ranks Needed, Critical or Essential, which each plan provides. */
  keys: RankKey[];
  plans: ReplacementPlan[];
}

const kept = new Set(['essential', 'critical', 'needed']);

/** The list's items whose plans end within the next 12 months, each with up to three plans to move to. */
export function replacements(
  input: Pick<OptimizerInput, 'items' | 'catalogs' | 'context'>,
): Replacement[] {
  const { context } = input;
  const until = next12Range(context.today).to;
  return input.items.flatMap((resolved): Replacement[] => {
    const endsOn = resolved.planEnds;
    const catalog = input.catalogs.get(resolved.region);
    if (endsOn === undefined || endsOn > until || !catalog) return [];
    const ranked = Object.entries(resolved.effectiveRanks);
    const keys = ranked.filter(([, rank]) => kept.has(rank)).map(([key]) => key);
    const sameProvider = ranked.some(([, rank]) => rank === 'critical');
    const plans = catalog.providers
      .filter((provider) => !sameProvider || provider.id === resolved.providerId)
      .flatMap((provider) =>
        provider.plans.flatMap((plan): ReplacementPlan[] => {
          if (plan.id === resolved.planId || isRetired(plan, provider, context.today)) return [];
          if (availability(plan.prices, provider, resolved.region) === 'not-offered') return [];
          const categories = planCategories(plan, provider);
          if (!resolved.categories.some((id) => categories.includes(id))) return [];
          const provided = providedKeys(plan.features, catalog.features);
          if (!keys.every((key) => provided.includes(key))) return [];
          const picked = pickPrice(plan.prices, {
            region: resolved.region,
            currency: context.currency,
            ...(provider.billingCurrency && { billingCurrency: provider.billingCurrency }),
            ...(context.fx && { fx: context.fx }),
          });
          const price = picked.find((own) => samePeriod(own, resolved.item.billing)) ?? picked[0];
          return price
            ? [
                {
                  providerId: provider.id,
                  planId: plan.id,
                  name: provider.name,
                  planName: plan.name,
                  price,
                },
              ]
            : [];
        }),
      )
      .sort((a, b) => a.price.monthlyEquivalent - b.price.monthlyEquivalent)
      .slice(0, maxReplacements);
    return [{ itemId: resolved.item.id, title: itemTitle(resolved), endsOn, keys, plans }];
  });
}

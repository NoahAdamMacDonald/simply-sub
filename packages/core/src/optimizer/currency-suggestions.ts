import { planOf } from '../catalog/plan-lookup';
import type { Price } from '../catalog/price';
import { globalRegion, groupsOf } from '../catalog/regions';
import type { CatalogData } from '../catalog/snapshot';
import { samePeriod } from '../dates/period';
import { itemLedger, itemOnCard } from '../rewards/card-ledger';
import { cardTitle } from '../user/card-rules';
import type { ResolvedItem } from '../user/resolved';
import type { CardRoom } from './card-suggestions';
import { fingerprintOf } from './fingerprint';
import { resolveChanged, savingEpsilon, type OptimizerInput, type OptimizerModel } from './model';
import type { Suggestion } from './suggestion';

// The optimizer's 8th change (BLUEPRINT §10.3, M9.6): paying for an item in another currency its seller prices it in
// for the buyer, which loses nothing, so it's a free saving. Only a price list the buyer picks from counts: the other
// currencies of the region its price comes from, when that's where it's bought, a group of it, or GLOBAL (Proton's
// USD, CAD, EUR and CHF). Another country's price is set by where the buyer is, so it never counts. What a currency
// costs is what it comes to on the card the item is paid with, after its FX fee and cash back (§9.3), so it needs the
// card: one with no FX fee can make another price list the cheaper one. The change is the user's own price in that
// currency from the item's next charge (BLUEPRINT §4.3's "I pay a different price"), as they'd record it themselves.
// An item that keeps an own price, has add-ons (an own price covers them), or that another free change already changes
// (a better card, annual billing) is left alone: once that's applied, the next run judges it again. On the same card,
// a cheaper currency posts less in every month, so it never needs room the card doesn't have.

export function currencySuggestions(
  model: OptimizerModel,
  input: Pick<OptimizerInput, 'catalogs' | 'context'>,
  room: CardRoom,
  changed: ReadonlySet<string>,
  list: string,
): Suggestion[] {
  const { context } = input;
  return model.items.flatMap((item): Suggestion[] => {
    const { resolved } = item;
    const card = room.byId.get(resolved.item.cardId ?? '');
    const on = item.next;
    const catalog = input.catalogs.get(resolved.region);
    if (!card || on === undefined || !item.changeable || !catalog) return [];
    if (changed.has(resolved.item.id) || resolved.addOns.length > 0) return [];
    const own = resolved.item.priceOverride;
    if (own && (own.until === undefined || own.until > context.today)) return [];
    const now = itemOnCard(room.ledgers[item.index], card, context);
    if (now.leftOut > 0 || now.gross <= 0) return [];
    const [best] = choosablePrices(resolved, catalog)
      .flatMap((price) => {
        const paid = resolveChanged(
          {
            ...resolved.item,
            priceOverride: {
              amount: price.amount,
              currency: price.currency,
              since: on,
              ...(price.taxIncluded === undefined && { plusTax: true }),
            },
          },
          catalog,
          context,
        );
        const to = paid?.overridePrice;
        if (!paid || !to) return [];
        return [{ to, onCard: itemOnCard(itemLedger(paid, context), card, context) }];
      })
      .filter(({ onCard }) => onCard.leftOut === 0 && now.net - onCard.net >= savingEpsilon)
      .sort((a, b) => a.onCard.net - b.onCard.net);
    if (!best) return [];
    const savings = now.net - best.onCard.net;
    const next12 = model.baseline - savings;
    return [
      {
        fingerprint: fingerprintOf(
          list,
          `currency ${resolved.item.id} ${resolved.price.source.currency} ${best.to.source.currency} ${card.id}`,
        ),
        severity: 'free',
        actions: [
          { kind: 'currency', item: item.suggested, to: best.to, on, cardTitle: cardTitle(card) },
        ],
        savings,
        next12,
        monthly: next12 / 12,
        estimated: now.converted || best.onCard.converted,
        lost: [],
        lostServices: [],
        gained: [],
      },
    ];
  });
}

/**
 * The other currencies the buyer can pick for the item's plan or bundle, for its billing period: those of the region
 * its price comes from, when that's where it's bought, a group of it, or GLOBAL. A price that's a fallback from
 * elsewhere (pickPrice's rules 2 and 4) has none.
 */
function choosablePrices(resolved: ResolvedItem, catalog: CatalogData): Price[] {
  const { source } = resolved.price;
  if (![resolved.region, ...groupsOf(resolved.region), globalRegion].includes(source.region)) {
    return [];
  }
  const prices =
    resolved.planId !== undefined
      ? planOf(catalog, resolved.planId)?.plan.prices
      : catalog.bundles.find((bundle) => bundle.id === resolved.bundleId)?.prices;
  return (prices ?? []).filter(
    (price) =>
      price.region === source.region &&
      price.currency !== source.currency &&
      price.amount > 0 &&
      samePeriod(price, resolved.item.billing),
  );
}

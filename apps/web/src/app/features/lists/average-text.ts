import { monthlyAverage, type ResolvedItem } from '@simply-sub/core';
import type { ShownAndSpoken } from '../../shared/charge-text';
import { amountText } from '../../shared/price-tag/price-text';

export type { ShownAndSpoken } from '../../shared/charge-text';

/**
 * What a list costs per month on average, before tax (§3.1's monthly equivalents, core's monthlyAverage), with ≈ when
 * a price was converted, and how many items it can't count: one it can't price, or one priced in another currency for
 * want of a rate. The list editor's footer (P5) and the Lists overview's cards (P3) say it.
 */
export function averageText(
  { resolved, unresolved }: { resolved: readonly ResolvedItem[]; unresolved: readonly unknown[] },
  settings: { currency: string; country: string },
): ShownAndSpoken {
  const unpriced = unresolved.length;
  const average = monthlyAverage(resolved, settings.currency);
  const amount = amountText(average.amount, settings.currency, settings.country);
  const notCounted = unpriced + average.leftOut;
  return {
    shown:
      `${average.approx ? '≈ ' : ''}${amount} / mo average` +
      (notCounted > 0 ? ` (${notCounted} not counted)` : ''),
    spoken:
      `${average.approx ? 'about ' : ''}${amount} a month on average` +
      (notCounted > 0 ? `, ${notCounted} not counted` : ''),
  };
}

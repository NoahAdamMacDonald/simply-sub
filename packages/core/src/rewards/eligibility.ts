import type { PaymentCard } from '../user/payment-card';
import type { ResolvedItem } from '../user/resolved';

// Which cards can pay for a subscription (BLUEPRINT §9.3): a card whose network the seller takes where the item is
// bought. Where the seller's networks aren't known, every card can, with an "acceptance not confirmed" hint; the card
// select hides the others, and the assignment and the optimizer never pick them.

/** Whether a card can pay for an item: its network is taken, isn't, or nobody knows. */
export type CardAcceptance = 'accepted' | 'unknown' | 'not-accepted';

export function cardAcceptance(
  card: Pick<PaymentCard, 'network'>,
  resolved: Pick<ResolvedItem, 'acceptedNetworks'>,
): CardAcceptance {
  const networks = resolved.acceptedNetworks;
  if (networks === undefined) return 'unknown';
  return networks.includes(card.network) ? 'accepted' : 'not-accepted';
}

/** A card that can pay for an item, and whether that's confirmed. */
export interface EligibleCard<C> {
  card: C;
  acceptance: 'accepted' | 'unknown';
}

/** The cards that can pay for the item, in `cards`' order. */
export function eligibleCards<C extends Pick<PaymentCard, 'network'>>(
  cards: readonly C[],
  resolved: Pick<ResolvedItem, 'acceptedNetworks'>,
): EligibleCard<C>[] {
  return cards.flatMap((card) => {
    const acceptance = cardAcceptance(card, resolved);
    return acceptance === 'not-accepted' ? [] : [{ card, acceptance }];
  });
}

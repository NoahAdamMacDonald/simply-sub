import type { CardNetwork } from './provider';

// The card networks (BLUEPRINT §9): their names, and how a provider's page writes them, so validation can check that a
// region's quotes name its networks, and the nightly check can find a network a page names that the catalog doesn't
// list. This file imports no Zod, so the Payment page and the bot can use it without loading the schemas.

/** Each network's name, as a card's badge and the card dialog's menu say it. */
export const cardNetworkNames: Readonly<Record<CardNetwork, string>> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  interac: 'Interac',
  unionpay: 'UnionPay',
  jcb: 'JCB',
  other: 'Other',
};

/** The networks in the card dialog's order: cardNetworkNames', with no schema to load. */
export const cardNetworks = Object.keys(cardNetworkNames) as CardNetwork[];

/**
 * How a page writes each network, in English and French: MasterCard or Mastercard, American Express or Amex, UnionPay
 * or Union Pay. `other` stands for any network not listed, so no page names it.
 */
const writtenAs: Readonly<Record<Exclude<CardNetwork, 'other'>, RegExp>> = {
  visa: /\bvisa\b/i,
  mastercard: /\bmaster\s?card\b/i,
  amex: /\bamerican\s+express\b|\bamex\b/i,
  discover: /\bdiscover\b/i,
  interac: /\binterac\b/i,
  unionpay: /\bunion\s?pay\b/i,
  jcb: /\bjcb\b/i,
};

/** Whether `text` names `network`. `other` is never named. */
export function namesNetwork(text: string, network: CardNetwork): boolean {
  return network !== 'other' && writtenAs[network].test(text);
}

/** The networks `text` names, in cardNetworks' order. */
export function networksNamedIn(text: string): CardNetwork[] {
  return cardNetworks.filter((network) => namesNetwork(text, network));
}

import type { Price } from '@simply-sub/core';

// What the nightly check reads and what it finds (BLUEPRINT §6.4). Everything here passes between Workflow steps, so
// it's plain data.

/** Where a price is in its file: a plan's, an add-on's, a reseller's offer of a plan, or a bundle's. */
export type PriceOwner =
  | { kind: 'plan'; id: string }
  | { kind: 'addOn'; id: string }
  | { kind: 'reseller'; reseller: string; plan: string }
  | { kind: 'bundle'; id: string };

/** A stored price the check looks for on its source page. */
export interface PriceTarget {
  /** The repository file it's written in: data/providers/<id>.yaml or data/bundles/<slug>.yaml. */
  file: string;
  owner: PriceOwner;
  price: Price & { sourceUrl: string };
  /** What it's called in the pull request: "Netflix Standard", "Mullvad VPN at Amazon". */
  label: string;
  /** What the page may call it: the plan's name, with and without the provider's. */
  names: string[];
}

/** A reseller's approval: the provider's page that names it, and the words it's named with (BLUEPRINT §4.9). */
export interface ApprovalTarget {
  file: string;
  provider: string;
  reseller: string;
  url: string;
  quotes: string[];
}

/** A region's accepted card networks: the provider's page that names them, and its words (BLUEPRINT §9.3). */
export interface NetworksTarget {
  file: string;
  provider: string;
  /** The region they're for: CA, US, a group or GLOBAL. */
  region: string;
  networks: string[];
  url: string;
  quotes: string[];
}

/** Something the check found, for the pull request. */
export type Finding =
  /** The page shows another regular price: the stored amount changes, flagged when it moves more than 30%. */
  | { kind: 'changed'; target: PriceTarget; amount: number; suspicious: boolean }
  /** The stored price is still on the page. */
  | { kind: 'confirmed'; target: PriceTarget }
  /** A price's taxIncluded quote isn't on its page any more, or the page now says tax is added. */
  | { kind: 'tax'; target: PriceTarget; reason: 'quote-gone' | 'contradicted'; wording?: string }
  /** The provider's page no longer names a reseller: its listing is removed, for review. */
  | { kind: 'reseller'; approval: ApprovalTarget; missing: string[] }
  /**
   * A region's accepted networks: quotes gone from their page take the region's networks out (unknown again, so every
   * card is allowed there), for review; networks the page names beside them that the catalog doesn't list are for
   * review too, since only the page's words can add one.
   */
  | { kind: 'networks'; target: NetworksTarget; missing: string[]; named: string[] }
  /** A provider's or reseller's icon isn't the committed logo any more (a rebrand). */
  | { kind: 'logo'; id: string; png: string; width: number; source: string; replaces: boolean }
  /** Something that couldn't be checked, which a person should look at. */
  | { kind: 'manual'; subject: string; url?: string; reason: string };

/** What a night may still spend, passed from step to step. */
export interface Budget {
  /** Pages Browser Rendering may still open (the free plan has 10 browser-minutes a day). */
  browserPages: number;
  /** Workers AI Neurons it may still use, by estimate (the free plan has 10,000 a day). */
  neurons: number;
}

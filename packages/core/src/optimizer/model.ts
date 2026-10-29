import type { FxRates } from '../catalog/convert';
import { pickPrice, type PickedPrice, type PriceContext } from '../catalog/pick-price';
import { inclusionsOf, planOf } from '../catalog/plan-lookup';
import type { Plan } from '../catalog/provider';
import type { CatalogData, SnapshotProvider } from '../catalog/snapshot';
import type { IsoDate } from '../dates/iso-date';
import { samePeriod, type Period } from '../dates/period';
import { providedKeys, rankKeyLabel, rankKeyOptions, type RankKey } from '../ranking/rank-keys';
import type { ProfileRanks } from '../ranking/resolve-rank';
import type { DateRange } from '../schedule/charge-dates';
import { itemCharges, type Chargeable } from '../schedule/charges';
import { next12Range } from '../schedule/list-metrics';
import type { TaxPlace } from '../tax/sales-tax-rate';
import { keptBillingDay } from '../user/item-form';
import { itemTitle } from '../user/item-text';
import type { ItemSource, ListItem } from '../user/list-item';
import type { CardLoads } from '../rewards/card-limits';
import type { PaymentCard } from '../user/payment-card';
import type { Rank } from '../user/rank';
import { resolveItem, type ResolveContext, type ResolvedItem } from '../user/resolved';
import { activeSlots, slotBounds, slotOf, slotsBefore, slotsFrom } from './coverage';
import type { Severity, SuggestedItem, SuggestionAction } from './suggestion';

// The optimizer's model of a list (BLUEPRINT §10.1, §10.3): each item with the rank keys it provides, the slots it's
// active in and what it costs over the next 12 months, and every way of changing it (its options), each priced with
// the schedule engine (M7.1) and its sales tax. A change takes effect on the item's next charge, so what's paid for
// is used up first. An option of several items (an extra member, a bundle, a suite) decides them together.

/** What the optimizer needs to know about the user. */
export interface OptimizerContext {
  today: IsoDate;
  /** Settings' country and currency, which every amount is in, and the rates that convert prices into it. */
  country: string;
  currency: string;
  fx?: FxRates;
  /** Where the user pays sales tax (Settings' country, province and own rate). */
  place: TaxPlace;
  /** The profile's ranks, for the items a change adds. */
  profileRanks: ProfileRanks;
}

export interface OptimizerInput {
  /** The list's resolved items. Unresolved ones can't be priced, so pages count them apart. */
  items: readonly ResolvedItem[];
  /** The catalog file of each region the items are priced in (ResolvedItem.region), as CatalogStore.catalogFor. */
  catalogs: ReadonlyMap<string, CatalogData>;
  context: OptimizerContext;
  /** The user's payment cards: a better one for an item is a free saving (BLUEPRINT §9.3, §10.3's 7th action, M9.3). */
  cards?: readonly PaymentCard[];
  /**
   * What the items in the other lists post to each card in each of the 12 calendar months from this one (core's
   * cardLoads), so a card's room is what they leave.
   */
  cardLoads?: CardLoads;
}

/** A cost over a range: in the user's currency, whether it includes a converted amount, and any in another currency. */
interface Cost {
  amount: number;
  converted: boolean;
  /** A charge in another currency, for want of a rate: it can't be compared. */
  foreign: boolean;
}

/** What a plan gives, under its provider's number. */
interface Part {
  provider: number;
  keys: number[];
}

/** A rank key a plan gives under a provider, in some slots, and whose person it gives it to. */
export interface Contribution {
  provider: number;
  key: number;
  mask: number;
  /** The items whose own replacement it is: the item itself, or the ones an extra member, bundle or suite replaces. */
  forItems: readonly number[];
}

export interface ItemModel {
  index: number;
  resolved: ResolvedItem;
  /** What it gives as it is: its plan's keys, or each of a bundle's plans' under its provider. */
  parts: Part[];
  /** Its services: a catalog plan's provider, a bundle's plans' providers, or its custom subscription. */
  providers: number[];
  /** The slots it's active in. */
  active: number;
  /** Each key it provides, with its rank for it. */
  ranks: Map<number, Rank>;
  /** Its next charge, when changes take effect, and its slot (12 without one). */
  next?: IsoDate;
  changeSlot: number;
  /** The next 12 months as it is, and the part of it before its next charge. */
  full: Cost;
  before: Cost;
  /** Priced in the user's currency with something to pay, so it can change. */
  changeable: boolean;
  /** Its Essential keys keep its exact plan; its Critical ones keep its provider (BLUEPRINT §10.2). */
  essential: boolean;
  critical: number[];
  /** What losing the service itself costs: yellow, unless every key it provides is Unused or Unwanted. */
  serviceSeverity: Severity;
  suggested: SuggestedItem;
}

export interface OptionModel {
  index: number;
  /** The items it decides, in index order; the first one anchors it in the search. */
  items: number[];
  /** What those items cost over the next 12 months with it. */
  cost: number;
  converted: boolean;
  contributions: Contribution[];
  byKey: Map<number, Contribution[]>;
  /** The items whose service it gives up. */
  removes: number[];
  /** Empty for keeping an item as it is. */
  actions: SuggestionAction[];
  /** The items it adds, resolved: what the features gained come from. */
  added: ResolvedItem[];
  /** Its changes, the same in every run: part of a suggestion's fingerprint. */
  signature: string;
}

export interface OptimizerModel {
  items: ItemModel[];
  options: OptionModel[];
  /** Each item's keep option. */
  keep: number[];
  /** Each item's options of its own, keep first, and the options of several items it's in. */
  own: number[][];
  groups: number[][];
  /** Each key's number → its label. */
  labels: string[];
  keyIds: readonly RankKey[];
  /** The list's next 12 months as it is. */
  baseline: number;
}

/** Less than a cent isn't a saving. */
export const savingEpsilon = 0.005;

/** At most this many items become extra members of one host, or join one bundle or suite. */
const maxGroupSize = 4;

/** Builds the model: every item, and every option the rules allow (§10.2) that costs less than what it replaces. */
export function buildModel(input: OptimizerInput): OptimizerModel {
  return new ModelBuilder(input).build();
}

class ModelBuilder {
  private readonly context: OptimizerContext;
  private readonly bounds: IsoDate[];
  private readonly range: DateRange;
  private readonly keyNumbers = new Map<RankKey, number>();
  private readonly keyIds: RankKey[] = [];
  private readonly labels: string[] = [];
  private readonly providerNumbers = new Map<string, number>();
  private readonly items: ItemModel[] = [];
  private readonly options: OptionModel[] = [];
  private readonly own: number[][] = [];
  private readonly groups: number[][] = [];

  constructor(private readonly input: OptimizerInput) {
    this.context = input.context;
    this.bounds = slotBounds(input.context.today);
    this.range = next12Range(input.context.today);
  }

  build(): OptimizerModel {
    this.input.items.forEach((resolved, index) => this.items.push(this.itemModel(resolved, index)));
    for (const item of this.items) {
      this.own.push([]);
      this.groups.push([]);
      this.addOption([item.index], item.full, this.keepContributions(item), [], [], [], 'keep');
    }
    for (const item of this.items) this.addOwnOptions(item);
    this.addExtraMembers();
    this.addBundles();
    this.addSuites();
    return {
      items: this.items,
      options: this.options,
      keep: this.own.map((options) => options[0]),
      own: this.own,
      groups: this.groups,
      labels: this.labels,
      keyIds: this.keyIds,
      baseline: this.items.reduce((sum, item) => sum + item.full.amount, 0),
    };
  }

  // ── Items ──────────────────────────────────────────────────────────────────────────────────────────────────────

  private itemModel(resolved: ResolvedItem, index: number): ItemModel {
    const catalog = this.input.catalogs.get(resolved.region);
    const parts = this.partsOf(resolved, catalog);
    const ranks = new Map<number, Rank>();
    for (const [key, rank] of Object.entries(resolved.effectiveRanks)) {
      ranks.set(this.key(key, catalog), rank);
    }
    for (const part of parts) {
      for (const key of part.keys) if (!ranks.has(key)) ranks.set(key, 'not-ranked');
    }
    const next = resolved.nextCharge?.date;
    const full = this.cost(resolved, this.range);
    const before =
      next === undefined ? full : this.cost(resolved, { from: this.range.from, to: next });
    const provided = [...ranks.values()];
    return {
      index,
      resolved,
      parts,
      providers: [...new Set(parts.map((part) => part.provider))],
      active: activeSlots(resolved.item.billing, this.bounds),
      ranks,
      ...(next !== undefined && { next }),
      changeSlot: next === undefined ? 12 : slotOf(next, this.bounds),
      full,
      before,
      changeable: catalog !== undefined && next !== undefined && !full.foreign && full.amount > 0,
      essential: provided.includes('essential'),
      critical: [...ranks].filter(([, rank]) => rank === 'critical').map(([key]) => key),
      serviceSeverity:
        provided.length > 0 && provided.every((rank) => rank === 'unwanted')
          ? 'red'
          : provided.length > 0 &&
              provided.every((rank) => rank === 'unwanted' || rank === 'unused')
            ? 'orange'
            : 'yellow',
      suggested: {
        itemId: resolved.item.id,
        title: itemTitle(resolved),
        name: resolved.name,
        planName: resolved.planName,
        price: resolved.override ?? resolved.price,
        ...(next !== undefined && { next }),
      },
    };
  }

  /** What an item gives as it is: a bundle's plans each under its provider, anything else under its own. */
  private partsOf(resolved: ResolvedItem, catalog: CatalogData | undefined): Part[] {
    if (resolved.bundleId !== undefined && catalog) {
      const bundle = catalog.bundles.find((candidate) => candidate.id === resolved.bundleId);
      const plans = (bundle?.includes ?? []).flatMap((planId) => planOf(catalog, planId) ?? []);
      if (plans.length > 0) {
        return plans.map(({ provider, plan }) => ({
          provider: this.provider(provider.id),
          keys: this.keysOf(plan, catalog),
        }));
      }
    }
    const service =
      resolved.providerId ??
      (resolved.customSubId === undefined
        ? `item:${resolved.item.id}`
        : `custom:${resolved.customSubId}`);
    return [
      {
        provider: this.provider(service),
        keys: resolved.providedKeys.map((key) => this.key(key, catalog)),
      },
    ];
  }

  private keepContributions(item: ItemModel): Contribution[] {
    return contributionsOf(item.parts, item.active, [item.index]);
  }

  /** The item's parts up to its next charge: what's paid for already. */
  private paidContributions(item: ItemModel): Contribution[] {
    return contributionsOf(item.parts, item.active & slotsBefore(item.changeSlot), [item.index]);
  }

  // ── Options of one item ────────────────────────────────────────────────────────────────────────────────────────

  private addOwnOptions(item: ItemModel): void {
    if (!item.changeable || item.next === undefined) return;
    const on = item.next;
    if (!item.essential && item.critical.length === 0 && this.removable(item)) {
      this.addOption(
        [item.index],
        item.before,
        this.paidContributions(item),
        [item.index],
        [{ kind: 'remove', item: item.suggested, on }],
        [],
        `remove:${item.resolved.item.id}`,
        item.full.amount,
      );
    }
    const catalog = this.input.catalogs.get(item.resolved.region);
    if (!catalog) return;
    const { item: listItem } = item.resolved;
    const { source } = listItem;
    if (source.kind === 'catalog') {
      const provider = catalog.providers.find(({ id }) => id === item.resolved.providerId);
      const current = provider?.plans.find(({ id }) => id === source.planId);
      if (!provider || !current) return;
      const currentKeys = item.parts[0].keys;
      for (const plan of provider.plans) {
        if (item.essential && plan.id !== current.id) continue;
        const keys = this.keysOf(plan, catalog);
        if (!includesAll(keys, item.critical)) continue;
        for (const price of this.periodsFor(plan.prices, provider, item)) {
          if (plan.id === current.id && samePeriod(price, listItem.billing)) continue;
          const changed = changedItem(
            listItem,
            { kind: 'catalog', planId: plan.id },
            price,
            on,
            plan,
          );
          const resolved = this.resolve(changed, catalog);
          if (!resolved) continue;
          const after = this.cost(resolved, { from: on, to: this.range.to });
          if (after.foreign) continue;
          const kind =
            plan.id === current.id
              ? 'interval'
              : includesAll(currentKeys, keys) && keys.length < currentKeys.length
                ? 'downgrade'
                : 'switch';
          const period = `${price.interval}/${price.intervalCount}`;
          this.addOption(
            [item.index],
            sum(item.before, after),
            [
              ...this.paidContributions(item),
              ...contributionsOf(
                [{ provider: item.parts[0].provider, keys }],
                item.active & slotsFrom(item.changeSlot),
                [item.index],
              ),
            ],
            [],
            [
              kind === 'interval'
                ? { kind, item: item.suggested, to: resolved.price, on }
                : {
                    kind,
                    item: item.suggested,
                    planId: plan.id,
                    planName: plan.name,
                    ...(changed.source.kind === 'catalog' &&
                      changed.source.addOns && { addOns: changed.source.addOns }),
                    to: resolved.price,
                    on,
                  },
            ],
            [resolved],
            `${kind}:${listItem.id}:${plan.id}:${period}`,
            item.full.amount,
          );
        }
      }
    } else if (source.kind === 'bundle') {
      // A bundle the list has can be billed yearly instead; it isn't swapped for another.
      const bundle = catalog.bundles.find(({ id }) => id === source.bundleId);
      const seller = catalog.providers.find(({ id }) => id === bundle?.soldBy);
      if (!bundle || !seller) return;
      for (const price of this.periodsFor(bundle.prices, seller, item)) {
        if (samePeriod(price, listItem.billing)) continue;
        const resolved = this.resolve(changedItem(listItem, source, price, on), catalog);
        if (!resolved) continue;
        const after = this.cost(resolved, { from: on, to: this.range.to });
        if (after.foreign) continue;
        this.addOption(
          [item.index],
          sum(item.before, after),
          this.keepContributions(item),
          [],
          [{ kind: 'interval', item: item.suggested, to: resolved.price, on }],
          [],
          `interval:${listItem.id}:${price.interval}/${price.intervalCount}`,
          item.full.amount,
        );
      }
    }
  }

  /**
   * Whether removing the item is worth suggesting: another provider's item gives some of the same keys while it's
   * active (two VPNs), or every key it gives is Unused or Unwanted. A service nothing overlaps, with keys that are
   * wanted or not ranked, is the user's to cancel: suggesting it would only list the whole list.
   */
  private removable(item: ItemModel): boolean {
    if (item.serviceSeverity !== 'yellow') return true;
    return this.items.some(
      (other) =>
        other !== item &&
        (other.active & item.active) !== 0 &&
        other.parts.some(
          (part) =>
            !item.providers.includes(part.provider) && part.keys.some((key) => item.ranks.has(key)),
        ),
    );
  }

  /**
   * The billing periods an item can move to: its own, and yearly when it renews by itself and the yearly price does
   * too (BLUEPRINT §10.3). Specific dates keep their period, since their windows are what's paid for.
   */
  private periodsFor(
    prices: Plan['prices'],
    seller: SnapshotProvider,
    item: ItemModel,
  ): PickedPrice[] {
    const { billing } = item.resolved.item;
    return pickPrice(prices, this.priceContext(item.resolved.region, seller)).filter(
      (price) =>
        samePeriod(price, billing) ||
        (billing.mode === 'recurring' &&
          billing.autoRenew &&
          price.autoRenew &&
          price.interval === 'year' &&
          price.intervalCount === 1),
    );
  }

  // ── Options of several items ───────────────────────────────────────────────────────────────────────────────────

  /** Another item of the same provider becomes an extra member on this one (BLUEPRINT §10.3 action 4). */
  private addExtraMembers(): void {
    for (const host of this.items) {
      const { source } = host.resolved.item;
      const catalog = this.input.catalogs.get(host.resolved.region);
      if (source.kind !== 'catalog' || !catalog || host.full.foreign) continue;
      const found = planOf(catalog, source.planId);
      if (!found) continue;
      const { provider, plan } = found;
      const used = (source.addOns ?? []).reduce((total, addOn) => total + addOn.quantity, 0);
      const room = Math.min(maxGroupSize - 1, (plan.addOnLimit ?? Infinity) - used);
      for (const addOnId of plan.addOnIds ?? []) {
        const addOn = provider.addOns?.find(({ id }) => id === addOnId);
        const granted =
          addOn?.grantsPlan === undefined ? undefined : planOf(catalog, addOn.grantsPlan);
        if (!addOn || !granted || room < 1) continue;
        const keys = this.keysOf(granted.plan, catalog);
        const members = this.items.filter(
          (member) =>
            member !== host &&
            member.changeable &&
            member.resolved.item.source.kind === 'catalog' &&
            member.resolved.item.billing.mode === 'recurring' &&
            member.resolved.providerId === provider.id &&
            member.resolved.region === host.resolved.region &&
            !member.essential &&
            includesAll(keys, member.critical),
        );
        for (const chosen of subsets(members, 1, room)) {
          // Each member joins on its own next charge, when its own plan ends (M8.5).
          const addOns = chosen.reduce<AddOnChoice[] | undefined>(
            (list, member) => withAddOn(list, addOnId, 1, member.next ?? this.context.today),
            source.addOns,
          ) as AddOnChoice[];
          const hosted = this.resolve(
            { ...host.resolved.item, source: { ...source, addOns } },
            catalog,
          );
          const price = hosted?.addOns.find(({ id }) => id === addOnId)?.price;
          if (!hosted || !price) continue;
          const after = this.cost(hosted, this.range);
          if (after.foreign) continue;
          this.addOption(
            [host.index, ...chosen.map((member) => member.index)],
            chosen.reduce((total, member) => sum(total, member.before), after),
            [
              ...this.keepContributions(host),
              ...chosen.flatMap((member) => [
                ...this.paidContributions(member),
                ...contributionsOf(
                  [{ provider: member.parts[0].provider, keys }],
                  member.active & host.active & slotsFrom(member.changeSlot),
                  [member.index],
                ),
              ]),
            ],
            [],
            chosen.map((member) => ({
              kind: 'extra-member' as const,
              item: member.suggested,
              host: host.suggested,
              addOnId,
              addOnName: addOn.name,
              to: price,
              on: member.next ?? this.context.today,
            })),
            [],
            `extra-member:${host.resolved.item.id}:${addOnId}:${ids(chosen)}`,
            host.full.amount + chosen.reduce((total, member) => total + member.full.amount, 0),
          );
        }
      }
    }
  }

  /** Items whose providers a bundle's plans are, replaced by the bundle (BLUEPRINT §4.4, §10.3 action 5). */
  private addBundles(): void {
    for (const [region, catalog] of this.regions()) {
      for (const bundle of catalog.bundles) {
        const seller = catalog.providers.find(({ id }) => id === bundle.soldBy);
        const plans = bundle.includes.map((planId) => planOf(catalog, planId));
        if (!seller || plans.some((found) => found === undefined)) continue;
        const included = plans.filter((found) => found !== undefined);
        const keys = included.map(({ plan }) => this.keysOf(plan, catalog));
        const choices = included.map(({ provider, plan }, index) =>
          this.joiners(region).filter(
            (member) =>
              member.resolved.providerId === provider.id &&
              (!member.essential || member.resolved.planId === plan.id) &&
              includesAll(keys[index], member.critical),
          ),
        );
        for (const matched of assignments(choices)) {
          const members = matched.filter((member) => member !== undefined);
          if (members.length < 2) continue;
          const on = earliest(members);
          const start = slotOf(on, this.bounds);
          for (const price of this.groupPeriods(bundle.prices, seller, members)) {
            const added = this.resolve(
              newItem(members[0], { kind: 'bundle', bundleId: bundle.id }, price, on),
              catalog,
            );
            if (!added) continue;
            this.addGroup(
              members,
              added,
              on,
              included.map(({ provider }, index) => ({
                part: { provider: this.provider(provider.id), keys: keys[index] },
                forItems: matched[index] === undefined ? [] : [matched[index].index],
              })),
              start,
              {
                kind: 'bundle',
                items: members.map((member) => member.suggested),
                bundleId: bundle.id,
                name: bundle.name,
                to: added.price,
                on,
              },
              `bundle:${bundle.id}:${price.interval}/${price.intervalCount}:${ids(members)}`,
            );
          }
        }
      }
    }
  }

  /**
   * Items whose plans a suite plan includes (`includes-subscription`, transitively), replaced by the suite: up to
   * `account.users` copies of each included plan (BLUEPRINT §4.4).
   */
  private addSuites(): void {
    for (const [region, catalog] of this.regions()) {
      for (const provider of catalog.providers) {
        for (const plan of provider.plans) {
          const includes = inclusionsOf(plan, catalog);
          if (includes.size === 0) continue;
          const users = plan.features['account.users'];
          const copies = typeof users === 'number' ? users : 1;
          const keys = this.keysOf(plan, catalog);
          const candidates = this.joiners(region).filter(
            (member) =>
              member.resolved.planId !== plan.id &&
              (includes.has(member.resolved.planId ?? '') ||
                includes.has(member.resolved.providerId ?? '')) &&
              !member.essential &&
              includesAll(keys, member.critical),
          );
          for (const members of subsets(candidates, 2, maxGroupSize)) {
            const perPlan = new Map<string, number>();
            for (const member of members) {
              const planId = member.resolved.planId ?? '';
              perPlan.set(planId, (perPlan.get(planId) ?? 0) + 1);
            }
            if ([...perPlan.values()].some((count) => count > copies)) continue;
            const on = earliest(members);
            const start = slotOf(on, this.bounds);
            for (const price of this.groupPeriods(plan.prices, provider, members)) {
              const added = this.resolve(
                newItem(members[0], { kind: 'catalog', planId: plan.id }, price, on),
                catalog,
              );
              if (!added) continue;
              this.addGroup(
                members,
                added,
                on,
                [
                  {
                    part: { provider: this.provider(provider.id), keys },
                    forItems: members.map((member) => member.index),
                  },
                ],
                start,
                {
                  kind: 'suite',
                  items: members.map((member) => member.suggested),
                  providerId: provider.id,
                  planId: plan.id,
                  name: provider.name,
                  planName: plan.name,
                  to: added.price,
                  on,
                },
                `suite:${plan.id}:${price.interval}/${price.intervalCount}:${ids(members)}`,
              );
            }
          }
        }
      }
    }
  }

  /** A bundle or suite replacing `members` from `on`: what's paid for, then the new item. */
  private addGroup(
    members: readonly ItemModel[],
    added: ResolvedItem,
    on: IsoDate,
    parts: readonly { part: Part; forItems: readonly number[] }[],
    start: number,
    action: SuggestionAction,
    signature: string,
  ): void {
    const after = this.cost(added, { from: on, to: this.range.to });
    if (after.foreign) return;
    this.addOption(
      members.map((member) => member.index),
      members.reduce((total, member) => sum(total, member.before), after),
      [
        ...members.flatMap((member) => this.paidContributions(member)),
        ...parts.flatMap(({ part, forItems }) =>
          contributionsOf([part], slotsFrom(start), forItems),
        ),
      ],
      [],
      [action],
      [added],
      signature,
      members.reduce((total, member) => total + member.full.amount, 0),
    );
  }

  /** The items a bundle or suite can take in a region: ongoing catalog plans with something to pay. */
  private joiners(region: string): ItemModel[] {
    return this.items.filter(
      (item) =>
        item.changeable &&
        item.resolved.region === region &&
        item.resolved.item.source.kind === 'catalog' &&
        item.resolved.item.billing.mode === 'recurring',
    );
  }

  /** A bundle's or suite's periods for its members: yearly only when they all renew by themselves. */
  private groupPeriods(
    prices: Plan['prices'],
    seller: SnapshotProvider,
    members: readonly ItemModel[],
  ): PickedPrice[] {
    const automatic = members.every(
      ({ resolved }) =>
        resolved.item.billing.mode === 'recurring' && resolved.item.billing.autoRenew,
    );
    return pickPrice(prices, this.priceContext(members[0].resolved.region, seller)).filter(
      (price) => price.interval !== 'year' || (automatic && price.autoRenew),
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Adds an option, unless it costs as much as `replaces` or more: a change that saves nothing is never suggested.
   */
  private addOption(
    items: number[],
    cost: Cost,
    contributions: Contribution[],
    removes: number[],
    actions: SuggestionAction[],
    added: ResolvedItem[],
    signature: string,
    replaces = Infinity,
  ): void {
    if (cost.foreign || cost.amount >= replaces - savingEpsilon) return;
    const byKey = new Map<number, Contribution[]>();
    for (const contribution of contributions) {
      const list = byKey.get(contribution.key);
      if (list) list.push(contribution);
      else byKey.set(contribution.key, [contribution]);
    }
    const sorted = [...items].sort((a, b) => a - b);
    const option: OptionModel = {
      index: this.options.length,
      items: sorted,
      cost: cost.amount,
      converted: cost.converted,
      contributions,
      byKey,
      removes,
      actions,
      added,
      signature,
    };
    this.options.push(option);
    if (sorted.length === 1) this.own[sorted[0]].push(option.index);
    else for (const item of sorted) this.groups[item].push(option.index);
  }

  private cost(resolved: Chargeable, range: DateRange): Cost {
    const cost: Cost = { amount: 0, converted: false, foreign: false };
    for (const charge of itemCharges(resolved, range, this.context.place)) {
      if (charge.currency !== this.context.currency) {
        cost.foreign = true;
        continue;
      }
      cost.amount += charge.amount;
      cost.converted ||= charge.converted;
    }
    return cost;
  }

  private resolve(item: ListItem, catalog: CatalogData): ResolvedItem | undefined {
    const context: ResolveContext = {
      catalog,
      customSubs: undefined,
      country: this.context.country,
      currency: this.context.currency,
      ...(this.context.fx && { fx: this.context.fx }),
      today: this.context.today,
      profileRanks: this.context.profileRanks,
      taxPlace: this.context.place,
    };
    const resolution = resolveItem(item, context);
    return resolution.ok ? resolution.resolved : undefined;
  }

  private priceContext(region: string, seller: SnapshotProvider): PriceContext {
    return {
      region,
      currency: this.context.currency,
      ...(seller.billingCurrency && { billingCurrency: seller.billingCurrency }),
      ...(this.context.fx && { fx: this.context.fx }),
    };
  }

  /** The regions the items are priced in that have a catalog, in the items' order. */
  private regions(): [string, CatalogData][] {
    const regions = [...new Set(this.items.map((item) => item.resolved.region))];
    return regions.flatMap((region) => {
      const catalog = this.input.catalogs.get(region);
      return catalog ? [[region, catalog] as [string, CatalogData]] : [];
    });
  }

  private keysOf(plan: Pick<Plan, 'features'>, catalog: CatalogData): number[] {
    return providedKeys(plan.features, catalog.features).map((key) => this.key(key, catalog));
  }

  private key(key: RankKey, catalog: CatalogData | undefined): number {
    let number = this.keyNumbers.get(key);
    if (number === undefined) {
      number = this.keyIds.length;
      this.keyNumbers.set(key, number);
      this.keyIds.push(key);
      const option = catalog?.features
        .flatMap(rankKeyOptions)
        .find((candidate) => candidate.key === key);
      this.labels.push(option ? rankKeyLabel(option) : key);
    }
    return number;
  }

  private provider(id: string): number {
    let number = this.providerNumbers.get(id);
    if (number === undefined) {
      number = this.providerNumbers.size;
      this.providerNumbers.set(id, number);
    }
    return number;
  }
}

/** The item on another plan or period from `on`, its next charge: its price override goes, being for the old one. */
function changedItem(
  item: ListItem,
  source: ItemSource,
  period: Period,
  on: IsoDate,
  plan?: Plan,
): ListItem {
  const rest = { ...item };
  delete rest.priceOverride;
  const kept =
    source.kind === 'catalog' && item.source.kind === 'catalog' && plan
      ? keptAddOns(item.source.addOns, plan)
      : undefined;
  return {
    ...rest,
    source: source.kind === 'catalog' ? { ...source, ...(kept && { addOns: kept }) } : source,
    billing:
      item.billing.mode === 'recurring'
        ? reperiod(item.billing, period, on)
        : { ...item.billing, interval: period.interval, intervalCount: period.intervalCount },
  };
}

type Recurring = Extract<ListItem['billing'], { mode: 'recurring' }>;

/** Ongoing billing with a new period, anchored on `on`, keeping its billing day while it still applies. */
export function reperiod(billing: Recurring, period: Period, on: IsoDate): Recurring {
  const rest = { ...billing };
  delete rest.billingDay;
  const billingDay = keptBillingDay(on, period, billing.billingDay);
  return {
    ...rest,
    interval: period.interval,
    intervalCount: period.intervalCount,
    anchorDate: on,
    ...(billingDay !== undefined && { billingDay }),
  };
}

/** The add-ons a plan allows, within its limit. */
export function keptAddOns(
  addOns: readonly { id: string; quantity: number }[] | undefined,
  plan: Pick<Plan, 'addOnIds' | 'addOnLimit'>,
): { id: string; quantity: number }[] | undefined {
  let room = plan.addOnLimit ?? Infinity;
  const kept: { id: string; quantity: number }[] = [];
  for (const addOn of addOns ?? []) {
    if (!(plan.addOnIds ?? []).includes(addOn.id) || room <= 0) continue;
    const quantity = Math.min(addOn.quantity, room);
    kept.push({ id: addOn.id, quantity });
    room -= quantity;
  }
  return kept.length > 0 ? kept : undefined;
}

/** `addOns` with `count` more of one. */
export function withAddOn(
  addOns: readonly AddOnChoice[] | undefined,
  id: string,
  count: number,
  since?: IsoDate,
): AddOnChoice[] {
  const list = [...(addOns ?? [])];
  // One entry per day it joined: an extra member from Nov 20 never adds to the charges before it.
  const index = list.findIndex((addOn) => addOn.id === id && addOn.since === since);
  if (index >= 0) list[index] = { ...list[index], quantity: list[index].quantity + count };
  else list.push({ id, quantity: count, ...(since !== undefined && { since }) });
  return list;
}

interface AddOnChoice {
  id: string;
  quantity: number;
  since?: IsoDate;
}

/** A new item a bundle or suite adds, priced like its first member and billed from `on`. */
function newItem(first: ItemModel, source: ItemSource, price: PickedPrice, on: IsoDate): ListItem {
  const { item } = first.resolved;
  return {
    id: item.id,
    listId: item.listId,
    source,
    ...(item.region !== undefined && { region: item.region }),
    billing: {
      mode: 'recurring',
      interval: price.interval,
      intervalCount: price.intervalCount,
      anchorDate: on,
      // Nothing before it starts: the items it replaces are paid for until then (M8.5).
      startDate: on,
      autoRenew: price.autoRenew,
    },
    tagIds: [],
    rankOverrides: {},
    pinned: false,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function contributionsOf(
  parts: readonly Part[],
  mask: number,
  forItems: readonly number[],
): Contribution[] {
  if (mask === 0) return [];
  return parts.flatMap((part) =>
    part.keys.map((key) => ({ provider: part.provider, key, mask, forItems })),
  );
}

function sum(a: Cost, b: Cost): Cost {
  return {
    amount: a.amount + b.amount,
    converted: a.converted || b.converted,
    foreign: a.foreign || b.foreign,
  };
}

function includesAll(keys: readonly number[], wanted: readonly number[]): boolean {
  return wanted.every((key) => keys.includes(key));
}

function earliest(members: readonly ItemModel[]): IsoDate {
  return members
    .map((member) => member.next ?? '')
    .filter((date) => date !== '')
    .sort()[0];
}

function ids(members: readonly ItemModel[]): string {
  return members
    .map((member) => member.resolved.item.id)
    .sort()
    .join(',');
}

/** Every subset of `list` with `min` to `max` members, smallest first. */
function subsets<T>(list: readonly T[], min: number, max: number): T[][] {
  const found: T[][] = [];
  const pick = (start: number, chosen: T[]) => {
    if (chosen.length >= min) found.push(chosen);
    if (chosen.length >= max) return;
    for (let index = start; index < list.length; index++) pick(index + 1, [...chosen, list[index]]);
  };
  pick(0, []);
  return found.sort((a, b) => a.length - b.length);
}

/** For each slot, one of its choices or none, never the same item twice. */
function assignments(choices: readonly ItemModel[][]): (ItemModel | undefined)[][] {
  let found: (ItemModel | undefined)[][] = [[]];
  for (const options of choices) {
    found = found.flatMap((partial) => [
      [...partial, undefined],
      ...options
        .filter((option) => !partial.includes(option))
        .map((option) => [...partial, option]),
    ]);
  }
  return found;
}

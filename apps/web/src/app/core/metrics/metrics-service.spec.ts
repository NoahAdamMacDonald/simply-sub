import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  CatalogData,
  CustomSubscription,
  FxRates,
  ListItem,
  Price,
  Settings,
} from '@simply-sub/core';
import { CatalogStore } from '../catalog/catalog-store';
import { FxStore } from '../fx/fx-store';
import { SettingsStore } from '../settings/settings-store';
import { CustomSubsRepository } from '../storage/custom-subs-repository';
import { ItemsRepository } from '../storage/items-repository';
import { RankingsRepository } from '../storage/rankings-repository';
import { testStorage, until } from '../storage/storage.testing';
import { MetricsService } from './metrics-service';

function price(region: string, currency: string, amount: number): Price {
  return {
    region,
    currency,
    amount,
    interval: 'month',
    intervalCount: 1,
    autoRenew: true,
    lastVerified: '2026-10-20',
  };
}

/** A catalog file with Netflix (priced in Canada and the US, with an extra member) and Mullvad (in euros). */
const catalog: CatalogData = {
  schemaVersion: 1,
  features: [
    { id: 'streaming.ad-free', name: 'Ad free', category: 'streaming', type: 'boolean' },
    { id: 'vpn.included', name: 'VPN', category: 'vpn', type: 'boolean' },
  ],
  categories: {
    service: [{ id: 'vpn', name: 'VPN', icon: 'vpn_lock' }],
    feature: [{ id: 'vpn', name: 'VPN' }],
    spend: [{ id: 'software', name: 'Software' }],
  },
  providers: [
    {
      id: 'netflix',
      name: 'Netflix',
      website: 'https://www.netflix.com',
      cancelUrl: 'https://www.netflix.com/cancel',
      iconUrl: 'https://sub.simplely.ca/icons/netflix.webp',
      category: 'vpn',
      spendCategory: 'software',
      plans: [
        {
          id: 'netflix.standard',
          name: 'Standard',
          link: 'https://example.com/netflix.standard',
          features: { 'streaming.ad-free': true },
          prices: [price('CA', 'CAD', 18.99), price('US', 'USD', 19.99)],
          addOnIds: ['netflix.extra-member'],
        },
      ],
      addOns: [
        { id: 'netflix.extra-member', name: 'Extra member', prices: [price('CA', 'CAD', 7.99)] },
      ],
    },
    {
      id: 'mullvad',
      name: 'Mullvad VPN',
      website: 'https://mullvad.net',
      cancelUrl: 'https://mullvad.net/cancel',
      category: 'vpn',
      spendCategory: 'software',
      plans: [
        {
          id: 'mullvad.vpn',
          name: 'Mullvad VPN',
          link: 'https://example.com/mullvad.vpn',
          features: { 'vpn.included': true },
          prices: [price('GLOBAL', 'EUR', 5)],
        },
      ],
    },
  ],
  bundles: [],
  resellers: [],
  policyTopics: [],
};

/** GET /fx's example rates: per Canadian dollar. */
const fx: FxRates = {
  base: 'CAD',
  date: '2026-10-21',
  source: 'European Central Bank via Frankfurter',
  rates: { EUR: 0.664, USD: 0.7243 },
};

const ontario: Settings = {
  key: 'settings',
  country: 'CA',
  subdivision: 'CA-ON',
  currency: 'CAD',
  theme: 'system',
  updatedAt: '2026-10-25T12:00:00.000Z',
};

const family = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const travel = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';
const gymPlan = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c51';

const monthly: ListItem['billing'] = {
  mode: 'recurring',
  interval: 'month',
  intervalCount: 1,
  anchorDate: '2026-11-12',
  autoRenew: true,
};

describe('MetricsService', () => {
  let saved: ReturnType<typeof signal<Settings | undefined>>;
  let rates: ReturnType<typeof signal<FxRates | undefined>>;
  /** The catalog files downloaded so far, by the region they serve. */
  let files: ReturnType<typeof signal<Readonly<Record<string, CatalogData>>>>;
  let items: ItemsRepository;
  let customSubs: CustomSubsRepository;
  let metrics: MetricsService;
  let gym: CustomSubscription;

  async function add(listId: string, source: ListItem['source'], extra: Partial<ListItem> = {}) {
    const item = await items.create({
      listId,
      source,
      billing: monthly,
      tagIds: [],
      rankOverrides: {},
      pinned: false,
      ...extra,
    });
    await until(() => items.byId().has(item.id));
    return item;
  }

  beforeEach(async () => {
    saved = signal<Settings | undefined>(ontario);
    rates = signal<FxRates | undefined>(fx);
    files = signal<Readonly<Record<string, CatalogData>>>({ CA: catalog, US: catalog });
    TestBed.configureTestingModule({
      providers: [
        testStorage().providers,
        { provide: SettingsStore, useValue: { saved } },
        { provide: FxStore, useValue: { rates } },
        {
          provide: CatalogStore,
          useValue: { catalogFor: (region: string): CatalogData | undefined => files()[region] },
        },
      ],
    });
    items = TestBed.inject(ItemsRepository);
    customSubs = TestBed.inject(CustomSubsRepository);
    metrics = TestBed.inject(MetricsService);
    await until(() => items.status() === 'ready' && customSubs.status() === 'ready');

    gym = await customSubs.create({
      name: 'Local Gym',
      link: 'https://localgym.ca',
      plans: [
        {
          id: gymPlan,
          name: 'Basic',
          features: {},
          price: { amount: 29.99, currency: 'CAD', interval: 'month', intervalCount: 1 },
          autoRenewAvailable: true,
        },
      ],
    });
    await until(() => customSubs.byId().has(gym.id));
    // The fixture lists: a family's, with a plan that left the catalog, and one bought while travelling.
    await add(family, {
      kind: 'catalog',
      planId: 'netflix.standard',
      addOns: [{ id: 'netflix.extra-member', quantity: 1 }],
    });
    await add(family, { kind: 'catalog', planId: 'mullvad.vpn' });
    await add(family, { kind: 'custom', customSubId: gym.id, customPlanId: gymPlan });
    await add(family, { kind: 'catalog', planId: 'netflix.basic' });
    await add(travel, { kind: 'catalog', planId: 'netflix.standard' }, { region: 'US' });
  });

  /** A list's resolved items as "name plan: monthly", rounded to cents. */
  const shown = (listId: string) =>
    metrics
      .list(listId)
      .resolved.map(
        (item) =>
          `${item.name} ${item.planName}: ${item.monthlyEquivalent.toFixed(2)} ${item.price.currency}`,
      );

  it('resolves each list’s items, in the order they were added, and says why it can’t resolve one', () => {
    expect(metrics.status()).toBe('ready');
    expect(shown(family)).toEqual([
      'Netflix Standard: 26.98 CAD',
      'Mullvad VPN Mullvad VPN: 7.53 CAD',
      'Local Gym Basic: 29.99 CAD',
    ]);
    expect(metrics.list(family).unresolved.map((item) => item.reason)).toEqual(['plan-gone']);
    expect(metrics.list(family).resolved[0]).toMatchObject({
      iconUrl: 'icons/netflix.webp',
      addOns: [{ id: 'netflix.extra-member', quantity: 1 }],
      providedKeys: ['streaming.ad-free'],
    });
    expect(metrics.list(family).resolved[2].iconUrl).toBe('api/v1/icon?domain=localgym.ca');
    // Bought in the US: the US price, converted.
    expect(shown(travel)).toEqual(['Netflix Standard: 27.60 CAD']);
    expect(metrics.list(travel).resolved[0].region).toBe('US');
  });

  it('ranks what each item provides by its overrides over the profile, and follows the profile (M6.1)', async () => {
    const rankings = TestBed.inject(RankingsRepository);
    await add(
      travel,
      { kind: 'catalog', planId: 'mullvad.vpn' },
      {
        rankOverrides: { 'vpn.included': 'essential' },
      },
    );
    const mullvad = () => metrics.list(family).resolved[1];
    expect(mullvad().effectiveRanks).toEqual({ 'vpn.included': 'not-ranked' });

    await rankings.set('vpn.included', 'needed');
    await until(() => mullvad().effectiveRanks['vpn.included'] === 'needed');
    // The travel list's Mullvad keeps its own rank.
    expect(metrics.list(travel).resolved[1].effectiveRanks).toEqual({
      'vpn.included': 'essential',
    });

    await rankings.clear('vpn.included');
    await until(() => mullvad().effectiveRanks['vpn.included'] === 'not-ranked');
  });

  it('has nothing for a list without items', () => {
    expect(metrics.list('0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c99')).toEqual({
      resolved: [],
      unresolved: [],
    });
  });

  it('reprices when the rates arrive and when the currency changes', () => {
    rates.set(undefined);
    expect(shown(family)[1]).toBe('Mullvad VPN Mullvad VPN: 5.00 EUR');
    rates.set(fx);
    expect(shown(family)[1]).toBe('Mullvad VPN Mullvad VPN: 7.53 CAD');
    saved.set({ ...ontario, currency: 'USD' });
    expect(shown(family)).toEqual([
      'Netflix Standard: 19.54 USD',
      'Mullvad VPN Mullvad VPN: 5.45 USD',
      'Local Gym Basic: 21.72 USD',
    ]);
  });

  it('waits for the catalog file of the region an item was bought in', () => {
    files.set({ CA: catalog });
    expect(metrics.list(travel)).toMatchObject({
      resolved: [],
      unresolved: [{ reason: 'pending' }],
    });
    expect(shown(family)).toHaveLength(3);
    files.set({ CA: catalog, US: catalog });
    expect(shown(travel)).toEqual(['Netflix Standard: 27.60 CAD']);
  });

  it('follows the items and custom subscriptions as they change', async () => {
    await customSubs.remove(gym.id);
    await until(() => metrics.list(family).unresolved.length === 2);
    expect(metrics.list(family).unresolved.map((item) => item.reason)).toEqual([
      'custom-gone',
      'plan-gone',
    ]);

    const mullvad = metrics.list(family).resolved[1].item;
    await items.update(mullvad.id, { priceOverride: { amount: 6, currency: 'CAD' } });
    await until(() => metrics.list(family).resolved[1]?.override !== undefined);
    expect(metrics.list(family).resolved[1].monthlyEquivalent).toBe(6);

    await items.remove(mullvad.id);
    await until(() => metrics.list(family).resolved.length === 1);
  });

  it('resolves nothing before the first run has saved the settings', () => {
    saved.set(undefined);
    expect(metrics.byList().size).toBe(0);
  });
});

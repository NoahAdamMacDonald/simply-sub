import { signal, type WritableSignal } from '@angular/core';
import type { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatMenuHarness } from '@angular/material/menu/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import type { CatalogData, ItemResolution, ListItem, ResolvedItem } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { MetricsService } from '../../core/metrics/metrics-service';
import { ItemsRepository } from '../../core/storage/items-repository';
import { RankingsRepository } from '../../core/storage/rankings-repository';
import { testStorage, until } from '../../core/storage/storage.testing';
import { ConfirmService } from '../../shared/confirm/confirm-service';
import { FeaturesRankingPage } from './features-ranking-page';

// The Features page (P9) over a small registry: VPN (a parent, with its devices' tiers and a kill switch),
// streaming's video quality and Ad free, and a password manager (a parent, with six item types).

const catalog: CatalogData = {
  schemaVersion: 1,
  features: [
    {
      id: 'video.quality',
      name: 'Video quality',
      category: 'streaming',
      type: 'enum',
      values: [
        { id: '1080p', name: '1080p (Full HD)' },
        { id: '4k', name: '4K (Ultra HD)' },
      ],
    },
    { id: 'streaming.ad-free', name: 'Ad free', category: 'streaming', type: 'boolean' },
    { id: 'vpn.included', name: 'VPN', category: 'vpn', type: 'boolean' },
    {
      id: 'vpn.devices',
      parent: 'vpn.included',
      name: 'VPN devices',
      category: 'vpn',
      type: 'number',
      tiers: [
        { id: '1-5', name: '1 to 5 devices', min: 1, max: 5 },
        { id: '6+', name: '6 or more devices', min: 6 },
      ],
    },
    {
      id: 'vpn.kill-switch',
      parent: 'vpn.included',
      name: 'Kill switch',
      category: 'vpn',
      type: 'boolean',
    },
    { id: 'password-manager', name: 'Password manager', category: 'security', type: 'boolean' },
    {
      id: 'password-manager.item-types',
      parent: 'password-manager',
      name: 'Storable item types',
      category: 'security',
      type: 'set',
      values: ['Logins', 'Passkeys', 'Credit cards', 'Identity', 'Secure notes', 'Files'].map(
        (name) => ({ id: name.toLowerCase().replace(' ', '-'), name }),
      ),
    },
  ],
  categories: {
    service: [{ id: 'vpn', name: 'VPN', icon: 'vpn_lock' }],
    feature: [
      { id: 'vpn', name: 'VPN' },
      { id: 'streaming', name: 'Streaming' },
      { id: 'security', name: 'Security & passwords' },
    ],
    spend: [{ id: 'software', name: 'Software' }],
  },
  providers: [],
  bundles: [],
  resellers: [],
  policyTopics: [],
};

/** A resolved item that provides `keys`, as MetricsService would have it. */
function providing(keys: string[]): ItemResolution {
  return { ok: true, resolved: { providedKeys: keys } as ResolvedItem };
}

describe('FeaturesRankingPage', () => {
  let fixture: ComponentFixture<FeaturesRankingPage>;
  let loader: HarnessLoader;
  let rankings: RankingsRepository;
  let items: WritableSignal<readonly ListItem[]>;
  let resolutions: WritableSignal<ReadonlyMap<string, ItemResolution>>;
  let confirm: ReturnType<typeof vi.fn>;

  async function open(listed: ItemResolution[] = []): Promise<void> {
    items = signal(listed.map((_, index) => ({ id: `item-${index}` }) as ListItem));
    resolutions = signal(new Map(listed.map((resolution, index) => [`item-${index}`, resolution])));
    confirm = vi.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        testStorage().providers,
        { provide: CatalogStore, useValue: { catalog: signal(catalog) } },
        { provide: ItemsRepository, useValue: { status: signal('ready'), records: items } },
        { provide: MetricsService, useValue: { resolutions } },
        { provide: ConfirmService, useValue: { confirm } },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    rankings = TestBed.inject(RankingsRepository);
    fixture = TestBed.createComponent(FeaturesRankingPage);
    loader = TestbedHarnessEnvironment.loader(fixture);
    await until(() => rankings.status() === 'ready');
    await fixture.whenStable();
  }

  const element = () => fixture.nativeElement as HTMLElement;
  const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim();
  const cards = () => Array.from(element().querySelectorAll('ss-ranking-card'));
  const card = (name: string) =>
    cards().find((found) => text(found.querySelector('.title')) === name);
  /** A card's rows as "name: rank", children after their parent. */
  const rows = (name: string) =>
    Array.from(card(name)?.querySelectorAll('.row') ?? []).map(
      (row) =>
        `${text(row.querySelector('.name'))}: ${text(row.querySelector('.mat-mdc-select-value'))}`,
    );
  const select = (label: string) =>
    loader.getHarness(MatSelectHarness.with({ selector: `[aria-label="${label}"]` }));
  const button = (label: string) =>
    Array.from(element().querySelectorAll('button')).find((found) => text(found) === label);
  async function settle(until_: () => boolean): Promise<void> {
    await until(() => {
      fixture.detectChanges();
      return until_();
    });
    await fixture.whenStable();
  }

  it('shows a card per category, in order, with a row per key and every card open before anything is listed', async () => {
    await open();

    expect(element().querySelector('h1')?.textContent).toBe('Your feature ranks');
    // Each card's toggle is named by its title and count, with a space between them.
    expect(
      cards().map((found) =>
        found.querySelector('button.toggle')?.textContent?.replace(/expand_\w+/, ''),
      ),
    ).toEqual([
      'VPN 0 of 4 ranked',
      'Streaming 0 of 3 ranked',
      'Security & passwords 0 of 7 ranked',
    ]);
    expect(rows('VPN')).toEqual([
      'VPN: Not ranked',
      '1 to 5 devices: Not ranked',
      '6 or more devices: Not ranked',
      'Kill switch: Not ranked',
    ]);
    // Values are rows of their own, under their feature's heading.
    expect(text(card('Streaming')?.querySelector('[role=heading]'))).toBe('Video quality');
    expect(card('Streaming')?.querySelector('[role=heading]')?.getAttribute('aria-level')).toBe(
      '3',
    );
    // A child's heading is level 3 too: its parent's line is a row, so level 4 would skip one (axe's heading-order).
    expect(card('VPN')?.querySelector('.child [role=heading]')?.getAttribute('aria-level')).toBe(
      '3',
    );
    expect(rows('Streaming')).toEqual([
      '1080p (Full HD): Not ranked',
      '4K (Ultra HD): Not ranked',
      'Ad free: Not ranked',
    ]);
  });

  it('saves a rank at once, marks the row, and deletes the record for Not ranked', async () => {
    await open();
    await (await select('Video quality: 4K (Ultra HD)')).clickOptions({ text: 'Needed' });
    await settle(() => rankings.ranks().get('video.quality=4k') === 'needed');

    const row = card('Streaming')?.querySelectorAll('.row')[1];
    expect(row?.classList).toContain('ranked');
    expect(row?.getAttribute('data-rank')).toBe('needed');
    expect(text(card('Streaming')?.querySelector('.count'))).toBe('1 of 3 ranked');

    await (await select('Video quality: 4K (Ultra HD)')).clickOptions({ text: 'Not ranked' });
    await settle(() => !rankings.ranks().has('video.quality=4k'));
    expect(card('Streaming')?.querySelectorAll('.row')[1].classList).not.toContain('ranked');
  });

  it('ranks every child with Set all, and nothing else, and says so', async () => {
    await open();
    await (await select('VPN')).clickOptions({ text: 'Wanted' });
    await settle(() => rankings.ranks().has('vpn.included'));

    const setAll = await loader.getHarness(MatMenuHarness.with({ triggerText: /Set all in VPN/ }));
    await setAll.clickItem({ text: /Unused/ });
    await settle(() => rankings.ranks().size === 4);

    expect(Object.fromEntries(rankings.ranks())).toEqual({
      'vpn.included': 'wanted',
      'vpn.devices=1-5': 'unused',
      'vpn.devices=6+': 'unused',
      'vpn.kill-switch': 'unused',
    });
    expect(element().querySelector('.announcement')?.textContent).toBe('3 features set to Unused.');
  });

  it('folds a feature with many rows, unless one of them is ranked', async () => {
    await open();
    const fold = () =>
      card('Security & passwords')?.querySelector<HTMLButtonElement>('button.fold');

    expect(text(fold())).toBe('chevron_right Storable item types (6)');
    expect(fold()?.getAttribute('aria-expanded')).toBe('false');
    expect(rows('Security & passwords')).toEqual(['Password manager: Not ranked']);

    fold()?.click();
    await fixture.whenStable();
    expect(fold()?.getAttribute('aria-expanded')).toBe('true');
    expect(rows('Security & passwords')).toHaveLength(7);

    await rankings.set('password-manager.item-types=passkeys', 'needed');
    fold()?.click();
    await settle(() => fold()?.getAttribute('aria-expanded') === 'false');
  });

  it('starts with only the categories the lists use open, and opens and closes a card', async () => {
    await open([providing(['vpn.included', 'vpn.kill-switch']), providing(['vpn.included'])]);
    const toggle = (name: string) => card(name)?.querySelector<HTMLButtonElement>('button.toggle');

    expect(
      cards().map((found) => found.querySelector('.toggle')?.getAttribute('aria-expanded')),
    ).toEqual(['true', 'false', 'false']);
    // How many list items provide each key.
    expect(Array.from(card('VPN')?.querySelectorAll('.usage') ?? []).map(text)).toEqual([
      'in 2 subscriptions',
      'in 1 subscription',
    ]);
    expect(rows('Streaming')).toEqual([]);
    expect(toggle('Streaming')?.getAttribute('aria-controls')).toBe(
      card('Streaming')?.querySelector('.body')?.id,
    );

    toggle('Streaming')?.click();
    await fixture.whenStable();
    expect(rows('Streaming')).toHaveLength(3);
    toggle('VPN')?.click();
    await fixture.whenStable();
    expect(rows('VPN')).toEqual([]);
  });

  describe('filters', () => {
    function find(value: string): void {
      const box = element().querySelector<HTMLInputElement>('input[type=search]')!;
      box.value = value;
      box.dispatchEvent(new Event('input'));
    }

    it('finds features by name, opening their cards, and counts them', async () => {
      await open([providing(['streaming.ad-free'])]);
      find('kill');
      await fixture.whenStable();

      expect(cards().map((found) => text(found.querySelector('h2')))).toEqual(['VPN']);
      // A parent stays as a heading over the child that matches.
      expect(text(card('VPN')?.querySelector('[role=heading]'))).toBe('VPN');
      expect(rows('VPN')).toEqual(['Kill switch: Not ranked']);
      expect(element().querySelector('.matches')?.textContent).toBe('1 feature');

      find('passkeys');
      await fixture.whenStable();
      expect(rows('Security & passwords')).toEqual(['Passkeys: Not ranked']);
    });

    it('shows only ranked keys with Ranked only, and says when nothing is', async () => {
      await open();
      element().querySelector<HTMLInputElement>('mat-checkbox input')?.click();
      await fixture.whenStable();
      expect(text(element().querySelector('ss-empty-state'))).toContain('Nothing is ranked yet.');

      await rankings.set('streaming.ad-free', 'needed');
      await settle(() => cards().length === 1);
      expect(rows('Streaming')).toEqual(['Ad free: Needed']);

      find('zz');
      await fixture.whenStable();
      expect(text(element().querySelector('ss-empty-state h2'))).toBe('No features match');
      button('Show all features')?.click();
      button('Clear search')?.click();
      await fixture.whenStable();
      expect(cards()).toHaveLength(3);
    });
  });

  describe('Reset all', () => {
    it('is off until something is ranked', async () => {
      await open();
      expect(button('Reset all')?.disabled).toBe(true);
    });

    it('clears every rank once confirmed, and nothing when cancelled', async () => {
      await open();
      await rankings.setMany(
        new Map([
          ['vpn.included', 'needed'],
          ['streaming.ad-free', 'wanted'],
        ]),
      );
      await settle(() => button('Reset all')?.disabled === false);

      confirm.mockResolvedValueOnce(false);
      button('Reset all')?.click();
      await fixture.whenStable();
      expect(rankings.ranks().size).toBe(2);
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Reset all ranks?',
          confirmText: 'Reset all',
          danger: true,
        }),
      );

      button('Reset all')?.click();
      await settle(() => rankings.ranks().size === 0);
      expect(element().querySelector('.announcement')?.textContent).toBe(
        'Every feature is Not ranked again.',
      );
    });
  });
});

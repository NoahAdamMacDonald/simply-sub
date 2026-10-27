import { signal, type WritableSignal } from '@angular/core';
import { Location } from '@angular/common';
import { provideLocationMocks, SpyLocation } from '@angular/common/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatChipGridHarness } from '@angular/material/chips/testing';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { MatSliderHarness } from '@angular/material/slider/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CatalogData, ListItem, ProfileRank, RankKey, Settings } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { ClockService } from '../../core/clock/clock-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { ItemsRepository } from '../../core/storage/items-repository';
import { RankingsRepository } from '../../core/storage/rankings-repository';
import { DRAWER_BREAKPOINT } from '../../layout/shell';
import {
  alberta,
  searchCatalogData,
  searchStores,
  today,
} from '../../shared/sub-card/search.testing';
import { SearchPage, searchDelayMs } from './search-page';

// Search's small catalog for an Albertan (search.testing.ts): Mullvad (one EUR price, converted), Netflix (Premium
// in the US only), Proton, Crave (Premium in 4K) and Hulu (US only).

describe('SearchPage', () => {
  let harness: RouterTestingHarness;
  let catalog: WritableSignal<CatalogData | undefined>;
  let settings: WritableSignal<Settings | undefined>;
  let location: SpyLocation;

  /** Opens Search at `url`, as a reload or a link does, on a wide screen unless `narrow`, for an Albertan unless `as`. */
  async function open(
    url = '/search',
    {
      narrow = false,
      loaded = true,
      as = alberta,
    }: { narrow?: boolean; loaded?: boolean; as?: Settings } = {},
  ): Promise<void> {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: narrow && query === DRAWER_BREAKPOINT,
      media: query,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    TestBed.configureTestingModule({
      providers: [
        ...searchStores(),
        { provide: ItemsRepository, useValue: { records: signal<readonly ListItem[]>([]) } },
        {
          provide: RankingsRepository,
          useValue: { ranks: signal<ReadonlyMap<RankKey, ProfileRank>>(new Map()) },
        },
        { provide: ClockService, useValue: { today: signal(today) } },
        provideRouter([{ path: 'search', component: SearchPage }]),
        provideLocationMocks(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    catalog = TestBed.inject(CatalogStore).catalog as WritableSignal<CatalogData | undefined>;
    if (!loaded) catalog.set(undefined);
    settings = TestBed.inject(SettingsStore).saved as WritableSignal<Settings | undefined>;
    settings.set(as);
    location = TestBed.inject(Location) as SpyLocation;
    harness = await RouterTestingHarness.create(url);
    // An app's bootstrap does this: without it, the router doesn't follow back and forward.
    TestBed.inject(Router).setUpLocationChangeListener();
    await settle();
  }

  afterEach(() => vi.unstubAllGlobals());

  /** Waits for the page, and for any navigation it started, to settle. */
  async function settle(): Promise<void> {
    await harness.fixture.whenStable();
    await harness.fixture.whenStable();
  }

  const element = () => harness.routeNativeElement as HTMLElement;
  const loader = () => TestbedHarnessEnvironment.loader(harness.fixture);
  const names = () =>
    Array.from(element().querySelectorAll('ss-sub-card h2')).map((heading) => heading.textContent);
  const count = () => element().querySelector('.count')?.textContent?.trim();
  const box = () => element().querySelector<HTMLInputElement>('input[type=search]');
  const button = (text: string) =>
    Array.from(element().querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === text,
    );
  /** The URL changes since `from`: "replace: …" replaced the current entry, the others added one. */
  const urlChanges = (from: number) => location.urlChanges.slice(from);

  /** Types `text` into the search box, as replacing what's there. */
  function type(text: string): void {
    const input = box();
    if (!input) throw new Error('No search box');
    input.value = text;
    input.dispatchEvent(new Event('input'));
  }

  /** Waits out the typing pause, then for the page to settle. */
  async function pause(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, searchDelayMs + 20));
    await settle();
  }

  /** Goes back or forward in the history. The router follows a popstate after a timeout. */
  async function go(step: 'back' | 'forward'): Promise<void> {
    location[step]();
    await new Promise((resolve) => setTimeout(resolve));
    await settle();
  }

  it('shows placeholder cards until the catalog has loaded', async () => {
    await open('/search', { loaded: false });

    expect(element().querySelectorAll('.skeleton')).toHaveLength(3);
    expect(element().querySelector('.skeleton')?.parentElement?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(count()).toBe('Loading the catalog…');
  });

  it('shows one card per provider sold here, cheapest first, and counts them', async () => {
    await open();

    // Mullvad's €60 a year is CA$7.85 a month. Hulu is sold in the US only.
    expect(names()).toEqual(['Mullvad VPN', 'Netflix', 'Proton', 'Crave']);
    expect(count()).toBe('4 services');
    expect(element().querySelector('.count')?.getAttribute('role')).toBe('status');
    expect(element().querySelector('h1')?.textContent).toBe('Search');
  });

  it('searches once typing pauses, by best match, replacing the URL’s entry', async () => {
    await open();
    const from = location.urlChanges.length;
    type('4k');
    await harness.fixture.whenStable();
    expect(names()).toHaveLength(4);

    await pause();
    expect(names()).toEqual(['Crave']);
    expect(count()).toBe('1 service');
    expect(await (await loader().getHarness(MatSelectHarness)).getValueText()).toBe('Best match');

    type('crave 4k');
    await pause();
    expect(urlChanges(from)).toEqual(['replace: /search?q=4k', 'replace: /search?q=crave%204k']);
  });

  it('shows a provider the text names that isn’t sold here, and says so', async () => {
    await open();
    type('hulu');
    await pause();

    expect(names()).toEqual(['Hulu']);
    expect(element().querySelector('ss-sub-card .prices')?.textContent?.trim()).toBe(
      'Not offered in Canada',
    );
  });

  it('says when nothing matches, and clears the search', async () => {
    await open();
    type('gym');
    await pause();

    expect(names()).toEqual([]);
    expect(count()).toBe('No services match');
    expect(element().querySelector('ss-empty-state h2')?.textContent).toBe('No services match');
    const custom = element().querySelector<HTMLAnchorElement>('ss-empty-state a');
    expect([custom?.textContent?.trim(), custom?.getAttribute('href')]).toEqual([
      'Add a custom subscription',
      '/custom',
    ]);
    expect(button('Clear filters')).toBeUndefined();

    button('Clear search')?.click();
    await settle();

    expect(box()?.value).toBe('');
    expect(names()).toHaveLength(4);
    expect(document.activeElement).toBe(box());
    expect(location.path()).toBe('/search');
  });

  it('sorts as chosen, and offers Best match only with text', async () => {
    await open();
    const sort = await loader().getHarness(MatSelectHarness);

    expect(await sort.getValueText()).toBe('Price: low to high');
    await sort.open();
    expect(await Promise.all((await sort.getOptions()).map((option) => option.getText()))).toEqual([
      'Price: low to high',
      'Price: high to low',
      'Name: A to Z',
      'Most features',
    ]);
    await sort.clickOptions({ text: 'Name: A to Z' });
    await settle();

    expect(names()).toEqual(['Crave', 'Mullvad VPN', 'Netflix', 'Proton']);
    expect(location.path()).toBe('/search?sort=name');

    // The choice stays when text is typed.
    type('vpn');
    await pause();
    expect(await sort.getValueText()).toBe('Name: A to Z');
    expect(names()).toEqual(['Mullvad VPN', 'Proton']);
  });

  describe('the URL', () => {
    it('restores the text, the filters and the sort, as a reload does', async () => {
      await open('/search?q=vpn&sort=name&f=vpn.included&act=none&native=1');

      expect(box()?.value).toBe('vpn');
      expect(await (await loader().getHarness(MatSelectHarness)).getValueText()).toBe(
        'Name: A to Z',
      );
      const chips = await loader().getHarness(MatChipGridHarness);
      expect(await Promise.all((await chips.getRows()).map((row) => row.getText()))).toEqual([
        'VPN',
      ]);
      // Mullvad's price is converted from euros.
      expect(names()).toEqual(['Proton']);
      expect(location.path()).toBe('/search?q=vpn&sort=name&f=vpn.included&act=none&native=1');
    });

    it('shows each provider’s cheapest 4k plan for a 4k filter', async () => {
      await open('/search?f=video.quality%3D4k');

      // Netflix Premium is sold in the US only.
      expect(names()).toEqual(['Crave']);
      expect(element().querySelector('ss-sub-card .plan-name')?.textContent).toBe('Premium');
    });

    describe('Sold in', () => {
      // Crave is priced in Canada only, so in the US it shows its fallback price.
      const american: Settings = {
        ...alberta,
        country: 'US',
        subdivision: undefined,
        currency: 'USD',
      };

      it('hides what has no price where the user is, with sold=1', async () => {
        await open('/search', { as: american });
        expect(names()).toContain('Crave');

        await harness.navigateByUrl('/search?sold=1');
        await settle();
        expect(names()).not.toContain('Crave');
        expect(location.path()).toBe('/search?sold=1');
      });

      it('starts on as Settings says, and sold=0 turns it off', async () => {
        const always: Settings = { ...american, searchSoldOnly: true };
        await open('/search', { as: always });
        expect(names()).not.toContain('Crave');
        expect(location.path()).toBe('/search');
        // On by default, it isn't a filter the empty state or the Filters count clears.
        expect(element().querySelector<HTMLInputElement>('.sold input')?.checked).toBe(true);

        element().querySelector<HTMLInputElement>('.sold input')?.click();
        await settle();
        expect(location.path()).toBe('/search?sold=0');
        expect(names()).toContain('Crave');
      });
    });

    it('hides converted prices with Native pricing only', async () => {
      await open('/search?native=1');

      expect(names()).toEqual(['Netflix', 'Proton', 'Crave']);
    });

    it('drops what the catalog doesn’t have, replacing the URL once the catalog has loaded', async () => {
      const url = '/search?f=nope,video.quality%3D4k&sort=relevance&cat=fitness&zzz=1';
      await open(url, { loaded: false });
      expect(location.path()).toBe(url);

      const from = location.urlChanges.length;
      catalog.set(searchCatalogData);
      await settle();
      expect(urlChanges(from)).toEqual(['replace: /search?f=video.quality%3D4k']);
      expect(names()).toEqual(['Crave']);
    });

    it('keeps text typed before the catalog has loaded', async () => {
      await open('/search?native=1', { loaded: false });
      type('vpn');
      await pause();

      expect(location.path()).toBe('/search?native=1&q=vpn');
    });

    it('adds an entry for each filter and sort, so Back and Forward step through them', async () => {
      await open();
      type('vpn');
      await pause();
      const sort = await loader().getHarness(MatSelectHarness);
      await sort.clickOptions({ text: 'Name: A to Z' });
      await settle();
      element().querySelectorAll<HTMLInputElement>('.activity input')[2].click();
      await settle();
      expect(location.path()).toBe('/search?q=vpn&sort=name&act=none');

      await go('back');
      expect(location.path()).toBe('/search?q=vpn&sort=name');
      expect(element().querySelector<HTMLInputElement>('.activity input:checked')).toBeNull();

      await go('back');
      expect(location.path()).toBe('/search?q=vpn');
      expect(await sort.getValueText()).toBe('Best match');
      expect(box()?.value).toBe('vpn');

      await go('forward');
      await go('forward');
      expect(location.path()).toBe('/search?q=vpn&sort=name&act=none');
      expect(element().querySelectorAll('.activity input:checked')).toHaveLength(1);
    });

    it('makes one entry of a run of price changes', async () => {
      await open();
      const from = location.urlChanges.length;
      const slider = await loader().getHarness(MatSliderHarness);
      await (await slider.getEndThumb()).setValue(20);
      await settle();
      await (await slider.getEndThumb()).setValue(15);
      await settle();
      await (await slider.getStartThumb()).setValue(9);
      await settle();

      expect(urlChanges(from)).toEqual([
        '/search?max=20',
        'replace: /search?max=15',
        'replace: /search?min=9&max=15',
      ]);
      // Proton Unlimited is CA$10 a month, and Crave Basic CA$11.99.
      expect(names()).toEqual(['Proton', 'Crave']);

      await go('back');
      expect(location.path()).toBe('/search');
      expect(names()).toHaveLength(4);
    });

    it('puts back what Back left in the search box', async () => {
      await open('/search?q=netflix');
      await (await loader().getHarness(MatSelectHarness)).clickOptions({ text: 'Name: A to Z' });
      await settle();
      type('crave');
      await pause();
      expect(location.path()).toBe('/search?q=crave&sort=name');

      await go('back');
      expect(location.path()).toBe('/search?q=netflix');
      expect(box()?.value).toBe('netflix');
    });
  });

  describe('the filter panel', () => {
    it('sits beside the results on a wide screen, after the search bar', async () => {
      await open();
      const panel = element().querySelector('section.panel');

      expect(panel?.getAttribute('aria-labelledby')).toBe(panel?.querySelector('h2')?.id);
      expect(panel?.querySelector('h2')?.textContent).toBe('Filters');
      expect(panel?.querySelector('ss-search-filters')).not.toBeNull();
      expect(
        Array.from(element().querySelector('.layout')?.children ?? []).map(
          (child) => child.classList[0],
        ),
      ).toEqual(['bar', 'panel', 'count', 'results']);
      expect(button('Filters')).toBeUndefined();
    });

    it('clears the filters from the empty state', async () => {
      await open('/search?q=gym&native=1');

      button('Clear filters')?.click();
      await settle();
      expect(location.path()).toBe('/search?q=gym');
    });

    describe('under 960 px', () => {
      it('is a drawer opened by Filters, which counts the filters on', async () => {
        await open('/search?f=video.quality%3D4k&native=1', { narrow: true });
        const filters = element().querySelector<HTMLButtonElement>('.open-filters');

        expect(element().querySelector('section.panel')).toBeNull();
        // It shows "Filters · 2", and screen readers hear "Filters, 2 applied".
        expect(filters?.querySelector('mat-icon')?.getAttribute('aria-hidden')).toBe('true');
        expect(filters?.textContent?.replace('tune', '').replace(/\s+/g, ' ').trim()).toBe(
          'Filters · 2',
        );
        expect(filters?.getAttribute('aria-label')).toBe('Filters, 2 applied');
        expect(filters?.getAttribute('aria-haspopup')).toBe('dialog');

        filters?.focus();
        filters?.click();
        await settle();
        const dialog = await TestbedHarnessEnvironment.documentRootLoader(
          harness.fixture,
        ).getHarness(MatDialogHarness);
        expect(await dialog.getTitleText()).toBe('Filters');
        expect(await dialog.getAriaLabelledby()).toBe('ss-filters-drawer-title');
        const host = document.querySelector('mat-dialog-container');
        expect(host?.querySelector('ss-search-filters')).not.toBeNull();
        expect(host?.querySelector('[role=status]')?.textContent).toBe('1 service');
        expect(host?.contains(document.activeElement)).toBe(true);

        await dialog.close();
        await settle();
        expect(document.querySelector('mat-dialog-container')).toBeNull();
        expect(document.activeElement).toBe(filters);
      });

      it('applies a filter from the drawer at once, and Show results closes it', async () => {
        await open('/search', { narrow: true });
        // With no filter on, its name is its text.
        expect(element().querySelector('.open-filters')?.hasAttribute('aria-label')).toBe(false);
        element().querySelector<HTMLButtonElement>('.open-filters')?.click();
        await settle();

        const host = document.querySelector('mat-dialog-container');
        host?.querySelectorAll<HTMLInputElement>('.activity input')[2].click();
        await settle();
        expect(location.path()).toBe('/search?act=none');
        expect(host?.querySelector('[role=status]')?.textContent).toBe('4 services');

        Array.from(host?.querySelectorAll('button') ?? [])
          .find((candidate) => candidate.textContent?.trim() === 'Show results')
          ?.click();
        await settle();
        expect(document.querySelector('mat-dialog-container')).toBeNull();
      });
    });
  });
});

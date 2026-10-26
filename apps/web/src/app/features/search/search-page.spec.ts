import { signal, type WritableSignal } from '@angular/core';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSelectHarness } from '@angular/material/select/testing';
import { provideRouter } from '@angular/router';
import type { CatalogData, ListItem, ProfileRank, RankKey } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { ClockService } from '../../core/clock/clock-service';
import { ItemsRepository } from '../../core/storage/items-repository';
import { RankingsRepository } from '../../core/storage/rankings-repository';
import { searchStores, today } from '../../shared/sub-card/search.testing';
import { SearchPage, searchDelayMs } from './search-page';

describe('SearchPage', () => {
  let fixture: ComponentFixture<SearchPage>;
  let catalog: WritableSignal<CatalogData | undefined>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        ...searchStores(),
        { provide: ItemsRepository, useValue: { records: signal<readonly ListItem[]>([]) } },
        {
          provide: RankingsRepository,
          useValue: { ranks: signal<ReadonlyMap<RankKey, ProfileRank>>(new Map()) },
        },
        { provide: ClockService, useValue: { today: signal(today) } },
        provideRouter([]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    catalog = TestBed.inject(CatalogStore).catalog as WritableSignal<CatalogData | undefined>;
    fixture = TestBed.createComponent(SearchPage);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const names = () =>
    Array.from(element().querySelectorAll('ss-sub-card h2')).map((heading) => heading.textContent);
  const count = () => element().querySelector('.count')?.textContent?.trim();
  const box = () => element().querySelector<HTMLInputElement>('input[type=search]');

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
    await fixture.whenStable();
  }

  it('shows placeholder cards until the catalog has loaded', async () => {
    catalog.set(undefined);
    await fixture.whenStable();

    expect(element().querySelectorAll('.skeleton')).toHaveLength(3);
    expect(element().querySelector('.skeleton')?.parentElement?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(count()).toBe('Loading the catalog…');
  });

  it('shows one card per provider sold here, cheapest first, and counts them', () => {
    // Mullvad's €60 a year is CA$7.85 a month. Hulu is sold in the US only.
    expect(names()).toEqual(['Mullvad VPN', 'Netflix', 'Proton', 'Crave']);
    expect(count()).toBe('4 services');
    expect(element().querySelector('.count')?.getAttribute('role')).toBe('status');
    expect(element().querySelector('h1')?.textContent).toBe('Search');
  });

  it('searches once typing pauses, by best match', async () => {
    type('4k');
    await fixture.whenStable();
    expect(names()).toHaveLength(4);

    await pause();
    expect(names()).toEqual(['Crave']);
    expect(count()).toBe('1 service');
    const loader = TestbedHarnessEnvironment.loader(fixture);
    expect(await (await loader.getHarness(MatSelectHarness)).getValueText()).toBe('Best match');
  });

  it('shows a provider the text names that isn’t sold here, and says so', async () => {
    type('hulu');
    await pause();

    expect(names()).toEqual(['Hulu']);
    expect(element().querySelector('ss-sub-card .prices')?.textContent?.trim()).toBe(
      'Not offered in Canada',
    );
  });

  it('says when nothing matches, and clears the search', async () => {
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

    const clear = Array.from(element().querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Clear search',
    );
    clear?.click();
    await fixture.whenStable();

    expect(box()?.value).toBe('');
    expect(names()).toHaveLength(4);
    expect(document.activeElement).toBe(box());
  });

  it('sorts as chosen, and offers Best match only with text', async () => {
    const loader = TestbedHarnessEnvironment.loader(fixture);
    const sort = await loader.getHarness(MatSelectHarness);

    expect(await sort.getValueText()).toBe('Price: low to high');
    await sort.open();
    expect(await Promise.all((await sort.getOptions()).map((option) => option.getText()))).toEqual([
      'Price: low to high',
      'Price: high to low',
      'Name: A to Z',
      'Most features',
    ]);
    await sort.clickOptions({ text: 'Name: A to Z' });
    await fixture.whenStable();

    expect(names()).toEqual(['Crave', 'Mullvad VPN', 'Netflix', 'Proton']);

    // The choice stays when text is typed.
    type('vpn');
    await pause();
    expect(await sort.getValueText()).toBe('Name: A to Z');
    expect(names()).toEqual(['Mullvad VPN', 'Proton']);
  });
});

import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import type { HarnessLoader } from '@angular/cdk/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatAutocompleteHarness } from '@angular/material/autocomplete/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MatChipGridHarness } from '@angular/material/chips/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSelectHarness } from '@angular/material/select/testing';
import { MatSliderHarness } from '@angular/material/slider/testing';
import { searchFilterOptions, type CatalogQuery } from '@simply-sub/core';
import { alberta, fx, searchCatalogData, today } from '../../shared/sub-card/search.testing';
import { SearchFilters } from './search-filters';

// Search's small catalog for an Albertan (search.testing.ts): Netflix and Crave (streaming, 1080p and 4K, Ad free),
// Mullvad and Proton (VPN). Crave Premium's CA$22 a month is the priciest, so the slider goes to $25 by $1.

const options = searchFilterOptions({
  catalog: searchCatalogData,
  settings: alberta,
  fx,
  today,
});

describe('SearchFilters', () => {
  let fixture: ComponentFixture<SearchFilters>;
  let loader: HarnessLoader;
  let changes: CatalogQuery[];
  let prices: CatalogQuery[];

  async function setup(query: CatalogQuery = {}): Promise<void> {
    TestBed.configureTestingModule({
      providers: [{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
    });
    fixture = TestBed.createComponent(SearchFilters);
    fixture.componentRef.setInput('query', query);
    fixture.componentRef.setInput('options', options);
    fixture.componentRef.setInput('catalog', searchCatalogData);
    fixture.componentRef.setInput('currency', 'CAD');
    fixture.componentRef.setInput('country', 'CA');
    changes = [];
    prices = [];
    fixture.componentInstance.queryChange.subscribe((next) => changes.push(next));
    fixture.componentInstance.priceChange.subscribe((next) => prices.push(next));
    loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
  }

  /** Shows `query`, as the page does once the URL has it. */
  async function show(query: CatalogQuery): Promise<void> {
    fixture.componentRef.setInput('query', query);
    await fixture.whenStable();
  }

  const element = () => fixture.nativeElement as HTMLElement;
  const rangeText = () => element().querySelector('.range')?.textContent?.trim();

  describe('price per month', () => {
    it('goes from $0 to Unlimited, the catalog’s top, by round steps', async () => {
      await setup();
      const slider = await loader.getHarness(MatSliderHarness);
      const [low, high] = [await slider.getStartThumb(), await slider.getEndThumb()];

      expect(rangeText()).toBe('$0 – Unlimited');
      expect([
        await slider.getMinValue(),
        await slider.getMaxValue(),
        await slider.getStep(),
      ]).toEqual([0, 25, 1]);
      expect(await low.getDisplayValue()).toBe('$0');
      expect(await high.getDisplayValue()).toBe('Unlimited');
      expect(element().querySelector('.price')?.getAttribute('aria-labelledby')).toBe(
        element().querySelector('.price .label')?.id,
      );
      expect(
        [...element().querySelectorAll('.price input')].map((input) =>
          input.getAttribute('aria-label'),
        ),
      ).toEqual(['Lowest price per month', 'Highest price per month']);
    });

    it('emits a price once a thumb is let go: 0 is no minimum, and the top no maximum', async () => {
      await setup({ q: 'vpn', category: 'vpn' });
      const slider = await loader.getHarness(MatSliderHarness);

      await (await slider.getEndThumb()).setValue(12);
      expect(prices).toEqual([{ q: 'vpn', category: 'vpn', maxPrice: 12 }]);
      expect(rangeText()).toBe('$0 – $12');
      expect(changes).toEqual([]);

      await show({ q: 'vpn', category: 'vpn', minPrice: 5, maxPrice: 12 });
      await (await slider.getStartThumb()).setValue(0);
      await (await slider.getEndThumb()).setValue(25);
      expect(prices.slice(1)).toEqual([
        { q: 'vpn', category: 'vpn', maxPrice: 12 },
        { q: 'vpn', category: 'vpn', minPrice: 5 },
      ]);
    });

    it('shows a range from the URL, with a maximum past the top as Unlimited', async () => {
      await setup({ minPrice: 9.99, maxPrice: 40 });

      expect(rangeText()).toBe('$9.99 – Unlimited');
    });
  });

  describe('category', () => {
    it('offers All and the categories of what’s sold here, and the one chosen', async () => {
      await setup();
      const select = await loader.getHarness(MatSelectHarness);

      expect(await select.getValueText()).toBe('All');
      await select.open();
      expect(
        await Promise.all((await select.getOptions()).map((option) => option.getText())),
      ).toEqual(['All', 'Streaming video', 'VPN']);
      await select.clickOptions({ text: 'VPN' });
      expect(changes).toEqual([{ category: 'vpn' }]);

      await show({ category: 'vpn', nativeOnly: true });
      await select.open();
      await select.clickOptions({ text: 'All' });
      expect(changes[1]).toEqual({ category: undefined, nativeOnly: true });
    });
  });

  describe('features', () => {
    it('suggests the keys a feature’s name names, then the rest of its category, and adds the one picked', async () => {
      await setup();
      const box = await loader.getHarness(MatAutocompleteHarness);

      await box.enterText('video');
      const groups = await box.getOptionGroups();
      expect(await Promise.all(groups.map((group) => group.getLabelText()))).toEqual([
        'Matches',
        'More in Streaming',
      ]);
      expect(await Promise.all((await box.getOptions()).map((option) => option.getText()))).toEqual(
        ['Video quality: 1080p (Full HD)', 'Video quality: 4K (Ultra HD)', 'Ad free'],
      );

      // The list scrolls, so Chromium would make it a tab stop: the arrow keys move through it from the box.
      expect(document.querySelector('.mat-mdc-autocomplete-panel')?.getAttribute('tabindex')).toBe(
        '-1',
      );

      await box.selectOption({ text: 'Video quality: 4K (Ultra HD)' });
      expect(changes).toEqual([{ features: ['video.quality=4k'] }]);
      expect(await box.getValue()).toBe('');
    });

    it('shows each chosen key as a chip, which isn’t suggested again and can be removed', async () => {
      await setup({ features: ['video.quality=4k', 'streaming.ad-free'] });
      const grid = await loader.getHarness(MatChipGridHarness);
      const rows = await grid.getRows();

      expect(await Promise.all(rows.map((row) => row.getText()))).toEqual([
        'Video quality: 4K (Ultra HD)',
        'Ad free',
      ]);
      const box = await loader.getHarness(MatAutocompleteHarness);
      await box.enterText('video');
      expect(await Promise.all((await box.getOptions()).map((option) => option.getText()))).toEqual(
        ['Video quality: 1080p (Full HD)'],
      );

      element()
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Remove Video quality: 4K (Ultra HD)"]',
        )
        ?.click();
      expect(changes).toEqual([{ features: ['streaming.ad-free'] }]);
    });

    it('says that plans need every feature chosen', async () => {
      await setup();
      expect(element().querySelector('.features mat-hint')?.textContent?.trim()).toBe(
        'Plans need every feature chosen',
      );
    });
  });

  describe('activity', () => {
    it('is three checkboxes in a group, each adding to or taking from the list', async () => {
      await setup({ activity: ['inactive'] });
      const boxes = [...element().querySelectorAll<HTMLInputElement>('.activity input')];

      expect(element().querySelector('.activity legend')?.textContent?.trim()).toBe('Activity');
      expect(
        boxes.map((box) => [
          box.type,
          box.closest('label')?.querySelector('span')?.textContent,
          box.checked,
        ]),
      ).toEqual([
        ['checkbox', 'Active', false],
        ['checkbox', 'Inactive', true],
        ['checkbox', 'Not listed', false],
      ]);

      boxes[2].click();
      boxes[1].click();
      expect(changes).toEqual([{ activity: ['inactive', 'not-listed'] }, { activity: [] }]);
    });
  });

  describe('native pricing only', () => {
    it('is a checkbox with a hint, turned on and off', async () => {
      await setup();
      const native = await loader.getHarness(MatCheckboxHarness);

      expect(await native.getLabelText()).toBe('Native pricing only');
      const input = element().querySelector('.native input');
      expect(
        element().querySelector(`#${input?.getAttribute('aria-describedby')}`)?.textContent,
      ).toBe('Hides prices converted from another currency');
      await native.check();
      expect(changes).toEqual([{ nativeOnly: true }]);

      await show({ nativeOnly: true });
      await native.uncheck();
      expect(changes[1]).toEqual({ nativeOnly: undefined });
    });
  });

  describe('clear all', () => {
    it('turns every filter off, keeping the text and the sort', async () => {
      await setup({
        q: 'vpn',
        sort: 'name',
        category: 'vpn',
        features: ['vpn.included'],
        maxPrice: 12,
        activity: ['active'],
        nativeOnly: true,
      });
      const clear = await loader.getHarness(MatButtonHarness.with({ text: 'Clear all' }));

      await clear.click();
      expect(changes).toEqual([{ q: 'vpn', sort: 'name' }]);
    });

    it('stays focusable with nothing to clear, and does nothing', async () => {
      await setup({ q: 'vpn' });
      const clear = await loader.getHarness(MatButtonHarness.with({ text: 'Clear all' }));

      expect(await clear.isDisabled()).toBe(true);
      expect(await (await clear.host()).getAttribute('aria-disabled')).toBe('true');
      await clear.click();
      expect(changes).toEqual([]);
    });
  });
});

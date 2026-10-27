import type { WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import {
  searchCatalog,
  type CatalogQuery,
  type CatalogResult,
  type ListItem,
  type Settings,
} from '@simply-sub/core';
import { SettingsStore } from '../../core/settings/settings-store';
import { alberta, fx, listItem, searchCatalogData, searchStores, today } from './search.testing';
import { SubCard } from './sub-card';

const work = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const family = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';

/** The provider's result as Search would give it. */
function resultFor(
  id: string,
  query: CatalogQuery = {},
  items: ListItem[] = [],
  settings: Settings = alberta,
): CatalogResult {
  const found = searchCatalog(query, {
    catalog: searchCatalogData,
    settings,
    fx,
    items,
    today,
  }).find(({ provider }) => provider.id === id);
  if (!found) throw new Error(`No result for ${id}`);
  return found;
}

describe('SubCard', () => {
  let fixture: ComponentFixture<SubCard>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ...searchStores(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    fixture = TestBed.createComponent(SubCard);
  });

  async function show(result: CatalogResult): Promise<void> {
    fixture.componentRef.setInput('result', result);
    await fixture.whenStable();
  }

  const element = () => fixture.nativeElement as HTMLElement;
  const query = <T extends Element = HTMLElement>(selector: string) =>
    element().querySelector<T & Element>(selector);
  /**
   * What's on screen in `selector`, without icon ligatures or screen-reader-only words. Elements are spaced apart
   * on screen by their layout, so their texts are joined with spaces.
   */
  const shown = (selector: string) => {
    const found = query(selector);
    if (!found) return undefined;
    const copy = found.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('mat-icon, .visually-hidden').forEach((node) => node.remove());
    const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
    const texts: string[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode.textContent?.trim() ?? '');
    return texts.filter(Boolean).join(' ');
  };
  const radios = () =>
    Array.from(element().querySelectorAll<HTMLInputElement>('input[type=radio]'));
  const links = () =>
    Array.from(element().querySelectorAll<HTMLAnchorElement>('.links a')).map((link) => ({
      text: link.textContent?.replace('open_in_new', '').replace(/\s+/g, ' ').trim(),
      href: link.href,
      target: link.target,
      rel: link.rel,
    }));

  it('shows the provider, the plan, its prices and where to sign up and cancel', async () => {
    await show(resultFor('netflix'));

    expect(shown('h2')).toBe('Netflix');
    expect(shown('.plan-name')).toBe('Standard with ads');
    expect(shown('.prices')).toBe('$7.99 / mo + tax');
    expect(shown('ss-status-badge')).toBe('Not listed');
    expect(links()).toEqual([
      {
        text: 'Plan: Netflix Standard with ads, opens in a new tab',
        href: 'https://example.com/netflix.standard-ads',
        target: '_blank',
        rel: 'noopener',
      },
      {
        text: 'Cancel Netflix, opens in a new tab',
        href: 'https://www.netflix.com/cancelplan',
        target: '_blank',
        rel: 'noopener',
      },
    ]);
  });

  it('switches between the matching plans with radio chips', async () => {
    await show(resultFor('netflix'));

    // Premium is sold in the US only.
    expect(radios().map((radio) => [radio.value, radio.checked])).toEqual([
      ['netflix.standard-ads', true],
      ['netflix.standard', false],
    ]);
    expect(new Set(radios().map((radio) => radio.name)).size).toBe(1);
    expect(query('legend')?.textContent).toBe('Netflix plans');

    radios()[1].click();
    await fixture.whenStable();

    expect(shown('.plan-name')).toBe('Standard');
    expect(shown('.prices')).toBe('$18.99 / mo + tax $189.99 / year + tax');
    expect(links()[0].href).toBe('https://www.netflix.com/signup/standard');
  });

  it('keeps the plan picked while it still matches, and shows the result’s again when it doesn’t', async () => {
    await show(resultFor('netflix'));
    radios()[1].click();
    await fixture.whenStable();

    // A new search that Standard still matches.
    await show(resultFor('netflix', { q: 'netflix' }));
    expect(shown('.plan-name')).toBe('Standard');

    // One that it doesn't.
    await show(resultFor('netflix', { q: 'ads' }));
    expect(shown('.plan-name')).toBe('Standard with ads');
    expect(radios()).toEqual([]);
  });

  it('shows the user’s own plan, and the provider’s status across their lists', async () => {
    const items = [listItem('netflix.standard', work), listItem('netflix.standard', family)];
    await show(resultFor('netflix', {}, items));

    expect(shown('.plan-name')).toBe('Standard');
    expect(shown('ss-status-badge')).toBe('Active · 2 lists');

    await show(resultFor('crave', {}, [listItem('crave.premium', work, true)]));
    expect(shown('ss-status-badge')).toBe('Inactive · 1 list');
  });

  it('says when a provider isn’t sold in the user’s country, with no prices or plans', async () => {
    const hulu = resultFor('hulu', { q: 'hulu' });
    expect(hulu.kind).toBe('not-offered');
    await show(hulu);

    expect(shown('.prices')).toBe('Not offered in Canada');
    expect(links()).toEqual([
      expect.objectContaining({
        text: 'Website: Hulu, opens in a new tab',
        href: 'https://www.hulu.com/',
      }),
    ]);
    expect(query('.plan-name')).toBeNull();
    expect(radios()).toEqual([]);
    expect(query('button.expand')).toBeNull();
  });

  it('shows the fallback price of a plan whose availability is unknown', async () => {
    const american: Settings = {
      ...alberta,
      country: 'US',
      subdivision: undefined,
      currency: 'USD',
    };
    (TestBed.inject(SettingsStore).saved as WritableSignal<Settings | undefined>).set(american);
    await show(resultFor('crave', { q: 'crave' }, [], american));

    // No + tax: a US user who gave no rate has none added.
    expect(shown('.prices')).toBe('≈ $8.68 / mo No price for United States yet');
  });

  it('lists the resellers that sell the plan for less, linking to their pages', async () => {
    await show(resultFor('mullvad'));

    expect(shown('.deals')).toBe('Cheaper at Amazon $87.00 / 12 mo + tax');
    const link = query<HTMLAnchorElement>('.deals a');
    expect([link?.href, link?.target, link?.rel]).toEqual([
      'https://www.amazon.ca/dp/B092M5G1G7/',
      '_blank',
      'noopener',
    ]);
    expect(link?.querySelector('img')?.getAttribute('src')).toBe('icons/amazon.webp');
  });

  it('expands to the plan’s details, and says so to screen readers', async () => {
    await show(resultFor('netflix'));
    const button = query<HTMLButtonElement>('button.expand');
    const details = query(`#${button?.getAttribute('aria-controls')}`);

    expect(button?.getAttribute('aria-label')).toBe('Details: Netflix Standard with ads');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(details?.hidden).toBe(true);
    expect(query('ss-plan-details')).toBeNull();

    button?.click();
    await fixture.whenStable();

    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(details?.hidden).toBe(false);
    expect(query('ss-plan-details')).not.toBeNull();
  });
});

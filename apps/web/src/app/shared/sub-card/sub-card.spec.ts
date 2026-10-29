import { signal, type WritableSignal } from '@angular/core';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatMenuHarness } from '@angular/material/menu/testing';
import { MatTooltipHarness } from '@angular/material/tooltip/testing';
import { Router, provideRouter } from '@angular/router';
import {
  searchCatalog,
  type CatalogQuery,
  type CatalogResult,
  type ListItem,
  type ProfileRanks,
  type Settings,
  type SubscriptionList,
} from '@simply-sub/core';
import { SettingsStore } from '../../core/settings/settings-store';
import { ItemsRepository } from '../../core/storage/items-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import { alberta, fx, listItem, searchCatalogData, searchStores, today } from './search.testing';
import { SubCard } from './sub-card';

const work = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const family = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';

function list(id: string, name: string): SubscriptionList {
  return { id, name, createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };
}

/** The provider's result as Search would give it. */
function resultFor(
  id: string,
  query: CatalogQuery = {},
  items: ListItem[] = [],
  settings: Settings = alberta,
  profileRanks?: ProfileRanks,
): CatalogResult {
  const found = searchCatalog(query, {
    catalog: searchCatalogData,
    settings,
    fx,
    items,
    today,
    profileRanks,
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
        {
          provide: ListsRepository,
          useValue: {
            records: signal<readonly SubscriptionList[]>([
              list(work, 'Work Related'),
              list(family, 'Family – Sam'),
            ]),
          },
        },
        {
          provide: ItemsRepository,
          useValue: { records: signal<readonly ListItem[]>([listItem('crave.basic', work)]) },
        },
        provideRouter([]),
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
      text:
        link.getAttribute('aria-label') ??
        link.textContent?.replace('open_in_new', '').replace(/\s+/g, ' ').trim(),
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

  describe('the Add to list menu', () => {
    /** Opens the menu of the card's price at `index`, among its triggers. */
    async function openMenu(index = 0): Promise<MatMenuHarness> {
      const menus =
        await TestbedHarnessEnvironment.documentRootLoader(fixture).getAllHarnesses(MatMenuHarness);
      await menus[index].open();
      return menus[index];
    }

    it('opens from a price, with each list and its count, then New list…', async () => {
      await show(resultFor('netflix'));
      const menu = await openMenu();

      expect(await Promise.all((await menu.getItems()).map((item) => item.getText()))).toEqual([
        'Work Related (1)',
        'Family – Sam (0)',
        'addNew list…',
      ]);
      // Each list's name is one string, with no stray space before its comma.
      expect(
        Array.from(document.querySelectorAll('.mat-mdc-menu-item')).map((item) =>
          item.getAttribute('aria-label'),
        ),
      ).toEqual(['Work Related, 1 subscription', 'Family – Sam, 0 subscriptions', null]);
      expect(document.querySelector('.mat-mdc-menu-panel')?.getAttribute('aria-label')).toBe(
        'Add to list',
      );
    });

    it('opens the list’s editor with the plan and the period clicked', async () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      await show(resultFor('netflix'));
      radios()[1].click();
      await fixture.whenStable();
      // Standard's second price is yearly.
      const menu = await openMenu(1);
      await menu.clickItem({ text: /^Family/ });

      expect(navigate).toHaveBeenCalledWith(['/lists', family, 'edit'], {
        queryParams: { add: 'netflix.standard', interval: 'year' },
      });
    });

    it('opens a new list’s editor from New list…', async () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      await show(resultFor('netflix'));
      await (await openMenu()).clickItem({ text: /New list/ });

      expect(navigate).toHaveBeenCalledWith(['/lists', 'new'], {
        queryParams: { add: 'netflix.standard-ads', interval: 'month' },
      });
    });

    it('opens from a bundle’s price in the details, with the bundle', async () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      await show(resultFor('crave'));
      radios()[1].click();
      await fixture.whenStable();
      query<HTMLButtonElement>('button.expand')?.click();
      await fixture.whenStable();
      // Crave Premium's own price, then the Netflix and Crave bundle's.
      const menu = await openMenu(1);
      await menu.clickItem({ text: /^Work/ });

      expect(navigate).toHaveBeenCalledWith(['/lists', work, 'edit'], {
        queryParams: { addBundle: 'bundle.netflix-crave', interval: 'month' },
      });
    });
  });

  describe('in pick mode (M5.5)', () => {
    beforeEach(() => fixture.componentRef.setInput('pickList', list(work, 'Work Related')));

    const prices = () =>
      Array.from(element().querySelectorAll<HTMLButtonElement>('ss-price button'));

    it('adds a price’s plan and period to the list at once, with no menu', async () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      await show(resultFor('netflix'));
      radios()[1].click();
      await fixture.whenStable();
      // Standard's second price is yearly.
      const price = prices()[1];

      expect(price.hasAttribute('aria-haspopup')).toBe(false);
      expect(price.textContent).toContain('$189.99 / year a year, add to Work Related');
      price.click();
      await fixture.whenStable();
      expect(document.querySelector('.mat-mdc-menu-panel')).toBeNull();
      expect(navigate).toHaveBeenCalledWith(['/lists', work, 'edit'], {
        queryParams: { add: 'netflix.standard', interval: 'year' },
      });
    });

    it('adds a reseller’s price as the plan, with the shop’s price as the item’s own', async () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      await show(resultFor('mullvad'));
      const price = query<HTMLButtonElement>('.deals ss-price button');

      expect(price?.textContent).toContain(
        '$87.00 / 12 mo every 12 months, add to Work Related at Amazon’s price',
      );
      price?.click();
      await fixture.whenStable();
      // Amazon.ca's price leaves tax to be added in Canada.
      expect(navigate).toHaveBeenCalledWith(['/lists', work, 'edit'], {
        queryParams: {
          add: 'mullvad.vpn',
          interval: 'month',
          count: '12',
          price: '87',
          currency: 'CAD',
          plusTax: '1',
        },
      });
    });

    it('adds a bundle’s price in the details as the bundle', async () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      await show(resultFor('crave'));
      radios()[1].click();
      await fixture.whenStable();
      query<HTMLButtonElement>('button.expand')?.click();
      await fixture.whenStable();
      // Crave Premium's own price, then the Netflix and Crave bundle's.
      const price = prices()[1];
      expect(price.closest('ss-plan-details')).not.toBeNull();
      expect(price.hasAttribute('aria-haspopup')).toBe(false);
      price.click();
      await fixture.whenStable();

      expect(document.querySelector('.mat-mdc-menu-panel')).toBeNull();
      expect(navigate).toHaveBeenCalledWith(['/lists', work, 'edit'], {
        queryParams: { addBundle: 'bundle.netflix-crave', interval: 'month' },
      });
    });
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
    // Words, not a button, when it isn't given the lists' names.
    expect(query('.in-lists')).toBeNull();

    await show(resultFor('crave', {}, [listItem('crave.premium', work, true)]));
    expect(shown('ss-status-badge')).toBe('Inactive · 1 list');
  });

  it('says which bundle the user has a provider through (M7.11)', async () => {
    const bundled = {
      ...listItem('crave.premium', work),
      source: { kind: 'bundle' as const, bundleId: 'bundle.netflix-crave' },
    };
    await show(resultFor('crave', {}, [bundled]));
    expect(shown('ss-status-badge')).toBe('Active · 1 list · in Netflix and Crave');
  });

  it('names the lists that have the provider on hover, and opens a menu of them', async () => {
    fixture.componentRef.setInput(
      'listNames',
      new Map([
        [work, 'Work Related'],
        [family, 'Family – Sam'],
      ]),
    );
    const items = [listItem('netflix.standard', work), listItem('netflix.standard', family)];
    await show(resultFor('netflix', {}, items));

    expect(shown('ss-status-badge')).toBe('Active · 2 lists');
    const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
    const tooltip = await loader.getHarness(MatTooltipHarness.with({ selector: '.in-lists' }));
    await tooltip.show();
    expect(await tooltip.getTooltipText()).toBe('In Work Related and Family – Sam');

    const menu = await loader.getHarness(MatMenuHarness.with({ selector: '.in-lists' }));
    await menu.open();
    const panel = document.querySelector('[role=menu]');
    expect(panel?.getAttribute('aria-label')).toBe('Lists with Netflix');
    const lists = Array.from(panel?.querySelectorAll('a') ?? [], (link) => [
      link.textContent?.trim(),
      link.getAttribute('href'),
    ]);
    expect(lists).toEqual([
      ['Work Related', `/lists/${work}`],
      ['Family – Sam', `/lists/${family}`],
    ]);
  });

  it('counts the user’s ranks of the plan shown, and shows none when they rank none of its features', async () => {
    const ranks: ProfileRanks = new Map([
      ['video.quality=1080p', 'needed'],
      ['streaming.ad-free', 'unwanted'],
      ['vpn.included', 'wanted'],
    ]);
    await show(resultFor('netflix', {}, [], alberta, ranks));

    // Standard with ads has 1080p, and ads.
    expect(shown('.ranks')).toBe('1 Needed');
    expect(query('.ranks')?.getAttribute('aria-label')).toBe(
      'Your ranks for Netflix Standard with ads',
    );

    radios()[1].click();
    await fixture.whenStable();
    expect(shown('.ranks')).toBe('1 Needed 1 Unwanted');

    // Crave Basic has none of them: 4K isn't ranked.
    await show(resultFor('crave', {}, [], alberta, new Map([['video.quality=4k', 'needed']])));
    expect(query('.ranks')).toBeNull();
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
    expect(details?.children.length).toBe(0);
    expect(query('ss-plan-details')).toBeNull();

    button?.click();
    await fixture.whenStable();

    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(details?.querySelector('ss-plan-details')).not.toBeNull();
  });

  describe('the open details (M5.7)', () => {
    let scrolled: ReturnType<typeof vi.fn<HTMLElement['scrollIntoView']>>;

    beforeEach(() => {
      // The test DOM has no scrolling.
      scrolled = vi.fn<HTMLElement['scrollIntoView']>();
      HTMLElement.prototype.scrollIntoView = scrolled;
    });

    afterEach(() => {
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    });

    it('close from their foot, and focus goes back to the details button', async () => {
      await show(resultFor('netflix'));
      query<HTMLButtonElement>('button.expand')?.click();
      await fixture.whenStable();
      const hide = query<HTMLButtonElement>('button.collapse');

      expect(hide?.textContent?.replace('expand_less', '').trim()).toBe('Hide details');
      expect(hide?.getAttribute('aria-label')).toBe('Hide details: Netflix Standard with ads');
      hide?.click();
      await fixture.whenStable();

      expect(query('ss-plan-details')).toBeNull();
      expect(query<HTMLButtonElement>('button.expand')?.getAttribute('aria-expanded')).toBe(
        'false',
      );
      expect(document.activeElement).toBe(query('button.expand'));
    });

    it('keep the card on screen as they open and close', async () => {
      // Each scroll waits for its slide, which the test DOM doesn't run.
      const slid = async () => {
        await fixture.whenStable();
        await new Promise((resolve) => setTimeout(resolve));
        await fixture.whenStable();
      };
      await show(resultFor('netflix'));
      query<HTMLButtonElement>('button.expand')?.click();
      await slid();
      expect(scrolled).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });

      query<HTMLButtonElement>('button.collapse')?.click();
      await slid();
      expect(query('ss-plan-details')).toBeNull();
      expect(scrolled).toHaveBeenCalledTimes(2);
      expect(scrolled.mock.contexts.every((card) => card === fixture.nativeElement)).toBe(true);
    });
  });

  it('puts the plan chips right below the names, before the links and prices', async () => {
    await show(resultFor('netflix'));
    const parts = Array.from(query('.head')?.children ?? []).map((child) => child.classList[0]);

    expect(parts).toEqual(['icon', 'title', 'plans', 'links', 'prices']);
  });

  it('shows a lone plan’s chip too, which isn’t a control', async () => {
    await show(resultFor('mullvad'));
    const plans = query('.plans');

    expect(plans?.textContent?.replace('check', '').trim()).toBe('Mullvad VPN');
    expect(plans?.getAttribute('aria-hidden')).toBe('true');
    expect(plans?.querySelector('input')).toBeNull();
  });
});

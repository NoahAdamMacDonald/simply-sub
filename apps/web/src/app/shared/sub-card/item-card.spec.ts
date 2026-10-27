import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resolveItem, type ListItem, type ResolvedItem } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { ClockService } from '../../core/clock/clock-service';
import { ItemCard } from './item-card';
import { alberta, fx, listItem, searchCatalogData, today } from './search.testing';

// List view's card (P4) on Search's small catalog, for an Albertan.

function resolved(planId: string, extra: Partial<ListItem> = {}): ResolvedItem {
  const result = resolveItem(
    { ...listItem(planId, '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d'), ...extra },
    {
      catalog: searchCatalogData,
      customSubs: new Map(),
      country: alberta.country,
      currency: alberta.currency,
      fx,
      today,
      profileRanks: new Map(),
    },
  );
  if (!result.ok) throw new Error(result.unresolved.reason);
  return result.resolved;
}

describe('ItemCard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ClockService, useValue: { today: signal(today) } },
        { provide: CatalogStore, useValue: { catalog: signal(searchCatalogData) } },
      ],
    });
  });

  function render(item: ResolvedItem) {
    const fixture = TestBed.createComponent(ItemCard);
    fixture.componentRef.setInput('resolved', item);
    fixture.detectChanges();
    return fixture;
  }

  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim();

  async function facts(item: ResolvedItem): Promise<(string | undefined)[]> {
    const fixture = render(item);
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLElement>('.expand')?.click();
    await fixture.whenStable();
    return Array.from(element.querySelectorAll('.facts li')).map((fact) => text(fact));
  }

  it('names a plan with its provider, and one named after it alone', () => {
    const netflix = render(resolved('netflix.standard')).nativeElement as HTMLElement;
    expect(text(netflix.querySelector('h3'))).toBe('Netflix');
    expect(text(netflix.querySelector('.plan-name'))).toBe('Standard');
    expect(netflix.querySelector('.pin')?.getAttribute('aria-label')).toBe('Pin Netflix Standard');
    const mullvad = render(
      resolved('mullvad.vpn', {
        billing: {
          mode: 'recurring',
          interval: 'year',
          intervalCount: 1,
          anchorDate: '2027-01-20',
          autoRenew: false,
        },
      }),
    ).nativeElement as HTMLElement;
    expect(text(mullvad.querySelector('h3'))).toBe('Mullvad VPN');
    expect(mullvad.querySelector('.plan-name')).toBeNull();
  });

  it('says how it’s billed, since when, its add-ons, its own price and where it was bought', async () => {
    expect(
      await facts(
        resolved('netflix.standard', {
          billing: {
            mode: 'recurring',
            interval: 'month',
            intervalCount: 1,
            anchorDate: '2026-11-12',
            startDate: '2025-03-12',
            endDate: '2027-03-12',
            autoRenew: true,
          },
          source: {
            kind: 'catalog',
            planId: 'netflix.standard',
            addOns: [{ id: 'netflix.extra-member', quantity: 2 }],
          },
          priceOverride: { amount: 9.99, currency: 'CAD', until: '2026-12-31' },
          region: 'US',
        }),
      ),
    ).toEqual([
      'Monthly · auto-renews · ends Mar 12, 2027',
      'Subscribed since Mar 12, 2025',
      'Add-on: Extra member × 2',
      'Your own price until Dec 31, 2026',
      'Bought in United States',
    ]);
  });

  it('says an own price with no end date is the item’s own', async () => {
    expect(
      await facts(
        resolved('netflix.standard', { priceOverride: { amount: 0.01, currency: 'CAD' } }),
      ),
    ).toEqual(['Monthly · auto-renews', 'Your own price']);
  });

  it('emits the pin it should have, and shows it pressed when pinned', () => {
    const fixture = render(resolved('netflix.standard', { pinned: true }));
    const pins: boolean[] = [];
    fixture.componentInstance.pinToggle.subscribe((pinned) => pins.push(pinned));
    const pin = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.pin');
    expect(pin?.getAttribute('aria-pressed')).toBe('true');
    pin?.click();
    expect(pins).toEqual([false]);
  });
});

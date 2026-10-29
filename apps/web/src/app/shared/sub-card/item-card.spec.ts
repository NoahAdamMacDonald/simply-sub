import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  resolveItem,
  type CustomSubscription,
  type ListItem,
  type ResolvedItem,
} from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { ClockService } from '../../core/clock/clock-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { WrongDate } from '../wrong-date/wrong-date';
import { ItemCard } from './item-card';
import { alberta, fx, listItem, searchCatalogData, today } from './search.testing';

// List view's card (P4) on Search's small catalog, for an Albertan.

const gymId = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c50';
const gymPlanId = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c51';
const gym: CustomSubscription = {
  id: gymId,
  name: 'Gym',
  plans: [
    {
      id: gymPlanId,
      name: 'Monthly',
      features: {},
      price: { amount: 40, currency: 'CAD', interval: 'month', intervalCount: 1 },
      autoRenewAvailable: true,
    },
  ],
  createdAt: '2026-10-20T12:00:00.000Z',
  updatedAt: '2026-10-20T12:00:00.000Z',
};

function resolved(planId: string, extra: Partial<ListItem> = {}): ResolvedItem {
  const result = resolveItem(
    { ...listItem(planId, '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d'), ...extra },
    {
      catalog: searchCatalogData,
      customSubs: new Map([[gymId, gym]]),
      country: alberta.country,
      currency: alberta.currency,
      fx,
      today,
      profileRanks: new Map(),
      taxPlace: alberta,
    },
  );
  if (!result.ok) throw new Error(result.unresolved.reason);
  return result.resolved;
}

describe('ItemCard', () => {
  let asked: unknown[][];

  beforeEach(() => {
    asked = [];
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ClockService, useValue: { today: signal(today) } },
        { provide: CatalogStore, useValue: { catalog: signal(searchCatalogData) } },
        { provide: SettingsStore, useValue: { saved: signal(alberta) } },
        {
          provide: WrongDate,
          useValue: {
            ask: async (...args: unknown[]) => {
              asked.push(args);
              return true;
            },
          },
        },
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

  it('lists its add-ons under its names, each with its price for all it has (M6.12)', () => {
    const card = render(
      resolved('netflix.standard', {
        source: {
          kind: 'catalog',
          planId: 'netflix.standard',
          addOns: [{ id: 'netflix.extra-member', quantity: 2 }],
        },
      }),
    ).nativeElement as HTMLElement;
    const addOns = card.querySelector('.head .add-ons');
    expect(addOns?.getAttribute('aria-label')).toBe('Add-ons');
    // Two extra members at $7.99 each; the plan's own price tag stays the plan's.
    expect(text(addOns?.querySelector('li'))).toBe('+ Extra member × 2 $15.98 / mo a month + tax');
    expect(text(card.querySelector('.price ss-price'))).toBe('$18.99 / mo a month + tax');
    expect(render(resolved('netflix.standard')).nativeElement.querySelector('.add-ons')).toBeNull();
  });

  it('says how it’s billed, since when, its own price and where it was bought', async () => {
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
      'Monthly · auto-renews until Mar 12, 2027',
      'Subscribed since Mar 12, 2025',
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

  it('shows a nickname over the plan, and names its buttons with both', () => {
    const element = render(resolved('netflix.standard', { nickname: "Mom's" }))
      .nativeElement as HTMLElement;
    expect(text(element.querySelector('h3'))).toBe("Mom's");
    expect(text(element.querySelector('.plan-name'))).toBe('Netflix Standard');
    expect(element.querySelector('.pin')?.getAttribute('aria-label')).toBe(
      "Pin Mom's (Netflix Standard)",
    );
    expect(element.querySelector('.expand')?.getAttribute('aria-label')).toBe(
      "Details: Mom's (Netflix Standard)",
    );
  });

  it('shows its note in the details, with the lines it was typed with', async () => {
    const fixture = render(resolved('netflix.standard', { note: 'Paid by Dad\nShared' }));
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLElement>('.expand')?.click();
    await fixture.whenStable();
    expect(text(element.querySelector('.item-note h4'))).toBe('Note');
    expect(element.querySelector('.item-note p')?.textContent).toBe('Paid by Dad\nShared');
  });

  it('links a plan to its provider in Search, a bundle to its seller, and a custom plan nowhere', async () => {
    const view = async (item: ResolvedItem) => {
      const fixture = render(item);
      const element = fixture.nativeElement as HTMLElement;
      element.querySelector<HTMLElement>('.expand')?.click();
      await fixture.whenStable();
      const link = element.querySelector('a.view');
      return link && [link.getAttribute('href'), link.getAttribute('aria-label')];
    };
    // The plan's own card in Search shows this plan, not the user's other Netflix plan (M5.11).
    expect(await view(resolved('netflix.standard', { nickname: "Mom's" }))).toEqual([
      '/search?q=Netflix&plan=netflix.standard',
      "View in Search, Mom's (Netflix Standard)",
    ]);
    expect(
      await view(resolved('', { source: { kind: 'bundle', bundleId: 'bundle.netflix-crave' } })),
    ).toEqual(['/search?q=Crave', 'View in Search, Netflix and Crave']);
    expect(
      await view(
        resolved('', { source: { kind: 'custom', customSubId: gymId, customPlanId: gymPlanId } }),
      ),
    ).toBeNull();
  });

  it('gives its share of the list’s next 12 months, a sliver as under 1%, and nothing without one (M7.2)', () => {
    const shareOf = (share: number | undefined) => {
      const fixture = TestBed.createComponent(ItemCard);
      fixture.componentRef.setInput('resolved', resolved('netflix.standard'));
      fixture.componentRef.setInput('share', share);
      fixture.detectChanges();
      return text((fixture.nativeElement as HTMLElement).querySelector('.share'));
    };
    expect(shareOf(0.3149)).toBe('31% of list over the next 12 months');
    expect(shareOf(0.003)).toBe('<1% of list over the next 12 months');
    expect(shareOf(0)).toBeUndefined();
    expect(shareOf(undefined)).toBeUndefined();
  });

  describe('its next charge (M7.1)', () => {
    it('says when, and what it costs as charged, with tax, and offers Wrong date?', async () => {
      const netflix = resolved('netflix.standard');
      const fixture = render(netflix);
      const element = fixture.nativeElement as HTMLElement;
      element.querySelector<HTMLElement>('.expand')?.click();
      await fixture.whenStable();
      // $18.99 and Alberta's 5%.
      expect(text(element.querySelector('.next-charge > span [aria-hidden]'))).toBe(
        '$19.94, with $0.95 tax',
      );
      expect(text(element.querySelector('.next-charge > span'))).toContain(
        'Next charge Nov 10, 2026:',
      );
      const wrong = element.querySelector<HTMLButtonElement>('.wrong-date');
      expect(wrong?.getAttribute('aria-label')).toBe('Wrong date? Netflix Standard');

      wrong?.click();
      await fixture.whenStable();
      expect(asked).toEqual([[netflix.item, 'Netflix Standard', '2026-11-10']]);
    });

    it('shows a manual renewal and an end date on its status', () => {
      const manual = resolved('netflix.standard', {
        billing: {
          mode: 'recurring',
          interval: 'month',
          intervalCount: 1,
          anchorDate: '2026-09-10',
          endDate: '2026-11-20',
          autoRenew: false,
        },
      });
      const element = render(manual).nativeElement as HTMLElement;
      expect(
        Array.from(element.querySelectorAll('ss-status-badge .badge')).map((badge) =>
          text(badge)?.replace('autorenew', '').trim(),
        ),
      ).toEqual(['Renew by Nov 10, then ends Nov 20']);
    });

    it('has no Wrong date? for Specific dates, which have no anchor to move', async () => {
      const windows = resolved('netflix.standard', {
        billing: {
          mode: 'limited',
          windows: [{ start: '2026-11-02', end: '2026-12-15', repeatYearly: false }],
          interval: 'month',
          intervalCount: 1,
        },
      });
      const fixture = render(windows);
      const element = fixture.nativeElement as HTMLElement;
      element.querySelector<HTMLElement>('.expand')?.click();
      await fixture.whenStable();
      expect(text(element.querySelector('.next-charge'))).toContain('Next charge Nov 2, 2026:');
      expect(element.querySelector('.wrong-date')).toBeNull();
    });
  });
});

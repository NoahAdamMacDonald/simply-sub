import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { resolveItem, type CatalogData, type ListItem, type ResolvedItem } from '@simply-sub/core';
import { SettingsStore } from '../../core/settings/settings-store';
import { ItemsRepository } from '../../core/storage/items-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import { testStorage, until } from '../../core/storage/storage.testing';
import { alberta, fx, searchCatalogData, today } from '../sub-card/search.testing';
import { BillingCheck } from './billing-check';

// Check your billing (P2, P4, M10.28) on Search's small catalog, with Netflix Standard's monthly price no longer sold:
// an item billed monthly counts as yearly from its renewal, and its user switches, cancels or keeps it.

/** The catalog with Netflix Standard's monthly price retired, or every price of it with `all`. */
function retired(all = false): CatalogData {
  return {
    ...searchCatalogData,
    providers: searchCatalogData.providers.map((provider) => ({
      ...provider,
      plans: provider.plans.map((plan) =>
        plan.id === 'netflix.standard'
          ? {
              ...plan,
              prices: plan.prices.map((price) =>
                all || price.interval === 'month' ? { ...price, retired: '2026-10-20' } : price,
              ),
            }
          : plan,
      ),
    })),
  };
}

describe('BillingCheck', () => {
  let items: ItemsRepository;
  let netflix: ListItem;

  beforeEach(async () => {
    const storage = testStorage();
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        { provide: SettingsStore, useValue: { saved: signal(alberta) } },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    items = TestBed.inject(ItemsRepository);
    const list = await TestBed.inject(ListsRepository).create({ name: 'Work Related' });
    netflix = await items.create({
      listId: list.id,
      source: { kind: 'catalog', planId: 'netflix.standard' },
      billing: {
        mode: 'recurring',
        interval: 'month',
        intervalCount: 1,
        anchorDate: '2026-11-12',
        autoRenew: true,
      },
      tagIds: [],
      rankOverrides: {},
      pinned: false,
    });
  });

  function resolved(item: ListItem, data = retired()): ResolvedItem {
    const result = resolveItem(item, {
      catalog: data,
      customSubs: new Map(),
      country: 'CA',
      currency: 'CAD',
      fx,
      today,
      profileRanks: new Map(),
      taxPlace: alberta,
    });
    if (!result.ok) throw new Error(result.unresolved.reason);
    return result.resolved;
  }

  function render(item: ResolvedItem): HTMLElement {
    const fixture = TestBed.createComponent(BillingCheck);
    fixture.componentRef.setInput('resolved', item);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim();
  /** A choice by its name: its words and the hidden ones naming the item. */
  const button = (element: HTMLElement, label: string) =>
    Array.from(element.querySelectorAll('button')).find((choice) => text(choice) === label) ?? null;
  const stored = () => items.byId().get(netflix.id);
  /** The stored item's end date, if it has one. */
  const endDate = () => {
    const billing = stored()?.billing;
    return billing?.mode === 'recurring' ? billing.endDate : undefined;
  };

  async function undo(message: string): Promise<void> {
    const snack = () => document.querySelector('.mat-mdc-snack-bar-container');
    await until(
      () => text(snack()?.querySelector('ss-snack .mat-mdc-snack-bar-label')) === message,
    );
    Array.from(snack()?.querySelectorAll('button') ?? [])
      .find((element) => text(element) === 'Undo')
      ?.click();
  }

  it('says what changes and when, with the plan’s page and three choices', () => {
    const element = render(resolved(netflix));
    element.querySelectorAll('mat-icon').forEach((icon) => icon.remove());
    expect(text(element.querySelector('p'))).toBe(
      'Netflix Standard isn’t sold billed monthly any more. From Nov 12, 2026 it counts as yearly, at $189.99. ' +
        'Check your billing for Netflix Standard, opens in a new tab',
    );
    expect(element.querySelector('a')?.getAttribute('href')).toBe(
      'https://www.netflix.com/signup/standard',
    );
    expect(Array.from(element.querySelectorAll('button')).map(text)).toEqual([
      'Switch Netflix Standard to yearly',
      'Cancel Netflix Standard at renewal',
      'Keep Netflix Standard monthly',
    ]);
  });

  it('offers no switch when nothing else is sold', () => {
    const element = render(resolved(netflix, retired(true)));
    expect(text(element.querySelector('p span'))).toBe(
      'Netflix Standard isn’t sold billed monthly any more. No other period is, so it counts as before until you choose.',
    );
    expect(button(element, 'Switch Netflix Standard to yearly')).toBeNull();
  });

  it('switches the item to yearly from its renewal, with Undo', async () => {
    await until(() => stored() !== undefined);
    button(render(resolved(netflix)), 'Switch Netflix Standard to yearly')?.click();
    await until(() => stored()?.billing.interval === 'year');
    expect(stored()?.billing).toEqual({ ...netflix.billing, interval: 'year' });
    await undo('Netflix Standard is billed yearly from Nov 12, 2026');
    await until(() => stored()?.billing.interval === 'month');
  });

  it('cancels it at the renewal, with Undo', async () => {
    await until(() => stored() !== undefined);
    button(render(resolved(netflix)), 'Cancel Netflix Standard at renewal')?.click();
    await until(() => endDate() !== undefined);
    expect(stored()?.billing).toEqual({ ...netflix.billing, endDate: '2026-11-12' });
    await undo('Netflix Standard ends on Nov 12, 2026');
    await until(() => endDate() === undefined);
  });

  it('keeps it, grandfathered, which ends the check, with Undo', async () => {
    await until(() => stored() !== undefined);
    button(render(resolved(netflix)), 'Keep Netflix Standard monthly')?.click();
    await until(() => stored()?.grandfathered === true);
    const kept = stored();
    expect(kept && resolved(kept).periodChange).toBeUndefined();
    await undo('Netflix Standard stays billed monthly');
    await until(() => stored()?.grandfathered === undefined);
  });
});

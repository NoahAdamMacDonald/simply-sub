import { signal } from '@angular/core';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatTooltipHarness } from '@angular/material/tooltip/testing';
import {
  pickPrice,
  type FxRates,
  type PickedPrice,
  type Price,
  type Settings,
} from '@simply-sub/core';
import { SettingsStore } from '../../core/settings/settings-store';
import { PriceTag } from './price-tag';

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

function listed(region: string, currency: string, amount: number, extra?: Partial<Price>): Price {
  return {
    region,
    currency,
    amount,
    interval: 'month',
    intervalCount: 1,
    autoRenew: true,
    lastVerified: '2026-10-20',
    ...extra,
  };
}

/** What pickPrice gives a Canadian showing CAD, with the rates, or none (null). */
function picked(price: Price, rates: FxRates | null = fx): PickedPrice {
  return pickPrice([price], { region: 'CA', currency: 'CAD', ...(rates && { fx: rates }) })[0];
}

const netflix = picked(listed('CA', 'CAD', 18.99));
const mullvad = picked(listed('GLOBAL', 'EUR', 5, { taxIncluded: { quote: 'Including VAT.' } }));
const usOnly = picked(listed('US', 'USD', 9.99));

describe('PriceTag', () => {
  let saved: ReturnType<typeof signal<Settings | undefined>>;
  let fixture: ComponentFixture<PriceTag>;

  beforeEach(() => {
    saved = signal<Settings | undefined>(ontario);
    TestBed.configureTestingModule({
      providers: [
        { provide: SettingsStore, useValue: { saved } },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    fixture = TestBed.createComponent(PriceTag);
  });

  async function show(price: PickedPrice, inputs: { clickable?: boolean; region?: string } = {}) {
    fixture.componentRef.setInput('price', price);
    if (inputs.clickable) fixture.componentRef.setInput('clickable', true);
    if (inputs.region) fixture.componentRef.setInput('region', inputs.region);
    await fixture.whenStable();
  }

  const element = () => fixture.nativeElement as HTMLElement;
  /** What's on screen, without the icon's ligature or the screen-reader-only words. */
  const shown = () => {
    const copy = element().cloneNode(true) as HTMLElement;
    copy.querySelectorAll('mat-icon, .visually-hidden').forEach((node) => node.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  };
  /** What a screen reader reads, roughly: everything not aria-hidden. */
  const spoken = () => {
    const copy = element().cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  };
  const icon = () => element().querySelector('mat-icon');

  it('shows a native price with its period, and "+ tax" in Canada', async () => {
    await show(netflix);
    expect(shown()).toBe('$18.99 / mo + tax');
    expect(spoken()).toBe('$18.99 a month + tax');
    expect(icon()).toBeNull();
  });

  it('marks a converted price with ≈ and the icon, and says it in words', async () => {
    await show(picked(listed('US', 'USD', 9.99)));
    expect(shown()).toBe('≈ $13.79 / mo + tax');
    expect(spoken()).toBe('about $13.79 a month + tax');
    expect(icon()?.textContent).toBe('currency_exchange');
  });

  it('says "incl. tax" on a price that includes it (Mullvad)', async () => {
    await show(mullvad);
    expect(shown()).toBe('≈ $7.53 / mo incl. tax');
  });

  it('shows a price with no rate to convert it in its own currency, with the icon but no ≈', async () => {
    await show(picked(listed('GLOBAL', 'USD', 9.99), null));
    expect(shown()).toBe('US$9.99 / mo + tax');
    expect(icon()).not.toBeNull();
  });

  it('shows "Free" with nothing else', async () => {
    await show(picked(listed('CA', 'CAD', 0)));
    expect(shown()).toBe('Free');
    expect(icon()).toBeNull();
  });

  it('has no tax note outside Canada and the US, or for a US buyer who gave no rate', async () => {
    saved.set({ ...ontario, country: 'GB', subdivision: undefined, currency: 'GBP' });
    await show(netflix);
    expect(shown()).toBe('CA$18.99 / mo');

    saved.set({ ...ontario, country: 'US', subdivision: 'US-NY', currency: 'USD' });
    await fixture.whenStable();
    expect(shown()).toBe('CA$18.99 / mo');
    await show(mullvad);
    expect(shown()).toContain('incl. tax');
  });

  it("follows the tax rule of the region an item was bought in, without the user's rate", async () => {
    await show(usOnly, { region: 'US' });
    expect(shown()).toBe('≈ $13.79 / mo');
  });

  describe('when clickable', () => {
    it('is a button that emits the price, with the tooltip on it', async () => {
      await show(mullvad, { clickable: true });
      const emitted: PickedPrice[] = [];
      fixture.componentInstance.priceSelect.subscribe((price) => emitted.push(price));
      const button = element().querySelector('button')!;
      expect(button.textContent?.replace(/\s+/g, ' ')).toContain('$7.53');
      button.click();
      expect(emitted).toEqual([mullvad]);

      const tooltip = await TestbedHarnessEnvironment.loader(fixture).getHarness(MatTooltipHarness);
      await tooltip.show();
      expect(await tooltip.getTooltipText()).toBe(
        "Converted from 5.00 EUR at 1.506 on 2026-10-21. You'll be charged in EUR.",
      );
    });

    it('has no tooltip for a native price', async () => {
      await show(netflix, { clickable: true });
      const tooltip = await TestbedHarnessEnvironment.loader(fixture).getHarness(MatTooltipHarness);
      expect(await tooltip.isDisabled()).toBe(true);
    });
  });

  it('puts the tooltip on a focusable icon when the price is not clickable', async () => {
    await show(picked(listed('GLOBAL', 'USD', 9.99), null));
    expect(element().querySelector('button')).toBeNull();
    const details = element().querySelector<HTMLElement>('.fx-details')!;
    expect(details.tabIndex).toBe(0);
    expect(details.getAttribute('aria-label')).toBe('Currency');
    const tooltip = await TestbedHarnessEnvironment.loader(fixture).getHarness(MatTooltipHarness);
    await tooltip.show();
    expect(await tooltip.getTooltipText()).toBe(
      "There's no exchange rate yet, so this is the price in USD.",
    );
  });
});

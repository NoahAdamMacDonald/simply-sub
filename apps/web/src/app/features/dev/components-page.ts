import { Component, computed, inject, signal } from '@angular/core';
import {
  pickPrice,
  type FxRates,
  type Interval,
  type PickedPrice,
  type Price,
} from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { FxStore } from '../../core/fx/fx-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { PriceTag } from '../../shared/price-tag/price-tag';
import { amountText, intervalText } from '../../shared/price-tag/price-text';

/** GET /fx's example rates, so the fixed cases convert the same way on every visit. */
const exampleRates: FxRates = {
  base: 'CAD',
  date: '2026-10-21',
  source: 'European Central Bank via Frankfurter',
  rates: { EUR: 0.664, GBP: 0.5571, USD: 0.7243 },
};

interface PriceCase {
  name: string;
  price: PickedPrice;
  /** ListItem.region, for an item bought outside the user's country. */
  region?: string;
}

/**
 * The shared components in both themes, with the user's settings (PROJECT-PLAN M4.5). Development builds only
 * (dev-routes.ts). It starts with ss-price (M4.4): fixed cases, and every plan of the user's catalog.
 */
@Component({
  selector: 'ss-components-page',
  imports: [PriceTag],
  templateUrl: './components-page.html',
  styleUrl: './components-page.scss',
})
export class ComponentsPage {
  private readonly settings = inject(SettingsStore);
  private readonly catalog = inject(CatalogStore);
  private readonly fx = inject(FxStore);

  protected readonly saved = this.settings.saved;
  protected readonly picked = signal('');

  /** One price per case, picked for the user's region and currency with the example rates. */
  protected readonly cases = computed<PriceCase[]>(() => {
    const saved = this.saved();
    if (!saved) return [];
    const { country: region, currency } = saved;
    // fx null: no rates, as on a first visit with /fx down.
    const pick = (price: Price, fx: FxRates | null = exampleRates) =>
      pickPrice([price], { region, currency, ...(fx && { fx }) })[0];
    return [
      { name: 'In your currency', price: pick(listed(region, currency, 18.99)) },
      { name: 'Converted', price: pick(listed('GLOBAL', 'EUR', 5)) },
      {
        name: 'Includes tax everywhere (Mullvad)',
        price: pick({ ...listed('GLOBAL', 'EUR', 5), taxIncluded: { quote: 'Including VAT.' } }),
      },
      { name: 'No exchange rate yet', price: pick(listed('GLOBAL', 'USD', 9.99), null) },
      { name: 'Free', price: pick(listed(region, currency, 0)) },
      { name: 'Yearly', price: pick(listed(region, currency, 169.99, 'year')) },
      { name: 'Every 3 months', price: pick(listed(region, currency, 45, 'month', 3)) },
      { name: 'Every 30 days', price: pick(listed(region, currency, 12, 'day', 30)) },
      {
        name: 'Bought in the US',
        price: pickPrice([listed('US', 'USD', 7.99)], {
          region: 'US',
          currency,
          fx: exampleRates,
        })[0],
        region: 'US',
      },
    ];
  });

  /** Every plan in the user's catalog, with its prices picked with the live rates. */
  protected readonly plans = computed(() => {
    const saved = this.saved();
    const data = this.catalog.catalog();
    if (!saved || !data) return [];
    const fx = this.fx.rates();
    return data.providers.flatMap((provider) =>
      provider.plans.map((plan) => ({
        id: plan.id,
        name: `${provider.name} · ${plan.name}`,
        prices: pickPrice(plan.prices, {
          region: saved.country,
          currency: saved.currency,
          ...(provider.billingCurrency && { billingCurrency: provider.billingCurrency }),
          ...(fx && { fx }),
        }),
      })),
    );
  });

  protected pick(price: PickedPrice): void {
    const amount = amountText(price.amount, price.currency, this.saved()?.country);
    this.picked.set(`Picked ${amount} ${intervalText(price.interval, price.intervalCount)}`);
  }
}

function listed(
  region: string,
  currency: string,
  amount: number,
  interval: Interval = 'month',
  intervalCount = 1,
): Price {
  return {
    region,
    currency,
    amount,
    interval,
    intervalCount,
    autoRenew: true,
    lastVerified: '2026-10-20',
  };
}

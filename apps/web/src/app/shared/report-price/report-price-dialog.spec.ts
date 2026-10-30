import type { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatRadioButtonHarness } from '@angular/material/radio/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import type { PickedPrice } from '@simply-sub/core';
import { firstValueFrom } from 'rxjs';
import { ReportPriceDialog, type ReportPriceData } from './report-price-dialog';

// Report a wrong price (M10.11): what it sends for each choice, the price filled in from the catalog's, and each refusal
// in words, with a stand-in for POST /api/v1/reports.

@Component({ template: '' })
class Host {}

const monthly: PickedPrice = {
  interval: 'month',
  intervalCount: 1,
  amount: 18.99,
  currency: 'CAD',
  monthlyEquivalent: 18.99,
  autoRenew: true,
  native: true,
  source: { region: 'CA', amount: 18.99, currency: 'CAD' },
};
const yearly: PickedPrice = {
  ...monthly,
  interval: 'year',
  amount: 189.99,
  monthlyEquivalent: 15.83,
  source: { region: 'CA', amount: 189.99, currency: 'CAD' },
};
const data: ReportPriceData = {
  plan: 'netflix.standard',
  title: 'Netflix Standard',
  prices: [monthly, yearly],
  country: 'CA',
};

describe('ReportPriceDialog', () => {
  let loader: HarnessLoader;
  let fetch: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>;
  let status: number;
  let closed: Promise<boolean | undefined>;

  beforeEach(async () => {
    status = 202;
    fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => new Response(null, { status }),
    );
    vi.stubGlobal('fetch', fetch);
    TestBed.configureTestingModule({
      providers: [{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
    });
    const fixture = TestBed.createComponent(Host);
    loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
    closed = firstValueFrom(
      TestBed.inject(MatDialog).open(ReportPriceDialog, { data }).afterClosed(),
    );
    await fixture.whenStable();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const dialogText = () =>
    document.querySelector('mat-dialog-container')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const amount = () => loader.getHarness(MatInputHarness.with({ selector: '.amount input' }));
  const send = async () =>
    (await loader.getHarness(MatButtonHarness.with({ text: /^(Send report|Sending…)$/ }))).click();
  /** What each POST sent. */
  const sent = () => fetch.mock.calls.map(([url, init]) => [url, JSON.parse(String(init.body))]);

  it('says what it reports on, and starts from a different price, filled in with the catalog’s', async () => {
    expect(dialogText()).toContain('Netflix Standard in Canada.');
    const different = await loader.getHarness(
      MatRadioButtonHarness.with({ label: 'The price is different' }),
    );
    expect(await different.isChecked()).toBe(true);
    expect(await (await amount()).getValue()).toBe('18.99');
    expect(await (await loader.getHarness(MatSelectHarness)).getValueText()).toBe('Monthly');
  });

  it('sends a different price, and closes once it’s sent', async () => {
    await (await amount()).setValue('20.99');
    await send();
    expect(sent()).toEqual([
      [
        '/api/v1/reports',
        {
          plan: 'netflix.standard',
          country: 'CA',
          problem: 'price',
          price: { amount: 20.99, currency: 'CAD', interval: 'month', intervalCount: 1 },
        },
      ],
    ]);
    expect(await closed).toBe(true);
  });

  it('fills in the price of the billing period chosen', async () => {
    const period = await loader.getHarness(MatSelectHarness);
    await period.open();
    await period.clickOptions({ text: 'Yearly' });
    expect(await (await amount()).getValue()).toBe('189.99');
    await send();
    expect(sent()[0][1]).toMatchObject({
      problem: 'price',
      price: { amount: 189.99, interval: 'year', intervalCount: 1 },
    });
  });

  it('sends that it’s not sold any more, or not sold in the user’s country, with no price', async () => {
    await (
      await loader.getHarness(MatRadioButtonHarness.with({ label: 'It’s not sold in Canada' }))
    ).check();
    expect(
      await loader.getHarnessOrNull(MatInputHarness.with({ selector: '.amount input' })),
    ).toBeNull();
    await send();
    expect(sent()).toEqual([
      ['/api/v1/reports', { plan: 'netflix.standard', country: 'CA', problem: 'not-in-country' }],
    ]);
  });

  it('refuses a price that isn’t one, sending nothing', async () => {
    await (await amount()).setValue('about 20');
    await send();
    expect(dialogText()).toContain('Type the price, such as 18.99');
    await (await amount()).setValue('0');
    await send();
    expect(dialogText()).toContain('Must be more than 0');
    await (await amount()).setValue('20.999');
    await send();
    expect(dialogText()).toContain('Use at most 2 decimals');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says why a report wasn’t taken: too many just now, or paused for today', async () => {
    status = 429;
    await send();
    expect(document.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'Too many reports were sent from here just now. Try again in a minute.',
    );
    status = 503;
    await send();
    expect(document.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'Reports are paused for today. Try again tomorrow.',
    );
  });

  it('says so offline, and sends nothing', async () => {
    vi.spyOn(Navigator.prototype, 'onLine', 'get').mockReturnValue(false);
    await send();
    expect(document.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'You’re offline, so nothing was sent. Send it once you’re back online.',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends once, however often Send is pressed meanwhile', async () => {
    fetch.mockImplementation(() => new Promise(() => undefined));
    await send();
    await send();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MatButtonToggleGroupHarness } from '@angular/material/button-toggle/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import type { Settings } from '@simply-sub/core';
import { SettingsStore } from '../../core/settings/settings-store';
import {
  plantRows,
  storedRows,
  testStorage,
  until,
  type TestStorage,
} from '../../core/storage/storage.testing';
import { YearlyTotalSwitch } from './yearly-total-switch';

// List view's yearly total (P4): this calendar year's or the next 12 months', chosen on this device.

const alberta: Settings = {
  key: 'settings',
  country: 'CA',
  subdivision: 'CA-AB',
  currency: 'CAD',
  theme: 'system',
  updatedAt: '2026-10-25T12:00:00.000Z',
};

describe('YearlyTotalSwitch', () => {
  let storage: TestStorage;

  beforeEach(async () => {
    storage = testStorage();
    await plantRows(storage.indexedDB, 'settings', [alberta]);
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
  });

  const saved = async () => ((await storedRows(storage.indexedDB, 'settings')) as Settings[])[0];

  async function render() {
    const fixture = TestBed.createComponent(YearlyTotalSwitch);
    await until(() => TestBed.inject(SettingsStore).saved() !== undefined);
    await fixture.whenStable();
    const group = await TestbedHarnessEnvironment.loader(fixture).getHarness(
      MatButtonToggleGroupHarness,
    );
    return { fixture, group, element: fixture.nativeElement as HTMLElement };
  }

  it('is a labelled pair of choices, This year chosen until the device says otherwise', async () => {
    const { group, element } = await render();
    const label = element.querySelector('.label');
    expect(label?.textContent).toBe('Yearly total');
    const host = element.querySelector('mat-button-toggle-group');
    expect(host?.getAttribute('role')).toBe('radiogroup');
    expect(host?.getAttribute('aria-labelledby')).toBe(label?.id);
    const toggles = await group.getToggles();
    expect(await Promise.all(toggles.map((toggle) => toggle.getText()))).toEqual([
      'This year',
      'Next 12 months',
    ]);
    expect(await Promise.all(toggles.map((toggle) => toggle.isChecked()))).toEqual([true, false]);
  });

  it('saves Next 12 months on this device, and leaves the setting out for This year', async () => {
    const { group } = await render();
    const [thisYear, next12] = await group.getToggles();
    await next12.check();
    await vi.waitFor(async () => expect((await saved()).yearlyTotal).toBe('next-12-months'));
    await thisYear.check();
    await vi.waitFor(async () => expect(await saved()).not.toHaveProperty('yearlyTotal'));
  });

  it('shows what this device chose before', async () => {
    await plantRows(storage.indexedDB, 'settings', [{ ...alberta, yearlyTotal: 'next-12-months' }]);
    const { group } = await render();
    const toggles = await group.getToggles();
    expect(await Promise.all(toggles.map((toggle) => toggle.isChecked()))).toEqual([false, true]);
  });
});

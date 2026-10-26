import type { ComponentHarnessConstructor, HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatRadioGroupHarness } from '@angular/material/radio/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { Router, provideRouter } from '@angular/router';
import type { Settings } from '@simply-sub/core';
import { SettingsStore } from '../../core/settings/settings-store';
import {
  plantRows,
  storedRows,
  testStorage,
  until,
  type TestStorage,
} from '../../core/storage/storage.testing';
import { ThemeService } from '../../core/theme/theme-service';
import { SettingsPage } from './settings-page';

const ontario: Settings = {
  key: 'settings',
  country: 'CA',
  subdivision: 'CA-ON',
  currency: 'CAD',
  monthlyBudget: 200,
  theme: 'system',
  updatedAt: '2026-10-25T12:00:00.000Z',
};

describe('SettingsPage', () => {
  let storage: TestStorage;
  let fixture: ComponentFixture<SettingsPage>;
  let loader: HarnessLoader;

  beforeEach(async () => {
    storage = testStorage();
    await plantRows(storage.indexedDB, 'settings', [ontario]);
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        provideRouter([]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    fixture = TestBed.createComponent(SettingsPage);
    loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
    await until(() => TestBed.inject(SettingsStore).saved() !== undefined);
    await fixture.whenStable();
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const saved = async () => ((await storedRows(storage.indexedDB, 'settings')) as Settings[])[0];

  /** Waits for the page to show `expected`, once the live query has the saved change. */
  async function shows(expected: string) {
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(text()).toContain(expected);
    });
  }

  /** The input or menu labelled `label`. */
  async function control<T extends MatInputHarness | MatSelectHarness>(
    within: HarnessLoader,
    label: string,
    type: ComponentHarnessConstructor<T>,
  ): Promise<T> {
    const field = await within.getHarness(MatFormFieldHarness.with({ floatingLabelText: label }));
    const found = await field.getControl(type);
    if (!found) throw new Error(`No control labelled ${label}`);
    return found;
  }

  it('shows where the user is, with the sales tax that follows, and the budgets', () => {
    expect(text()).toContain('Ontario, Canada (CAD)');
    expect(text()).toContain('Sales tax 13% (Ontario)');
    expect(text()).toContain('Monthly budget: $200');
    expect(text()).toContain('Annual budget: Not set');
  });

  describe('a budget', () => {
    async function edit(label: string): Promise<MatInputHarness> {
      await (
        await loader.getHarness(MatButtonHarness.with({ selector: `[aria-label="Edit ${label}"]` }))
      ).click();
      return control(loader, label, MatInputHarness);
    }

    it('is edited in place: Enter saves, and focus goes back to ✎', async () => {
      const amount = await edit('Annual budget');
      expect(await amount.isFocused()).toBe(true);
      await amount.setValue('1000');
      // What Enter in a form's field does in a browser; jsdom doesn't.
      (fixture.nativeElement as HTMLElement).querySelector('form')!.requestSubmit();
      await vi.waitFor(async () => expect((await saved()).annualBudget).toBe(1000));
      await shows('Annual budget: $1,000');
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Edit Annual budget');
    });

    it('is cleared when left empty', async () => {
      const amount = await edit('Monthly budget');
      await amount.setValue('');
      await (await loader.getHarness(MatButtonHarness.with({ text: 'Save' }))).click();
      await vi.waitFor(async () => expect((await saved()).monthlyBudget).toBeUndefined());
      await shows('Monthly budget: Not set');
    });

    it('must be above 0', async () => {
      const amount = await edit('Monthly budget');
      await amount.setValue('0');
      await (await loader.getHarness(MatButtonHarness.with({ text: 'Save' }))).click();
      expect(text()).toContain('Enter an amount above 0, or leave it empty');
      expect((await saved()).monthlyBudget).toBe(200);
    });

    it('is left as it was on Escape', async () => {
      const amount = await edit('Monthly budget');
      await amount.setValue('50');
      (await amount.host()).dispatchEvent('keydown', { key: 'Escape' });
      await fixture.whenStable();
      expect(text()).toContain('Monthly budget: $200');
      expect((await saved()).monthlyBudget).toBe(200);
    });
  });

  it('sets the theme, System included', async () => {
    const appearance = await loader.getHarness(MatRadioGroupHarness);
    expect(await appearance.getCheckedValue()).toBe('system');
    await appearance.checkRadioButton({ label: 'Dark' });
    expect(TestBed.inject(ThemeService).mode()).toBe('dark');
    await vi.waitFor(async () => expect((await saved()).theme).toBe('dark'));
  });

  describe('the 📍 dialog', () => {
    async function open(): Promise<HarnessLoader> {
      await (await loader.getHarness(MatButtonHarness.with({ text: /Ontario, Canada/ }))).click();
      await loader.getHarness(MatDialogHarness);
      return loader.getChildLoader('mat-dialog-container');
    }

    it('changes the province, and the tax follows', async () => {
      const dialog = await open();
      const province = await control(dialog, 'Province or territory', MatSelectHarness);
      await province.open();
      await province.clickOptions({ text: 'Quebec' });
      await (await dialog.getHarness(MatButtonHarness.with({ text: 'Save' }))).click();

      await shows('Quebec, Canada (CAD)');
      expect(text()).toContain('Sales tax 14.975% (Quebec)');
      expect(await saved()).toMatchObject({
        subdivision: 'CA-QC',
        monthlyBudget: 200,
        theme: 'system',
      });
    });

    it('takes the user’s own rate', async () => {
      const dialog = await open();
      await (
        await dialog.getHarness(MatCheckboxHarness.with({ label: 'Use my own rate' }))
      ).check();
      await (await control(dialog, 'Sales tax rate', MatInputHarness)).setValue('5');
      await (await dialog.getHarness(MatButtonHarness.with({ text: 'Save' }))).click();
      await shows('Sales tax 5% (your rate)');
    });

    it('changes nothing on Cancel', async () => {
      const dialog = await open();
      const country = await control(dialog, 'Country', MatSelectHarness);
      await country.open();
      await country.clickOptions({ text: 'United Kingdom' });
      await (await dialog.getHarness(MatButtonHarness.with({ text: 'Cancel' }))).click();
      await vi.waitFor(async () =>
        expect(await loader.getAllHarnesses(MatDialogHarness)).toHaveLength(0),
      );
      expect(await saved()).toEqual(ontario);
    });
  });

  it('goes back Home when Settings was the first page opened', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl');
    await (
      await loader.getHarness(MatButtonHarness.with({ selector: '[aria-label="Back"]' }))
    ).click();
    expect(navigate).toHaveBeenCalledWith('/');
  });
});

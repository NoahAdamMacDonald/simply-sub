import type { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatAutocompleteHarness } from '@angular/material/autocomplete/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatInputHarness } from '@angular/material/input/testing';
import type { Feature, FeatureValue } from '@simply-sub/core';
import { FeaturePicker } from './feature-picker';

const registry: Feature[] = [
  { id: 'streaming.ad-free', name: 'Ad free', category: 'streaming', type: 'boolean' },
  {
    id: 'streaming.concurrent-streams',
    name: 'Simultaneous streams',
    category: 'streaming',
    type: 'number',
    unit: 'devices',
  },
  {
    id: 'vpn.protocols',
    name: 'VPN protocols',
    category: 'vpn',
    type: 'set',
    values: [
      { id: 'wireguard', name: 'WireGuard' },
      { id: 'openvpn', name: 'OpenVPN' },
    ],
  },
];

@Component({
  imports: [FeaturePicker],
  template: `<ss-feature-picker [registry]="registry" planName="Basic" [(features)]="features" />`,
})
class Host {
  readonly registry = registry;
  readonly features = signal<Readonly<Record<string, FeatureValue>>>({});
}

describe('FeaturePicker', () => {
  let fixture: ComponentFixture<Host>;
  let loader: HarnessLoader;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
    });
    fixture = TestBed.createComponent(Host);
    loader = TestbedHarnessEnvironment.loader(fixture);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const features = () => fixture.componentInstance.features();
  const listed = () =>
    Array.from(element().querySelectorAll('.feature-text')).map((text) => text.textContent?.trim());

  async function pick(text: string, option: string): Promise<void> {
    const box = await loader.getHarness(MatAutocompleteHarness);
    await box.enterText(text);
    await box.selectOption({ text: option });
    await fixture.whenStable();
  }

  async function press(text: string): Promise<void> {
    await (await loader.getHarness(MatButtonHarness.with({ text }))).click();
    await fixture.whenStable();
  }

  /** A listed feature's ✕, named "Remove …". */
  async function remove(name: string): Promise<void> {
    const selector = `[aria-label="Remove ${name}"]`;
    await (await loader.getHarness(MatButtonHarness.with({ selector }))).click();
    await fixture.whenStable();
  }

  it('asks for a number, or Unlimited, and names the value with its unit', async () => {
    await pick('simul', 'Simultaneous streams');
    const amount = await loader.getHarness(MatInputHarness.with({ selector: '.value input' }));
    expect(await amount.isFocused()).toBe(true);
    await press('Add feature');
    expect(element().querySelector('.value .error')?.textContent).toBe(
      'Enter a number, 0 or more, or tick Unlimited',
    );

    await amount.setValue('2');
    await press('Add feature');
    expect(features()).toEqual({ 'streaming.concurrent-streams': 2 });
    expect(listed()).toEqual(['Simultaneous streams: 2 devices']);

    // Unlimited, in place of the number.
    await remove('Simultaneous streams: 2 devices');
    await pick('simul', 'Simultaneous streams');
    await (await loader.getHarness(MatCheckboxHarness.with({ label: 'Unlimited' }))).check();
    await press('Add feature');
    expect(features()).toEqual({ 'streaming.concurrent-streams': 'unlimited' });
    expect(listed()).toEqual(['Simultaneous streams: Unlimited']);
  });

  it('asks for at least one of a set’s values, kept in the registry’s order', async () => {
    await pick('vpn', 'VPN protocols');
    await press('Add feature');
    expect(element().querySelector('.value .error')?.textContent).toBe('Choose at least one');
    await (await loader.getHarness(MatCheckboxHarness.with({ label: 'OpenVPN' }))).check();
    await (await loader.getHarness(MatCheckboxHarness.with({ label: 'WireGuard' }))).check();
    await press('Add feature');
    expect(features()).toEqual({ 'vpn.protocols': ['wireguard', 'openvpn'] });
    expect(listed()).toEqual(['VPN protocols: WireGuard, OpenVPN']);
  });

  it('adds a yes-or-no feature at once, leaves it out of the suggestions after, and removes it', async () => {
    await pick('ad', 'Ad free');
    expect(features()).toEqual({ 'streaming.ad-free': true });
    const box = await loader.getHarness(MatAutocompleteHarness);
    expect(await box.getValue()).toBe('');
    // Nothing else starts with "ad", so there's nothing to suggest.
    await box.enterText('ad');
    expect(await box.isOpen()).toBe(false);

    await remove('Ad free');
    expect(features()).toEqual({});
    expect(document.activeElement).toBe(element().querySelector('.add input'));
  });

  it('closes the value’s row on Escape without adding it, and keeps the dialog open', async () => {
    await pick('vpn', 'VPN protocols');
    const row = element().querySelector('.value')!;
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    let reachedDialog = false;
    element().addEventListener('keydown', () => (reachedDialog = true));
    row.dispatchEvent(escape);
    await fixture.whenStable();
    expect(element().querySelector('.value')).toBeNull();
    expect(reachedDialog).toBe(false);
    expect(features()).toEqual({});
  });
});

import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSelectHarness } from '@angular/material/select/testing';
import type { Rank } from '@simply-sub/core';
import { RankSelect } from './rank-select';

@Component({
  imports: [RankSelect],
  template: `
    <span id="name">Video quality · 1080p</span>
    <ss-rank-select
      labelledBy="name"
      [subscriptionLevel]="subscriptionLevel()"
      [inherited]="inherited()"
      [(value)]="value"
    />
  `,
})
class Host {
  readonly subscriptionLevel = signal(false);
  readonly inherited = signal<Rank | undefined>(undefined);
  readonly value = signal<Rank | undefined>(undefined);
}

describe('RankSelect', () => {
  let fixture: ComponentFixture<Host>;
  let loader: HarnessLoader;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
    });
    fixture = TestBed.createComponent(Host);
    loader = TestbedHarnessEnvironment.loader(fixture);
  });

  async function select(): Promise<MatSelectHarness> {
    await fixture.whenStable();
    return loader.getHarness(MatSelectHarness);
  }

  /** The options' text, without the dots (which have none). */
  async function options(harness: MatSelectHarness): Promise<string[]> {
    await harness.open();
    const texts = await Promise.all((await harness.getOptions()).map((option) => option.getText()));
    await harness.close();
    return texts.map((text) => text.replace(/\s+/g, ' ').trim());
  }

  it('offers a profile Not ranked first, then Needed to Unwanted, and starts on Not ranked', async () => {
    const harness = await select();
    expect(await harness.getValueText()).toBe('Not ranked');
    expect(await options(harness)).toEqual([
      'Not ranked',
      'Needed',
      'Wanted',
      'Uses',
      'Sometimes',
      'Unused',
      'Unwanted',
    ]);
  });

  it('is named by the row', async () => {
    const harness = await select();
    const trigger = await (await harness.host()).getAttribute('aria-labelledby');
    expect(trigger?.split(' ')).toContain('name');
  });

  it('sets the value to the rank picked', async () => {
    const harness = await select();
    await harness.clickOptions({ text: 'Wanted' });
    expect(fixture.componentInstance.value()).toBe('wanted');
    expect(await harness.getValueText()).toBe('Wanted');
  });

  it('adds Essential and Critical, with their hints, for a subscription', async () => {
    fixture.componentInstance.subscriptionLevel.set(true);
    expect(await options(await select())).toEqual([
      'Essential Keep this plan',
      'Critical Keep this provider',
      'Needed',
      'Wanted',
      'Uses',
      'Sometimes',
      'Not ranked',
      'Unused',
      'Unwanted',
    ]);
  });

  describe('with a profile rank to inherit', () => {
    beforeEach(() => {
      fixture.componentInstance.subscriptionLevel.set(true);
      fixture.componentInstance.inherited.set('wanted');
    });

    it('starts with "Profile default (Wanted)", chosen while there is no override', async () => {
      const harness = await select();
      expect(await harness.getValueText()).toBe('Profile default (Wanted)');
      expect((await options(harness))[0]).toBe('Profile default (Wanted)');
    });

    it('overrides the rank, and clears the override with the profile default', async () => {
      const harness = await select();
      await harness.clickOptions({ text: /Essential/ });
      expect(fixture.componentInstance.value()).toBe('essential');
      expect(await harness.getValueText()).toBe('Essential');

      await harness.clickOptions({ text: 'Profile default (Wanted)' });
      expect(fixture.componentInstance.value()).toBeUndefined();
    });

    it('can override with Not ranked, which is not the default', async () => {
      const harness = await select();
      await harness.clickOptions({ text: 'Not ranked' });
      expect(fixture.componentInstance.value()).toBe('not-ranked');
      expect(await harness.getValueText()).toBe('Not ranked');
    });
  });
});

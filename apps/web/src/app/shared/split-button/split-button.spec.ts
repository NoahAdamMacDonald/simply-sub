import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatMenuHarness } from '@angular/material/menu/testing';
import { SplitButton, type SplitButtonItem } from './split-button';

@Component({
  imports: [SplitButton],
  template: `<ss-split-button
    label="Export to file"
    [items]="items"
    (action)="actions.push($event)"
  />`,
})
class Host {
  readonly actions: string[] = [];
  readonly items: SplitButtonItem[] = [
    { id: 'ics', label: 'Calendar (.ics)' },
    { id: 'csv', label: 'Payment schedule (.csv)' },
  ];
}

describe('SplitButton', () => {
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

  const buttons = () => (fixture.nativeElement as HTMLElement).querySelectorAll('button');

  it('does the first item from the main button, whose name says so', () => {
    const [main] = buttons();
    expect(main.textContent?.trim()).toBe('Export to file');
    expect(main.getAttribute('aria-label')).toBe('Export to file: Calendar (.ics)');
    main.click();
    expect(fixture.componentInstance.actions).toEqual(['ics']);
  });

  it('lists every item in its menu', async () => {
    expect(buttons()[1].getAttribute('aria-label')).toBe('Export to file, more options');
    const menu = await loader.getHarness(MatMenuHarness);
    await menu.open();
    const items = await menu.getItems();
    expect(await Promise.all(items.map((item) => item.getText()))).toEqual([
      'Calendar (.ics)',
      'Payment schedule (.csv)',
    ]);
    await items[1].click();
    expect(fixture.componentInstance.actions).toEqual(['csv']);
  });
});

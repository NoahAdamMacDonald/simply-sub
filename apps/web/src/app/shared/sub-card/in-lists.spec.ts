import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatTooltipHarness } from '@angular/material/tooltip/testing';
import { provideRouter } from '@angular/router';
import { InLists, type NamedList } from './in-lists';

describe('InLists', () => {
  let fixture: ComponentFixture<InLists>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    fixture = TestBed.createComponent(InLists);
    fixture.componentRef.setInput('provider', 'Netflix');
  });

  async function show(count: number, lists: NamedList[] = []): Promise<void> {
    fixture.componentRef.setInput('count', count);
    fixture.componentRef.setInput('lists', lists);
    await fixture.whenStable();
  }

  const element = () => fixture.nativeElement as HTMLElement;

  it('says how many lists, in words alone without their names', async () => {
    await show(1);
    expect(element().textContent?.trim()).toBe('1 list');
    expect(element().querySelector('button')).toBeNull();

    await show(2);
    expect(element().textContent?.trim()).toBe('2 lists');
  });

  it('names every list in its tooltip', async () => {
    await show(3, [
      { id: 'a', name: 'Work Related' },
      { id: 'b', name: 'Family' },
      { id: 'c', name: 'Sam' },
    ]);
    expect(element().querySelector('button')?.textContent?.trim()).toBe('3 lists');

    const tooltip = await TestbedHarnessEnvironment.loader(fixture).getHarness(MatTooltipHarness);
    await tooltip.show();
    expect(await tooltip.getTooltipText()).toBe('In Work Related, Family and Sam');

    await show(1, [{ id: 'a', name: 'Work Related' }]);
    await tooltip.show();
    expect(await tooltip.getTooltipText()).toBe('In Work Related');
  });
});

import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { until } from '../../core/storage/storage.testing';
import { ChoiceField, type Choice } from './choice-field';

// The menu you can type in (M6.16) closes when it's left (the feedback after M10, part 2): on a press anywhere else,
// even one that leaves focus in the field, as a tap does on an iPhone, and when focus goes nowhere, as an iPhone's
// keyboard Done sends it; a choice pressed in the list is still picked.

@Component({
  imports: [ChoiceField],
  template: `
    <ss-choice-field label="Country" [choices]="choices" [(value)]="value" />
    <p class="elsewhere">Somewhere else on the page</p>
  `,
})
class Host {
  readonly choices: Choice[] = [
    { value: 'CA', label: 'Canada' },
    { value: 'FR', label: 'France' },
    { value: 'US', label: 'United States' },
  ];
  readonly value = signal('CA');
}

describe('ChoiceField', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
    });
    fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.nativeElement.remove();
    document.querySelectorAll('.cdk-overlay-container').forEach((overlay) => overlay.remove());
  });

  const box = () => (fixture.nativeElement as HTMLElement).querySelector('input')!;
  const panel = () => document.querySelector<HTMLElement>('.mat-mdc-autocomplete-panel');
  const open = () => panel()?.classList.contains('mat-mdc-autocomplete-visible') === true;
  const option = (label: string) =>
    Array.from(document.querySelectorAll<HTMLElement>('mat-option')).find(
      (candidate) => candidate.textContent?.trim() === label,
    );

  async function openList(): Promise<void> {
    box().focus();
    box().click();
    await until(open);
  }

  /** A press that leaves focus where it is, as a tap on something that can't take it does on an iPhone. */
  async function press(target: Element): Promise<void> {
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await fixture.whenStable();
  }

  it('closes on a press outside it, though focus stays in the field', async () => {
    await openList();
    await press(fixture.nativeElement.querySelector('.elsewhere'));
    expect(open()).toBe(false);
    expect(document.activeElement).toBe(box());
    expect(box().value).toBe('Canada');
  });

  it('stays open for a press in the field', async () => {
    await openList();
    await press(box());
    expect(open()).toBe(true);
  });

  it('closes when focus leaves for nowhere, as an iPhone keyboard’s Done sends it', async () => {
    await openList();
    box().blur();
    await fixture.whenStable();
    expect(open()).toBe(false);
  });

  it('picks a choice pressed in the list, though the press takes focus from the field first', async () => {
    await openList();
    const france = option('France')!;
    france.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    box().blur();
    await fixture.whenStable();
    expect(open()).toBe(true);

    france.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    france.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.value()).toBe('FR');
    expect(open()).toBe(false);
  });

  it('forgets a press in the list that became a scroll', async () => {
    await openList();
    const france = option('France')!;
    france.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    france.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    box().blur();
    await fixture.whenStable();
    expect(open()).toBe(false);
  });

  it('stops watching for presses once the list has closed', async () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    await openList();
    box().blur();
    await until(() => !open());
    expect(remove).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
    remove.mockRestore();
  });
});

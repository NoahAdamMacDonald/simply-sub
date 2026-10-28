import { TestBed } from '@angular/core/testing';
import type { FeatureSummaryRow } from '@simply-sub/core';
import { FeatureSummary } from './feature-summary';

// The feature summary (§3.2): every row, or with a limit the first few and Show all.

const rows: FeatureSummaryRow[] = ['A', 'B', 'C', 'D'].map((name, index) => ({
  key: `feature.${name.toLowerCase()}`,
  label: name,
  active: index,
  total: 3,
}));

describe('FeatureSummary', () => {
  function render(limit?: number) {
    const fixture = TestBed.createComponent(FeatureSummary);
    fixture.componentRef.setInput('rows', rows);
    if (limit !== undefined) fixture.componentRef.setInput('limit', limit);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const labels = () =>
      Array.from(element.querySelectorAll('li .label')).map((label) => label.textContent);
    return { fixture, element, labels };
  }

  it('shows every row, read as "1 of 3 active", with no limit', () => {
    const { element, labels } = render();
    expect(labels()).toEqual(['A:', 'B:', 'C:', 'D:']);
    expect(element.querySelector('li .visually-hidden')?.textContent).toBe('0 of 3 active');
    expect(element.querySelector('button')).toBeNull();
  });

  it('shows the first rows up to its limit, and Show all opens the rest', async () => {
    const { fixture, element, labels } = render(2);
    expect(labels()).toEqual(['A:', 'B:']);
    const button = element.querySelector<HTMLButtonElement>('button.more');
    expect(button?.textContent?.trim()).toBe('Show all 4');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(button?.getAttribute('aria-controls')).toBe(element.querySelector('ul')?.id);

    button?.click();
    await fixture.whenStable();
    expect(labels()).toEqual(['A:', 'B:', 'C:', 'D:']);
    expect(button?.textContent?.trim()).toBe('Show fewer');
    expect(button?.getAttribute('aria-expanded')).toBe('true');
  });

  it('has no button when the rows fit within the limit', () => {
    expect(render(4).element.querySelector('button')).toBeNull();
  });
});

import { TestBed } from '@angular/core/testing';
import { RankCounts } from './rank-counts';

describe('RankCounts', () => {
  it('lists all eight ranks with their counts, a zero in grey', async () => {
    const fixture = TestBed.createComponent(RankCounts);
    fixture.componentRef.setInput('counts', {
      essential: 1,
      critical: 0,
      needed: 2,
      wanted: 4,
      uses: 2,
      sometimes: 1,
      unused: 2,
      unwanted: 1,
    });
    await fixture.whenStable();
    const items = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('li'));
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      '1 Essential',
      '0 Critical',
      '2 Needed',
      '4 Wanted',
      '2 Uses',
      '1 Sometimes',
      '2 Unused',
      '1 Unwanted',
    ]);
    expect(items.map((item) => item.dataset['rank'])).toEqual([
      'essential',
      'not-ranked',
      'needed',
      'wanted',
      'uses',
      'sometimes',
      'unused',
      'unwanted',
    ]);
  });
});

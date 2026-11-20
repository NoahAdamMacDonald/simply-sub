import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Settings, Suggestion } from '@simply-sub/core';
import { SettingsStore } from '../../core/settings/settings-store';
import { SuggestionCard } from './suggestion-card';

// A P14 card's losses and gains (M10.34): the services and ranked features a row each, the most important rank first,
// and the features you haven't ranked folded under a summary.

const removal: Suggestion = {
  fingerprint: 'remove-iqiyi',
  severity: 'yellow',
  actions: [
    {
      kind: 'remove',
      item: {
        itemId: 'iqiyi',
        title: 'iQIYI Premium',
        name: 'iQIYI',
        planName: 'Premium',
        price: {
          interval: 'year',
          intervalCount: 1,
          amount: 119.99,
          currency: 'CAD',
          monthlyEquivalent: 10,
          autoRenew: true,
          native: true,
          source: { region: 'CA', amount: 119.99, currency: 'CAD' },
        },
        next: '2026-12-09',
      },
      on: '2026-12-09',
    },
  ],
  savings: 119.99,
  next12: 1000,
  monthly: 83.33,
  estimated: false,
  lost: [
    {
      key: 'streaming.concurrent-streams=2-4',
      label: 'Simultaneous streams: 2 to 4',
      rank: 'uses',
    },
    { key: 'video.hdr', label: 'HDR', rank: 'not-ranked' },
    { key: 'video.quality=4k', label: 'Video quality: 4K (Ultra HD)', rank: 'wanted' },
    { key: 'download.offline', label: 'Download devices: Offline downloads', rank: 'not-ranked' },
  ],
  lostServices: [{ itemId: 'iqiyi', title: 'iQIYI Premium' }],
  gained: [{ key: 'ad-free', label: 'Ad free', rank: 'not-ranked' }],
};

function render(suggestion: Suggestion): HTMLElement {
  TestBed.configureTestingModule({
    providers: [
      { provide: SettingsStore, useValue: { saved: signal<Settings | undefined>(undefined) } },
    ],
  });
  const fixture = TestBed.createComponent(SuggestionCard);
  fixture.componentRef.setInput('suggestion', suggestion);
  fixture.componentRef.setInput('currency', 'CAD');
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('SuggestionCard', () => {
  it('lists the service and the ranked losses a row each, Wanted before Uses, and folds the rest', () => {
    const card = render(removal);
    const rows = Array.from(card.querySelectorAll('.lose .ranked li')).map(text);
    expect(rows).toEqual([
      'block iQIYI Premium itself',
      'Wanted Video quality: 4K (Ultra HD)',
      'Uses Simultaneous streams: 2 to 4',
    ]);
    expect(card.querySelector('.lose ul')?.getAttribute('aria-labelledby')).toBe(
      card.querySelector('.lose .label')?.id,
    );
    // Nothing ranked is gained, so there's no You gain.
    expect(card.querySelector('.gain')).toBeNull();

    const folded = card.querySelector('details.unranked') as HTMLDetailsElement;
    expect(folded.open).toBe(false);
    expect(text(folded.querySelector('summary'))).toBe(
      "Also changes 3 features you haven't ranked: loses 2, gains 1",
    );
    expect(
      Array.from(folded.querySelectorAll('ul')).map((list) => Array.from(list.children).map(text)),
    ).toEqual([['HDR', 'Download devices: Offline downloads'], ['Ad free']]);
  });

  it('says how many unranked features it loses alone, and shows no fold when every one is ranked', () => {
    const onlyLost = render({ ...removal, gained: [], lost: removal.lost.slice(1, 2) });
    expect(text(onlyLost.querySelector('summary'))).toBe("Also loses 1 feature you haven't ranked");

    TestBed.resetTestingModule();
    const ranked = render({
      ...removal,
      lostServices: [],
      lost: removal.lost.filter((change) => change.rank !== 'not-ranked'),
      gained: [{ key: 'ad-free', label: 'Ad free', rank: 'wanted' }],
    });
    expect(ranked.querySelector('details')).toBeNull();
    expect(Array.from(ranked.querySelectorAll('.gain li')).map(text)).toEqual(['Wanted Ad free']);
  });
});

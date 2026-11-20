import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CatalogData } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { ClockService } from '../../core/clock/clock-service';
import { CategoryChips } from './category-chips';

// A card's categories (M10.36): every one the provider's plans are in, the picked plan's filled with a check, in
// categories.yaml's order, and one tab stop named by its tooltip's sentence.

const categories = {
  service: [
    { id: 'vpn', name: 'VPN', icon: 'vpn_lock' },
    { id: 'privacy-suite', name: 'Privacy suites', icon: 'shield' },
    { id: 'passwords', name: 'Password managers & authenticators', icon: 'password' },
    { id: 'dns', name: 'DNS & content filtering', icon: 'dns' },
  ],
  feature: [],
  spend: [],
} as unknown as CatalogData['categories'];

const cloudflare = {
  category: 'vpn',
  plans: [
    { id: 'cloudflare.warp', categories: ['vpn', 'dns'] },
    { id: 'cloudflare.families', categories: ['dns'] },
    { id: 'cloudflare.vault', categories: ['passwords'], retired: '2026-01-01' },
  ],
};

function render(planId: string | undefined, provider = cloudflare): HTMLElement {
  TestBed.configureTestingModule({
    providers: [
      { provide: CatalogStore, useValue: { catalog: signal({ categories } as CatalogData) } },
      { provide: ClockService, useValue: { today: signal('2026-11-19') } },
    ],
  });
  const fixture = TestBed.createComponent(CategoryChips);
  fixture.componentRef.setInput('provider', provider);
  fixture.componentRef.setInput('planId', planId);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const chips = (element: HTMLElement) =>
  Array.from(element.querySelectorAll('.chip')).map(
    (chip) =>
      `${chip.classList.contains('in-plan') ? '+' : '-'}${Array.from(
        chip.querySelectorAll('mat-icon'),
      )
        .map((icon) => icon.textContent?.trim())
        .join(' ')}`,
  );

describe('CategoryChips', () => {
  it('fills the picked plan’s categories, with a check, and outlines the others, leaving out a retired plan’s', () => {
    const element = render('cloudflare.families');
    expect(chips(element)).toEqual(['-vpn_lock', '+check dns']);
    const row = element.querySelector('.chips');
    expect(row?.getAttribute('role')).toBe('img');
    expect(row?.getAttribute('tabindex')).toBe('0');
    expect(row?.getAttribute('aria-label')).toBe(
      'This plan: DNS & content filtering. Its other plans: VPN.',
    );
  });

  it('keeps every chip in place when the plan changes, only the marks moving', () => {
    const element = render('cloudflare.warp');
    expect(chips(element)).toEqual(['+check vpn_lock', '+check dns']);
    expect(element.querySelector('.chips')?.getAttribute('aria-label')).toBe(
      'This plan: VPN and DNS & content filtering.',
    );
  });

  it('names them all as its plans’ with no plan picked, and shows nothing for a category it doesn’t know', () => {
    const element = render(undefined, {
      category: 'vpn',
      plans: [
        { id: 'a.one', categories: ['vpn', 'unknown'] },
        { id: 'a.two', categories: ['passwords'] },
      ],
    });
    expect(chips(element)).toEqual(['-vpn_lock', '-password']);
    expect(element.querySelector('.chips')?.getAttribute('aria-label')).toBe(
      'Its plans: VPN and Password managers & authenticators.',
    );
  });
});

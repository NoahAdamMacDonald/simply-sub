import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { CatalogData, Feature, Plan } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { FeatureList } from './feature-list';

const features: Feature[] = [
  {
    id: 'video.quality',
    name: 'Video quality',
    category: 'streaming',
    type: 'enum',
    values: [
      { id: '1080p', name: '1080p (Full HD)' },
      { id: '4k', name: '4K (Ultra HD)' },
    ],
  },
  { id: 'ad-free', name: 'Ad free', category: 'streaming', type: 'boolean' },
  { id: 'vpn.included', name: 'VPN', category: 'vpn', type: 'boolean' },
  {
    id: 'vpn.devices',
    parent: 'vpn.included',
    name: 'VPN devices',
    category: 'vpn',
    type: 'number',
    unit: 'devices',
  },
];

const plan = {
  features: {
    'video.quality': '4k',
    'ad-free': true,
    'vpn.included': true,
    'vpn.devices': 10,
  },
} as unknown as Plan;

describe('FeatureList', () => {
  let fixture: ComponentFixture<FeatureList>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CatalogStore,
          useValue: { catalog: signal({ features } as unknown as CatalogData) },
        },
      ],
    });
    fixture = TestBed.createComponent(FeatureList);
    fixture.componentRef.setInput('features', plan.features);
    fixture.componentRef.setInput('ranks', {
      'ad-free': 'essential',
      'video.quality=1080p': 'wanted',
      'video.quality=4k': 'not-ranked',
      'vpn.included': 'needed',
    });
    await fixture.whenStable();
  });

  const lines = () =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.feature')).map((line) =>
      line.textContent?.replace(/\s+/g, ' ').trim(),
    );

  it("lists the plan's features with their values and the user's ranks, a group's under it", () => {
    expect(lines()).toEqual([
      'Video quality: 4K (Ultra HD) Wanted · 1080p (Full HD)',
      'Ad free Essential',
      'VPN Needed',
      'VPN devices: 10 devices',
    ]);
    const vpn = (fixture.nativeElement as HTMLElement).querySelectorAll(
      ':scope > ss-feature-lines > ul > li',
    )[2];
    expect(vpn.querySelector('ss-feature-lines.children')?.textContent).toContain('VPN devices');
  });

  it('marks a value inferred, linking the page it was inferred from (M11.9)', async () => {
    fixture.componentRef.setInput('inferred', {
      'video.quality': {
        reason: 'Its help recommends a speed for 4K content.',
        page: { name: 'Help Center', url: 'https://example.com/help/306' },
        lastVerified: '2026-11-03',
      },
    });
    await fixture.whenStable();

    expect(lines()[0]).toBe('Video quality: 4K (Ultra HD) inferred Wanted · 1080p (Full HD)');
    const links = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>(
      'a.inferred',
    );
    expect(links).toHaveLength(1);
    expect(links[0].href).toBe('https://example.com/help/306');
    expect(links[0].target).toBe('_blank');
    expect(links[0].getAttribute('aria-label')).toBe(
      'Inferred from Help Center (opens in a new tab): Its help recommends a speed for 4K content.',
    );
  });

  it('marks a value third-party, linking the publication it comes from (M11.16)', async () => {
    fixture.componentRef.setInput('thirdParty', {
      'vpn.devices': {
        publisher: 'The Verge',
        url: 'https://www.theverge.com/vpn-devices',
        quote: 'It covers 10 devices.',
        lastVerified: '2026-11-03',
      },
    });
    await fixture.whenStable();

    expect(lines()[3]).toBe('VPN devices: 10 devices third-party');
    const links = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>(
      'a.third-party',
    );
    expect(links).toHaveLength(1);
    expect(links[0].href).toBe('https://www.theverge.com/vpn-devices');
    expect(links[0].target).toBe('_blank');
    expect(links[0].getAttribute('aria-label')).toBe(
      'Third-party, from The Verge (opens in a new tab): “It covers 10 devices.”',
    );
  });
});

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
  { id: 'streaming.ad-free', name: 'Ad free', category: 'streaming', type: 'boolean' },
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
    'streaming.ad-free': true,
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
    fixture.componentRef.setInput('plan', plan);
    fixture.componentRef.setInput('ranks', {
      'streaming.ad-free': 'essential',
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
});

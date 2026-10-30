import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import type { CatalogData, Settings, Tag } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { FxStore } from '../../core/fx/fx-store';
import { MetricsService } from '../../core/metrics/metrics-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { ItemsRepository } from '../../core/storage/items-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import { TagsRepository } from '../../core/storage/tags-repository';
import { testStorage, until } from '../../core/storage/storage.testing';
import { alberta, fx, searchCatalogData } from '../sub-card/search.testing';
import { LIVE_CALENDAR_SETTLE_MS } from './live-calendar-service';
import { FakeCalServer } from './live-calendar.testing';
import { openLiveCalendar } from './open-live-calendar';

// The live calendar's dialog (P10, P13, M10.3), opened as Sync calendar and Settings open it, on a fake IndexedDB and a
// stand-in for the Worker's /api/v1/cal, for an Albertan with Netflix Standard tagged Family.

describe('LiveCalendarDialog', () => {
  let server: FakeCalServer;
  let familyTag: Tag;

  beforeEach(async () => {
    server = new FakeCalServer();
    vi.stubGlobal('fetch', server.fetch);
    TestBed.configureTestingModule({
      providers: [
        testStorage().providers,
        { provide: SettingsStore, useValue: { saved: signal<Settings | undefined>(alberta) } },
        {
          provide: CatalogStore,
          useValue: {
            catalog: signal<CatalogData | undefined>(searchCatalogData),
            catalogFor: () => searchCatalogData,
          },
        },
        { provide: FxStore, useValue: { rates: signal(fx) } },
        { provide: LIVE_CALENDAR_SETTLE_MS, useValue: 0 },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    const work = await TestBed.inject(ListsRepository).create({ name: 'Work Related' });
    familyTag = await TestBed.inject(TagsRepository).create({ name: 'Family', color: '#1e88e5' });
    await TestBed.inject(ItemsRepository).create({
      listId: work.id,
      source: { kind: 'catalog', planId: 'netflix.standard' },
      billing: {
        mode: 'recurring',
        interval: 'month',
        intervalCount: 1,
        anchorDate: '2026-11-12',
        autoRenew: true,
      },
      tagIds: [familyTag.id],
      rankOverrides: {},
      pinned: false,
    });
    const metrics = TestBed.inject(MetricsService);
    await until(() => metrics.list(work.id).resolved.length === 1);
    await openLiveCalendar(TestBed.inject(Injector));
    await until(() => dialog() !== null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.querySelectorAll('.cdk-overlay-container').forEach((overlay) => overlay.remove());
  });

  const dialog = () => document.querySelector('ss-live-calendar-dialog');
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim();
  const button = (name: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('ss-live-calendar-dialog button')).find(
      (each) => text(each) === name,
    );
  const checkbox = (name: string) =>
    Array.from(dialog()?.querySelectorAll('mat-checkbox') ?? [])
      .find((each) => text(each) === name)
      ?.querySelector<HTMLInputElement>('input');

  it('says what it uploads and who can see it, and asks which calendars', () => {
    expect(text(dialog()?.querySelector('h2'))).toBe('Live calendar');
    expect(text(dialog())).toContain('Anyone with a link can see that calendar.');
    expect(
      Array.from(dialog()?.querySelectorAll('fieldset:first-of-type mat-checkbox') ?? []).map(
        (each) => [text(each), each.querySelector('input')?.checked],
      ),
    ).toEqual([
      ['Everything', true],
      ['Family', false],
      ['Payments without a tag', false],
    ]);
  });

  it('asks for a calendar before it makes the links', async () => {
    checkbox('Everything')?.click();
    button('Make links')?.click();

    await until(() => text(dialog()?.querySelector('.error')) === 'Choose at least one calendar.');
    expect(server.requests).toEqual([]);
  });

  it('makes no links offline, where Make links says why it can’t', async () => {
    window.dispatchEvent(new Event('offline'));
    await until(() => button('Make links')?.getAttribute('aria-disabled') === 'true');
    const hint = button('Make links')?.getAttribute('aria-describedby') ?? '';
    expect(text(document.getElementById(hint))).toBe(
      'You’re offline. You can make the links once you’re back online.',
    );
    button('Make links')?.click();
    window.dispatchEvent(new Event('online'));
    await until(() => button('Make links')?.getAttribute('aria-disabled') === null);
    expect(server.requests).toEqual([]);
    expect(text(dialog()?.querySelector('.error'))).toBe('');
  });

  it('makes the links, then shows each with its apps, focus on the title', async () => {
    checkbox('Family')?.click();
    button('Make links')?.click();

    await until(() => dialog()?.querySelectorAll('.calendars > li').length === 2);
    expect(server.requests.map((request) => request.method)).toEqual(['POST']);
    await until(() => document.activeElement === dialog()?.querySelector('h2'));
    const [everything, family] = Array.from(dialog()?.querySelectorAll('.calendars > li') ?? []);
    expect(text(everything.querySelector('h3'))).toBe('Everything');
    expect(text(family.querySelector('h3'))).toBe('Family');
    const url = `${location.origin}/api/v1/cal/secret0000000000000003.ics`;
    const webcal = url.replace(/^https?:/, 'webcal:');
    expect(text(family.querySelector('.link'))).toBe(url);
    const [google, apple] = Array.from(family.querySelectorAll('a'));
    expect(google.getAttribute('href')).toBe(
      `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`,
    );
    expect(google.getAttribute('aria-label')).toBe(
      'Add to Google Calendar: Family, opens in a new tab',
    );
    expect(apple.getAttribute('href')).toBe(webcal);
    expect(text(dialog()?.querySelector('[role="status"].visually-hidden'))).toBe(
      'Your links are ready.',
    );
  });

  it('copies a link, and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    button('Make links')?.click();
    await until(() => dialog()?.querySelectorAll('.calendars > li').length === 1);

    dialog()?.querySelector<HTMLButtonElement>('.calendars button')?.click();

    await until(() => writeText.mock.calls.length === 1);
    expect(writeText).toHaveBeenCalledWith(
      `${location.origin}/api/v1/cal/secret0000000000000002.ics`,
    );
    await until(
      () =>
        text(dialog()?.querySelector('[role="status"].visually-hidden')) ===
        'Copied the link for Everything.',
    );
  });

  it('changes the calendars, starting from the ones it has', async () => {
    button('Make links')?.click();
    await until(() => button('Change calendars') !== undefined);

    button('Change calendars')?.click();
    await until(() => text(dialog()?.querySelector('h2')) === 'Change your live calendar');
    expect(checkbox('Everything')?.checked).toBe(true);
    checkbox('Family')?.click();
    button('Save changes')?.click();

    await until(() => dialog()?.querySelectorAll('.calendars > li').length === 2);
    expect(server.requests.map((request) => request.method)).toEqual(['POST', 'PUT']);
    expect(server.requests[1].body?.feeds.map((feed) => feed.name)).toEqual([
      'Simply Sub',
      'Simply Sub: Family',
    ]);
  });

  it('revokes every link once asked, and starts over', async () => {
    button('Make links')?.click();
    await until(() => button('Revoke all…') !== undefined);

    button('Revoke all…')?.click();
    await until(() => document.querySelector('ss-confirm-dialog') !== null);
    expect(text(document.querySelector('ss-confirm-dialog h2'))).toBe('Revoke your live calendar?');
    Array.from(document.querySelectorAll<HTMLButtonElement>('ss-confirm-dialog button'))
      .find((each) => text(each) === 'Revoke all')
      ?.click();

    await until(() => button('Make links') !== undefined);
    expect(server.requests.map((request) => request.method)).toEqual(['POST', 'DELETE']);
    expect(text(dialog()?.querySelector('[role="status"].visually-hidden'))).toBe(
      'Revoked. The links no longer work.',
    );
  });
});

import type { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import type { SyncDevice, SyncRecord } from '@simply-sub/core';
import { joinInbox } from '../../core/join-inbox';
import { SettingsStore } from '../../core/settings/settings-store';
import {
  plantRows,
  testStorage,
  until,
  type TestStorage,
} from '../../core/storage/storage.testing';
import { ConfirmService } from '../../shared/confirm/confirm-service';
import { JoinLinks, type TakenLink } from '../../shared/sync/join-links';
import { SyncService, type SyncSnag } from '../../shared/sync/sync-service';
import { SyncSetting } from './sync-setting';

// Settings' Sync between devices (M10.9): off, on and stopped, with a stand-in for SyncService and every confirmation
// answered yes; Show the code's one-time QR code and a join link opened in the browser (M10.14), with a stand-in for
// JoinLinks. The clock says Oct 25, 2026, 12:00 UTC.

const seed = new Uint8Array(32);

class FakeSync {
  readonly record = signal<SyncRecord | undefined>(undefined);
  readonly syncing = signal(false);
  readonly snag = signal<SyncSnag | undefined>(undefined);
  readonly devices = signal<SyncDevice[]>([]);
  readonly start = vi.fn();
  readonly sync = vi.fn(async () => 'synced');
  readonly turnOn = vi.fn(async () => 'synced');
  readonly turnOff = vi.fn(async () => undefined);
  readonly deleteCopy = vi.fn(async () => undefined);
  readonly newSeed = () => seed;
}

class FakeLinks {
  readonly make = vi.fn(async () => ({
    url: 'https://sub.simplely.ca/join#YGFiY2RlZmdoaWprbG1ubw.QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8',
    id: 'YGFiY2RlZmdoaWprbG1ubw',
    expiresAt: '2026-10-25T12:10:00Z',
  }));
  readonly withdraw = vi.fn(async () => undefined);
  readonly take = vi.fn(async (): Promise<TakenLink> => ({ kind: 'gone' }));
}

const on: SyncRecord = {
  key: 'sync',
  seed: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  deviceId: '0192f1d0-0000-7000-8000-00000000000a',
  deviceName: 'Edge on Windows',
  version: '3',
  syncedAt: '2026-10-25T11:58:00.000Z',
  updatedAt: '2026-10-25T11:58:00.000Z',
};

describe('SyncSetting', () => {
  let storage: TestStorage;
  let sync: FakeSync;
  let links: FakeLinks;
  let confirm: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<SyncSetting>;
  let loader: HarnessLoader;

  beforeEach(async () => {
    storage = testStorage();
    sync = new FakeSync();
    links = new FakeLinks();
    confirm = vi.fn(async () => true);
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        { provide: SyncService, useValue: sync },
        { provide: JoinLinks, useValue: links },
        { provide: ConfirmService, useValue: { confirm } },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    fixture = TestBed.createComponent(SyncSetting);
    loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
    await fixture.whenStable();
  });

  afterEach(() => joinInbox.set(undefined));

  const text = () =>
    ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  const button = (name: string | RegExp) =>
    loader.getHarness(MatButtonHarness.with({ text: name }));

  it('starts syncing by itself as soon as it shows', () => {
    expect(sync.start).toHaveBeenCalled();
  });

  it('off: says what it does, and turns on once the new code’s words are kept', async () => {
    expect(text()).toContain('the server can’t read them');
    await (await button(/Turn on sync$/)).click();
    // The dialog loads as it opens.
    const dialog = await vi.waitFor(() => loader.getHarness(MatDialogHarness));
    expect(await dialog.getTitleText()).toBe('Your sync code');
    const words = [...document.querySelectorAll('.words li')].map((word) => word.textContent);
    expect(words).toEqual([...Array<string>(23).fill('abandon'), 'art']);
    // A new code is one to keep: no QR code until sync is on (M10.14).
    expect(document.querySelector('ss-qr-code')).toBeNull();
    expect(links.make).not.toHaveBeenCalled();

    await (await loader.getHarness(MatButtonHarness.with({ text: 'I’ve saved it' }))).click();
    await vi.waitFor(() => expect(sync.turnOn).toHaveBeenCalledWith(seed));
  });

  it('on: Show the code shows a QR code of a link that works once, withdrawn as it closes', async () => {
    sync.record.set(on);
    await fixture.whenStable();
    await (await button('Show the code…')).click();
    const dialog = await vi.waitFor(() => loader.getHarness(MatDialogHarness));
    await vi.waitFor(() =>
      expect(document.querySelector('ss-qr-code path')?.getAttribute('d')).toMatch(/^M\d/),
    );
    expect(links.make).toHaveBeenCalledWith(new Uint8Array(32));
    expect(await dialog.getText()).toContain('It works once, for 10 minutes.');

    // A new one replaces it, withdrawing the first.
    await (await loader.getHarness(MatButtonHarness.with({ text: /Make a new QR code$/ }))).click();
    await vi.waitFor(() => expect(links.make).toHaveBeenCalledTimes(2));
    expect(links.withdraw).toHaveBeenCalledWith('YGFiY2RlZmdoaWprbG1ubw');

    await (await loader.getHarness(MatButtonHarness.with({ text: 'Done' }))).click();
    await vi.waitFor(() => expect(links.withdraw).toHaveBeenCalledTimes(2));
  });

  it('on, offline: Show the code says why there’s no QR code, with the words still there', async () => {
    const { JoinCallError } = await import('../../shared/sync/join-client');
    links.make.mockRejectedValue(new JoinCallError('offline'));
    sync.record.set(on);
    await fixture.whenStable();
    await (await button('Show the code…')).click();
    const dialog = await vi.waitFor(() => loader.getHarness(MatDialogHarness));
    await vi.waitFor(async () =>
      expect(await dialog.getText()).toContain('You’re offline, so there’s no QR code'),
    );
    expect(document.querySelector('ss-qr-code')).toBeNull();
    expect(document.querySelectorAll('.words li')).toHaveLength(24);
  });

  it('opens Join with a join link opened in the browser, once the settings are read (M10.14)', async () => {
    await plantRows(storage.indexedDB, 'settings', [
      {
        key: 'settings',
        country: 'CA',
        currency: 'CAD',
        theme: 'system',
        updatedAt: '2026-10-20T09:15:00.000Z',
      },
    ]);
    joinInbox.set('YGFiY2RlZmdoaWprbG1ubw.QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8');
    const dialog = await vi.waitFor(() => loader.getHarness(MatDialogHarness), { timeout: 5000 });
    expect(await dialog.getTitleText()).toBe('Join with a sync code');
    await vi.waitFor(() =>
      expect(links.take).toHaveBeenCalledWith({
        id: 'YGFiY2RlZmdoaWprbG1ubw',
        key: 'QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8',
      }),
    );
    expect(joinInbox()).toBeUndefined();
    await vi.waitFor(async () =>
      expect(await dialog.getText()).toContain('This link was used or has expired.'),
    );
  });

  it('leaves a join link to the first run’s dialog on a new device, and drops what isn’t one', async () => {
    joinInbox.set('YGFiY2RlZmdoaWprbG1ubw.QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8');
    await until(() => TestBed.inject(SettingsStore).needsFirstRun());
    await fixture.whenStable();
    expect(joinInbox()).toBeDefined();
    expect(await loader.getAllHarnesses(MatDialogHarness)).toHaveLength(0);

    await plantRows(storage.indexedDB, 'settings', [
      {
        key: 'settings',
        country: 'CA',
        currency: 'CAD',
        theme: 'system',
        updatedAt: '2026-10-20T09:15:00.000Z',
      },
    ]);
    joinInbox.set('budgets');
    await until(() => joinInbox() === undefined, 5000);
    expect(await loader.getAllHarnesses(MatDialogHarness)).toHaveLength(0);
  });

  it('on: when it last synced, Sync now, the devices, and Turn off and Delete asking first', async () => {
    sync.record.set(on);
    sync.devices.set([
      { id: on.deviceId, name: on.deviceName, syncedAt: on.syncedAt ?? '' },
      {
        id: '0192f1d0-0000-7000-8000-00000000000b',
        name: 'Phone',
        syncedAt: '2026-10-24T09:00:00.000Z',
      },
    ]);
    await fixture.whenStable();

    expect(text()).toContain('Synced 2 minutes ago');
    expect(text()).toContain('Edge on Windows (this device)');
    expect(text()).toContain('Phone synced Oct 24, 2026');
    await (await button(/Sync now$/)).click();
    expect(sync.sync).toHaveBeenCalled();

    await (await button('Turn off on this device…')).click();
    await vi.waitFor(() => expect(sync.turnOff).toHaveBeenCalled());
    await (await button('Delete the synced copy…')).click();
    await vi.waitFor(() => expect(sync.deleteCopy).toHaveBeenCalled());
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[1][0]).toMatchObject({ danger: true });
  });

  it('doesn’t sync again while it’s syncing, where Sync now says it can’t', async () => {
    sync.record.set(on);
    sync.syncing.set(true);
    await fixture.whenStable();
    const syncNow = await button(/Sync now$/);
    expect(await syncNow.isDisabled()).toBe(true);
    await syncNow.click();
    expect(sync.sync).not.toHaveBeenCalled();
  });

  it('says what held sync back, and what stopped it, with what to do', async () => {
    sync.record.set(on);
    sync.snag.set('offline');
    await fixture.whenStable();
    expect(text()).toContain('You’re offline: sync waits until you’re back online.');

    sync.record.set({ ...on, problem: 'gone' });
    await fixture.whenStable();
    expect(text()).toContain('The synced copy was deleted');
    expect(await (await button('Join with a code')).isDisabled()).toBe(false);
    expect(await (await button('Turn off sync here…')).isDisabled()).toBe(false);
  });
});

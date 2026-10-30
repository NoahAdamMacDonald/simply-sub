import type { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import type { SyncDevice, SyncRecord } from '@simply-sub/core';
import { testStorage } from '../../core/storage/storage.testing';
import { ConfirmService } from '../../shared/confirm/confirm-service';
import { SyncService, type SyncSnag } from '../../shared/sync/sync-service';
import { SyncSetting } from './sync-setting';

// Settings' Sync between devices (M10.9): off, on and stopped, with a stand-in for SyncService and every confirmation
// answered yes. The clock says Oct 25, 2026, 12:00 UTC.

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
  let sync: FakeSync;
  let confirm: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<SyncSetting>;
  let loader: HarnessLoader;

  beforeEach(async () => {
    sync = new FakeSync();
    confirm = vi.fn(async () => true);
    TestBed.configureTestingModule({
      providers: [
        testStorage().providers,
        { provide: SyncService, useValue: sync },
        { provide: ConfirmService, useValue: { confirm } },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    fixture = TestBed.createComponent(SyncSetting);
    loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
    await fixture.whenStable();
  });

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
    expect(document.querySelector('ss-qr-code path')?.getAttribute('d')).toMatch(/^M\d/);

    await (await loader.getHarness(MatButtonHarness.with({ text: 'I’ve saved it' }))).click();
    await vi.waitFor(() => expect(sync.turnOn).toHaveBeenCalledWith(seed));
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

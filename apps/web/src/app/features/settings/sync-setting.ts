import { Component, DestroyRef, Injector, computed, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { ClockService } from '../../core/clock/clock-service';
import { fromBase64 } from '../../core/crypto/passphrase-crypto';
import { AppUpdates } from '../../core/pwa/app-updates';
import { ConfirmService } from '../../shared/confirm/confirm-service';
import { dateText } from '../../shared/date-text';
import { SyncService } from '../../shared/sync/sync-service';
import type { SyncCodeData } from './sync-code-dialog';
import { problemTexts, snagTexts, syncedText } from './sync-text';

/**
 * Settings' Sync between devices (PROJECT-PLAN P13, M10.9). Off: Turn on sync, which shows a new code to keep first,
 * and Join with a code. On: when this device last synced and Sync now; the devices, this one first, with Rename; Show
 * the code, Start over with a new code, Turn off on this device and Delete the synced copy, each asking first. Stopped:
 * what stopped it, and what to do. The dialogs load as they open.
 */
@Component({
  selector: 'ss-sync-setting',
  imports: [MatButton, MatIcon],
  templateUrl: './sync-setting.html',
  styleUrl: './sync-setting.scss',
})
export class SyncSetting {
  private readonly sync = inject(SyncService);
  private readonly confirm = inject(ConfirmService);
  private readonly updates = inject(AppUpdates);
  private readonly clock = inject(ClockService);
  private readonly injector = inject(Injector);

  protected readonly record = this.sync.record;
  protected readonly syncing = this.sync.syncing;
  /** The time now, a little behind: "Synced 2 minutes ago" moves on with it. */
  private readonly now = signal(Date.parse(this.clock.now()));
  /** Why the last thing asked of sync couldn't be done, until the next. */
  private readonly notice = signal('');

  /** When this device last synced, what's holding sync back, or what stopped it. */
  protected readonly statusLine = computed(() => {
    const record = this.record();
    if (!record) return this.notice();
    if (this.notice()) return this.notice();
    if (record.problem) return problemTexts[record.problem];
    if (this.syncing()) return 'Syncing…';
    const snag = this.sync.snag();
    return snag ? snagTexts[snag] : syncedText(record.syncedAt, this.now());
  });

  /** The chain's other devices as last read, with the day each last synced. */
  protected readonly others = computed(() => {
    const here = this.record()?.deviceId;
    return this.sync
      .devices()
      .filter(({ id }) => id !== here)
      .map((device) => ({ ...device, day: dateText(device.syncedAt.slice(0, 10)) }));
  });

  constructor() {
    // Once sync is on here, it goes on by itself.
    this.sync.start();
    const ticking = setInterval(() => this.now.set(Date.parse(this.clock.now())), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(ticking));
  }

  protected async turnOn(): Promise<void> {
    const seed = this.sync.newSeed();
    if (await this.showCode({ mode: 'turn-on', seed })) await this.sync.turnOn(seed);
  }

  protected async join(): Promise<void> {
    const [{ MatDialog }, { JoinSyncDialog }] = await Promise.all([
      import('@angular/material/dialog'),
      import('./join-sync-dialog'),
    ]);
    this.injector.get(MatDialog).open(JoinSyncDialog, {
      autoFocus: 'first-tabbable',
      maxWidth: 'min(720px, calc(100vw - 32px))',
      width: '720px',
    });
  }

  protected syncNow(): void {
    this.notice.set('');
    void this.sync.sync();
  }

  protected async rename(): Promise<void> {
    const [{ MatDialog }, { RenameDeviceDialog }] = await Promise.all([
      import('@angular/material/dialog'),
      import('./rename-device-dialog'),
    ]);
    const dialog = this.injector.get(MatDialog).open(RenameDeviceDialog, {
      data: this.record()?.deviceName ?? '',
      maxWidth: 'min(440px, calc(100vw - 32px))',
    });
    dialog.afterClosed().subscribe((name?: string) => {
      if (name) void this.sync.rename(name);
    });
  }

  protected async show(): Promise<void> {
    const record = this.record();
    if (
      record &&
      (await this.confirm.confirm({
        title: 'Show the sync code?',
        message:
          'Anyone who sees it can add a device and read what you sync. Show it where nobody else is looking.',
        confirmText: 'Show the code',
      }))
    ) {
      await this.showCode({ mode: 'show', seed: fromBase64(record.seed) });
    }
  }

  protected async startOver(): Promise<void> {
    if (
      !(await this.confirm.confirm({
        title: 'Start over with a new code?',
        message:
          'Your data moves to a new synced copy with a new code, and the old copy is deleted: your other ' +
          'devices stop syncing until they join with the new code. Use it when a device is lost.',
        confirmText: 'Start over',
        danger: true,
      }))
    ) {
      return;
    }
    const seed = this.sync.newSeed();
    if (!(await this.showCode({ mode: 'start-over', seed }))) return;
    this.notice.set(
      (await this.sync.startOver(seed)) === 'offline'
        ? 'You’re offline, so nothing changed: start over once you’re back online.'
        : '',
    );
  }

  protected async turnOff(): Promise<void> {
    if (
      await this.confirm.confirm({
        title: 'Turn off sync on this device?',
        message:
          'Your data stays here, and your other devices go on syncing. To sync here again, join with the code.',
        confirmText: 'Turn off',
      })
    ) {
      await this.sync.turnOff();
    }
  }

  protected async deleteCopy(): Promise<void> {
    if (
      await this.confirm.confirm({
        title: 'Delete the synced copy?',
        message:
          'Your other devices stop syncing, and sync turns off here. Each device keeps its own data.',
        confirmText: 'Delete the synced copy',
        danger: true,
      })
    ) {
      try {
        await this.sync.deleteCopy();
        this.notice.set('');
      } catch {
        this.notice.set(
          'The synced copy couldn’t be deleted, so nothing changed. Check your connection, then try again.',
        );
      }
    }
  }

  protected checkForUpdates(): void {
    void this.updates.check();
  }

  /** The code's dialog: true once the user has kept a new code. */
  private async showCode(data: SyncCodeData): Promise<boolean> {
    const [{ MatDialog }, { SyncCodeDialog }] = await Promise.all([
      import('@angular/material/dialog'),
      import('./sync-code-dialog'),
    ]);
    const dialog = this.injector.get(MatDialog).open(SyncCodeDialog, {
      data,
      autoFocus: 'first-heading',
      maxWidth: 'min(640px, calc(100vw - 32px))',
      width: '640px',
    });
    return new Promise((resolve) =>
      dialog.afterClosed().subscribe((kept?: boolean) => resolve(kept === true)),
    );
  }
}

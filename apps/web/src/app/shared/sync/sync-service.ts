import {
  DOCUMENT,
  DestroyRef,
  InjectionToken,
  Service,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  backupCounts,
  defaultDeviceName,
  maxSealedCopyBytes,
  mergeSync,
  readSyncCopy,
  type BackupCounts,
  type Settings,
  type SyncCopy,
  type SyncDevice,
  type SyncRecord,
} from '@simply-sub/core';
import { Subscription, debounceTime } from 'rxjs';
import { fromBase64, toBase64 } from '../../core/crypto/passphrase-crypto';
import {
  SealedCopyError,
  newSyncSeed,
  openCopy,
  sealCopy,
  syncKeys,
  type SyncKeys,
} from '../../core/crypto/sync-crypto';
import { oneAtATime } from '../../core/one-at-a-time';
import { StorageService } from '../../core/storage/storage-service';
import { SyncRepository } from '../../core/storage/sync-repository';
import { SyncCallError, deleteChain, readChain, writeChain } from './sync-client';

/**
 * How long a change waits for the next before a sync, and how long a shown tab waits to ask for the other devices'
 * changes: `pollMs` after activity, doubling while nothing happens up to `pollMaxMs` (M10.26). Specs set them.
 */
export const SYNC_TIMING = new InjectionToken<{
  settleMs: number;
  pollMs: number;
  pollMaxMs: number;
}>('SYNC_TIMING', {
  factory: () => ({ settleMs: 10_000, pollMs: 10_000, pollMaxMs: 300_000 }),
});
/** One tab at a time syncs. */
const syncLock = 'simply-sub:sync';
/** A write that loses to another device's reads and merges again, this many times in all. */
const tries = 3;

/** What held sync back last time, until it works again: it waits for the network, or for a moment. */
export type SyncSnag = 'offline' | 'busy' | 'full' | 'tooBig' | 'failed';

/** What a run found. */
export type SyncOutcome = 'synced' | 'off' | 'stopped' | SyncSnag;

/** What joining with a code found: the copy to merge or take, or why there's none. */
export type JoinPreview =
  | { kind: 'copy'; counts: BackupCounts; copy: SyncCopy; version: string }
  | { kind: 'none' | 'newer' | 'unopenable' | 'offline' | 'failed' };

/**
 * Device sync in the app (PROJECT-PLAN P13, M10.9; BLUEPRINT §11.4). While sync is on, and the app unlocked, it syncs
 * on start, when back online, when a tab is shown again, 10 s after a change to a synced record or a shared setting,
 * and on Sync now. While the chain has other devices and the tab is shown, it also checks for their changes 10 s after
 * activity, waiting twice as long after each check while nothing happens, up to 5 minutes (M10.26). One tab at a
 * time, it reads the chain (If-None-Match, so an unchanged copy costs a 304), merges it with this device's data
 * (core's mergeSync), writes what it took in one transaction, and sends a new version when this device has something
 * newer (If-Match), reading and merging again if another device wrote first. Each check is a Worker request, from the
 * account's 100,000 a day (BLUEPRINT §7.1).
 */
@Service()
export class SyncService {
  private readonly repository = inject(SyncRepository);
  private readonly storage = inject(StorageService);
  private readonly document = inject(DOCUMENT);
  private readonly timing = inject(SYNC_TIMING);

  /** Sync on this device, while it's on. */
  readonly record = this.repository.record;
  /** A sync is under way. */
  readonly syncing = signal(false);
  /** What held the last sync back, until one works. */
  readonly snag = signal<SyncSnag | undefined>(undefined);
  /** The chain's devices as last read, this one first. */
  readonly devices = signal<SyncDevice[]>([]);

  /** The copy this device last read or wrote, and its version: what a 304 means. Kept in memory only. */
  private held?: { version: string; copy: SyncCopy };
  /** The keys of the code they were made from. */
  private keys?: { seed: string; keys: SyncKeys };
  private readonly watching = new Subscription();
  private readonly started = signal(false);
  /** The next check for the other devices' changes, and how long it was set to wait. */
  private polling?: { timer: ReturnType<typeof setTimeout>; wait: number };
  /** How long the next check waits: pollMs after activity, twice the last while nothing happens. */
  private wait = this.timing.pollMs;
  private readonly runOnce = oneAtATime(() => this.locked(() => this.run()));

  /** Whether syncing can go on by itself: on, unlocked, and not stopped by a problem. */
  private readonly live = computed(
    () =>
      this.record() !== undefined &&
      this.record()?.problem === undefined &&
      this.storage.lock() !== 'locked',
  );
  /** The chain has devices besides this one, as last read: none are known until the first sync after a reload. */
  private readonly others = computed(() =>
    this.devices().some((device) => device.id !== this.record()?.deviceId),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.watching.unsubscribe();
      clearTimeout(this.polling?.timer);
    });
    // Once started, a sync each time syncing can go on by itself again: turned on, joined, unlocked.
    effect(() => {
      const live = this.started() && this.live();
      untracked(() => {
        this.poll();
        if (live) void this.sync();
      });
    });
  }

  /** Starts syncing by itself while sync is on: from the background, once the app has shown. */
  start(): void {
    if (untracked(this.started)) return;
    this.started.set(true);
    const view = this.document.defaultView;
    const online = () => void this.sync();
    const shown = () => {
      if (this.document.visibilityState === 'visible') {
        this.wait = this.timing.pollMs;
        void this.sync();
      }
      this.poll();
    };
    const used = () => this.stir();
    const quietly = { capture: true, passive: true };
    view?.addEventListener('online', online);
    view?.addEventListener('focus', used);
    this.document.addEventListener('visibilitychange', shown);
    this.document.addEventListener('pointerdown', used, quietly);
    this.document.addEventListener('keydown', used, quietly);
    this.watching.add(() => {
      view?.removeEventListener('online', online);
      view?.removeEventListener('focus', used);
      this.document.removeEventListener('visibilitychange', shown);
      this.document.removeEventListener('pointerdown', used, quietly);
      this.document.removeEventListener('keydown', used, quietly);
    });
    this.watching.add(
      this.repository
        .changes()
        .pipe(debounceTime(this.timing.settleMs))
        .subscribe(() => {
          this.wait = this.timing.pollMs;
          void this.sync();
        }),
    );
  }

  /**
   * Sets the next check for the other devices' changes, `wait` from now, while the tab is shown, syncing goes on by
   * itself and the chain has other devices; else none. A check doubles the wait for the one after.
   */
  private poll(): void {
    clearTimeout(this.polling?.timer);
    this.polling = undefined;
    if (
      untracked(this.started) &&
      untracked(this.live) &&
      untracked(this.others) &&
      this.document.visibilityState === 'visible'
    ) {
      const wait = this.wait;
      const timer = setTimeout(() => {
        this.polling = undefined;
        this.wait = Math.min(wait * 2, this.timing.pollMaxMs);
        void this.sync();
      }, wait);
      this.polling = { timer, wait };
    }
  }

  /**
   * Activity here (focus, a press, a key): the next check comes pollMs from now, unless it's due sooner. So however
   * often they come, they move it at most once a check, and a device in use checks every 10 s.
   */
  private stir(): void {
    this.wait = this.timing.pollMs;
    if (this.polling && this.polling.wait > this.wait) this.poll();
  }

  /** Syncs now, unless sync is off, stopped, or locked; one already under way is followed by another. */
  sync(): Promise<SyncOutcome> {
    if (!untracked(this.live)) return Promise.resolve('off');
    return this.runOnce();
  }

  /** Turns sync on with a new code, after the user has kept its words: the chain starts with this device's data. */
  async turnOn(seed: Uint8Array<ArrayBuffer>): Promise<SyncOutcome> {
    const now = this.storage.now();
    await this.repository.save({
      seed: toBase64(seed),
      deviceId: this.storage.newId(now),
      deviceName: defaultDeviceName(this.document.defaultView?.navigator.userAgent ?? ''),
    });
    this.held = undefined;
    return this.runOnce();
  }

  /** What the chain with this code holds, before joining it. */
  async preview(seed: Uint8Array<ArrayBuffer>): Promise<JoinPreview> {
    const keys = await syncKeys(seed);
    try {
      const read = await readChain(keys);
      if (read.kind !== 'copy') return { kind: 'failed' };
      const reading = readSyncCopy(await openCopy(keys, read.bytes));
      if (reading.kind !== 'copy')
        return { kind: reading.kind === 'newer' ? 'newer' : 'unopenable' };
      logRejected(reading.rejected);
      return {
        kind: 'copy',
        counts: backupCounts(reading.copy.data),
        copy: reading.copy,
        version: read.version,
      };
    } catch (error) {
      if (error instanceof SealedCopyError) return { kind: 'unopenable' };
      if (error instanceof SyncCallError) {
        return {
          kind:
            error.problem === 'gone' ? 'none' : error.problem === 'offline' ? 'offline' : 'failed',
        };
      }
      throw error;
    }
  }

  /**
   * Joins the chain a preview read: this device takes its shared settings (where the user is, the tax, the budgets),
   * then merges its records with the copy's, or replaces its own with them; then it syncs, adding itself to the devices.
   * A new device in its first run has no settings yet: they start from the shared ones and its `theme` (M10.15).
   */
  async join(
    seed: Uint8Array<ArrayBuffer>,
    preview: Extract<JoinPreview, { kind: 'copy' }>,
    mode: 'merge' | 'replace',
    theme?: Settings['theme'],
  ): Promise<SyncOutcome> {
    const now = this.storage.now();
    const { copy, version } = preview;
    if (mode === 'replace') {
      await this.repository.replaceLocal(copy.data, copy.settings, theme);
    } else {
      await this.repository.applyMerge({}, copy.settings, theme);
    }
    const kept = await this.repository.readOnce();
    await this.repository.save({
      seed: toBase64(seed),
      deviceId: kept?.deviceId ?? this.storage.newId(now),
      deviceName:
        kept?.deviceName ?? defaultDeviceName(this.document.defaultView?.navigator.userAgent ?? ''),
      version,
    });
    this.held = { version, copy };
    return this.runOnce();
  }

  /** Renames this device in the chain's list of devices. */
  async rename(name: string): Promise<SyncOutcome> {
    await this.repository.update({ deviceName: name });
    return this.sync();
  }

  /** Turns sync off on this device: its data stays here, and the chain goes on for the others. */
  async turnOff(): Promise<void> {
    await this.repository.remove();
    this.forget();
  }

  /**
   * Starts a new chain with a new code, for a lost device: this device's data moves to it and the old chain is
   * deleted, so the other devices stop syncing and join again with the new code. Offline it changes nothing: the old
   * chain would go on for the other devices.
   */
  async startOver(seed: Uint8Array<ArrayBuffer>): Promise<SyncOutcome> {
    if (!navigator.onLine) return 'offline';
    const old = await this.repository.readOnce();
    if (!old) return 'off';
    const oldKeys = await this.keysFor(old.seed);
    await this.repository.save({
      seed: toBase64(seed),
      deviceId: old.deviceId,
      deviceName: old.deviceName,
    });
    this.forget();
    const outcome = await this.runOnce();
    if (outcome === 'synced') await deleteChain(oldKeys).catch(() => undefined);
    return outcome;
  }

  /** Deletes the chain for every device, and turns sync off here. Offline, it throws a SyncCallError and changes nothing. */
  async deleteCopy(): Promise<void> {
    const record = await this.repository.readOnce();
    if (record) await deleteChain(await this.keysFor(record.seed));
    await this.turnOff();
  }

  /** A new code, for Turn on and Start over. */
  newSeed(): Uint8Array<ArrayBuffer> {
    return newSyncSeed();
  }

  private forget(): void {
    this.held = undefined;
    this.keys = undefined;
    this.devices.set([]);
    this.snag.set(undefined);
  }

  /** `task` while this tab holds sync's lock, so tabs that sync together take turns. */
  private async locked<T>(task: () => Promise<T>): Promise<T> {
    const locks = this.document.defaultView?.navigator.locks;
    return locks ? locks.request(syncLock, task) : task();
  }

  /** One sync, as the class comment says. It never rejects: what went wrong is its outcome. */
  private async run(): Promise<SyncOutcome> {
    // This run is the check: the next one waits from its end.
    clearTimeout(this.polling?.timer);
    this.polling = undefined;
    this.syncing.set(true);
    try {
      const outcome = await this.attempt();
      this.snag.set(
        outcome === 'synced' || outcome === 'off' || outcome === 'stopped' ? undefined : outcome,
      );
      return outcome;
    } catch (error) {
      if (!(error instanceof SyncCallError)) console.error('Sync failed:', error);
      const problem = error instanceof SyncCallError ? error.problem : 'failed';
      const snag: SyncSnag =
        problem === 'offline' || problem === 'busy' || problem === 'full' ? problem : 'failed';
      this.snag.set(snag);
      return snag;
    } finally {
      this.syncing.set(false);
      this.poll();
    }
  }

  private async attempt(): Promise<SyncOutcome> {
    for (let attempt = 0; attempt < tries; attempt++) {
      const record = await this.repository.readOnce();
      if (!record || record.problem) return 'off';
      const keys = await this.keysFor(record.seed);

      let remote: { version: string; copy: SyncCopy } | undefined;
      try {
        const heldHere = this.held?.version === record.version ? this.held : undefined;
        const read = await readChain(keys, heldHere?.version);
        if (read.kind === 'unchanged') {
          remote = heldHere;
        } else {
          const reading = readSyncCopy(await openCopy(keys, read.bytes));
          if (reading.kind !== 'copy') {
            return this.stop(reading.kind === 'newer' ? 'newer' : 'unopenable');
          }
          logRejected(reading.rejected);
          remote = { version: read.version, copy: reading.copy };
        }
      } catch (error) {
        if (error instanceof SealedCopyError) return this.stop('unopenable');
        if (!(error instanceof SyncCallError && error.problem === 'gone')) throw error;
        // A chain this device has just turned on isn't there to read yet: it's written below. Any other is gone.
        if (record.version !== undefined) return this.stop('gone');
      }

      const local = await this.repository.readLocal();
      if (!local) return 'off';
      const now = this.storage.now();
      const merge = mergeSync(
        local,
        remote?.copy,
        { id: record.deviceId, name: record.deviceName },
        now,
      );
      if (Object.keys(merge.writes).length > 0 || merge.settings) {
        await this.repository.applyMerge(merge.writes, merge.settings);
        // It took something in: the other devices are in use, so the next check comes soon.
        this.wait = this.timing.pollMs;
      }

      let version = remote?.version;
      if (merge.send) {
        const sealed = await sealCopy(keys, merge.copy);
        if (sealed.byteLength > maxSealedCopyBytes) return 'tooBig';
        try {
          version = await writeChain(keys, sealed, remote?.version ?? 'new');
        } catch (error) {
          if (error instanceof SyncCallError && error.problem === 'stale') continue;
          if (error instanceof SyncCallError && error.problem === 'gone') return this.stop('gone');
          throw error;
        }
        this.held = { version, copy: merge.copy };
      } else if (remote) {
        this.held = remote;
      }
      this.devices.set(merge.copy.devices);
      await this.repository.update({ ...(version !== undefined && { version }), syncedAt: now });
      return 'synced';
    }
    return 'busy';
  }

  /** Stops syncing on this device for what needs the user: the chain was deleted, needs a newer app, or won't open. */
  private async stop(problem: NonNullable<SyncRecord['problem']>): Promise<SyncOutcome> {
    await this.repository.update({ problem });
    this.forget();
    return 'stopped';
  }

  private async keysFor(seed: string): Promise<SyncKeys> {
    if (this.keys?.seed !== seed) this.keys = { seed, keys: await syncKeys(fromBase64(seed)) };
    return this.keys.keys;
  }
}

/** A copy's records that failed their schema, logged by table and key only: never what they hold. */
function logRejected(rejected: readonly { table: string; key?: string }[]): void {
  if (rejected.length === 0) return;
  console.warn(
    'Sync left out records it could not read:',
    rejected.map(({ table, key }) => `${table} ${key ?? '(no key)'}`).join(', '),
  );
}

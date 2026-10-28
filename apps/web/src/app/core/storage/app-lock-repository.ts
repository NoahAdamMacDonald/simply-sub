import { Service, inject } from '@angular/core';
import { lockIdleMinutes, type LockIdleChoice } from '@simply-sub/core';
import { StorageService } from './storage-service';

/**
 * The app lock's way into the database (PROJECT-PLAN P13, P15; BLUEPRINT §11.5): unlock, turning the lock on and off,
 * and Lock after. The storage engine does the work, with the crypto module, in its own chunk. The idle timer locks
 * through StorageService.lockNow, which needs neither.
 */
@Service()
export class AppLockRepository {
  private readonly storage = inject(StorageService);

  /** Unlocks with `passphrase` (P15). False when it's wrong, and nothing changes. */
  async unlock(passphrase: string): Promise<boolean> {
    const engine = await this.storage.engine();
    return engine.unlock(passphrase);
  }

  /** Turns the lock on (P13): every user table sealed with a key from `passphrase`, in one transaction. */
  async turnOn(passphrase: string, idle: LockIdleChoice): Promise<void> {
    const engine = await this.storage.engine();
    await engine.enableLock(passphrase, lockIdleMinutes(idle));
  }

  /** Turns the lock off (P13) if `passphrase` is its own: every table stored plain again. False when it's wrong. */
  async turnOff(passphrase: string): Promise<boolean> {
    const engine = await this.storage.engine();
    return engine.disableLock(passphrase);
  }

  /** Lock after (P13). */
  async setIdle(idle: LockIdleChoice): Promise<void> {
    const engine = await this.storage.engine();
    await engine.setLockIdle(lockIdleMinutes(idle));
  }
}

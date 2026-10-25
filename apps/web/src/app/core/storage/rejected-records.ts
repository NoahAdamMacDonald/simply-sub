import { Injector, Service, inject, signal } from '@angular/core';
import type { RejectedRecord } from '@simply-sub/core';

/**
 * Stored records that fail their schema (BLUEPRINT §11.1). They're never shown, and they stay in IndexedDB as they
 * are, so a schema bug can't destroy data. The console gets each one's table, key and issues, never its values, and
 * the user gets one message per session.
 */
@Service()
export class RejectedRecords {
  private readonly injector = inject(Injector);
  private readonly reported = new Set<string>();
  private readonly reportedCount = signal(0);
  private noticeShown = false;

  /** How many different records have been rejected this session. */
  readonly count = this.reportedCount.asReadonly();

  /** Called with every read's rejected records, so the same record can come back many times. */
  report(rejected: readonly RejectedRecord[]): void {
    const before = this.reported.size;
    for (const { table, key, issues } of rejected) {
      const description = `${table} record ${key ?? '(malformed key)'}: ${issues.join('; ')}`;
      if (this.reported.has(description)) continue;
      this.reported.add(description);
      console.warn(`A saved record couldn't be read, so it's hidden. ${description}`);
    }
    if (this.reported.size === before) return;
    this.reportedCount.set(this.reported.size);
    if (this.noticeShown) return;
    this.noticeShown = true;
    // If the message can't be shown (say its chunk fails to load), the next rejected record tries again.
    this.showNotice().catch(() => (this.noticeShown = false));
  }

  private async showNotice(): Promise<void> {
    // Loaded on first use, as GlobalErrorHandler does, so the snackbar stays out of the initial bundle. It stays
    // until dismissed: it's rare, and there's no hurry to read it.
    const { MatSnackBar } = await import('@angular/material/snack-bar');
    this.injector
      .get(MatSnackBar)
      .open("Some saved data couldn't be read, so it's hidden. The rest is fine.", 'Dismiss');
  }
}
